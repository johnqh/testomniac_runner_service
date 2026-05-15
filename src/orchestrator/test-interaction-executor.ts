import type { BrowserAdapter } from "../adapter";
import type { ApiClient } from "../api/client";
import {
  ExpectationSeverity,
  FindingPriority,
} from "@sudobility/testomniac_types";
import type {
  NetworkLogEntry,
  TestInteractionResponse,
  TestInteractionRunResponse,
  TestRunResponse,
  TestSurfaceResponse,
  TestSurfaceBundleRunResponse,
} from "@sudobility/testomniac_types";
import type { ScanEventHandler } from "./types";
import type { Expertise, ExpertiseContext, Outcome } from "../expertise/types";
import type { PageAnalyzer, AnalyzerContext } from "../analyzer";
import { isWithinScopePath } from "../crawler/scope-checker";
import { detectLoginPage } from "../scanner/login-detector";
import { evaluatePageHealth } from "../scanner/page-health-evaluator";
import { extractActionableItems } from "../extractors";
import { extractForms } from "../extractors/form-extractor";
import { captureControlStates } from "../browser/control-snapshot";
import {
  buildReplaySelectorFromDescription,
  isTransientSnapshotSelector,
} from "../browser/replay-selector";
import { captureUiSnapshot, type UiSnapshot } from "../browser/ui-snapshot";
import { detectScaffoldRegions } from "../scanner/component-detector";
import { detectPatternsWithInstances } from "../scanner/pattern-detector";

let _clickWaitMs = 500;

export function setClickWaitMs(ms: number): void {
  _clickWaitMs = ms;
}

type StoredExpectation = {
  expectationType: string;
  elementIdentityId?: number;
  expectedValue?: string;
  attributeName?: string;
  targetPath?: string;
  secondaryTargetPath?: string;
  expectedCountDelta?: number;
  expectedTextTokens?: string[];
  forbiddenTextTokens?: string[];
  timeoutMs?: number;
  expectNoChange?: boolean;
  severity: string;
  description: string;
  playwrightCode: string;
};

type StoredStep = {
  action: {
    actionType: string;
    path?: string;
    value?: string;
    playwrightCode: string;
    description: string;
  };
  expectations: StoredExpectation[];
  description: string;
  continueOnFailure: boolean;
};

type ExecutionSnapshot = {
  html: string;
  url: string;
  uiSnapshot: ExpertiseContext["initialUiSnapshot"];
  controlStates: ExpertiseContext["initialControlStates"];
};

type StepExecution = {
  step: StoredStep;
  startedAtMs: number;
  endedAtMs: number;
  beforeSnapshot: ExecutionSnapshot;
  afterSnapshot: ExecutionSnapshot;
};

type ExpectationEvaluationGroup = {
  expectations: StoredExpectation[];
  networkLogs: NetworkLogEntry[];
  snapshot: ExecutionSnapshot;
  previousSnapshot: ExecutionSnapshot;
};

type SnapshotLike = Partial<ExecutionSnapshot> | null | undefined;

function logExecutor(step: string, details?: Record<string, unknown>): void {
  console.info("[Executor]", step, details ?? {});
}

function summarizeStoredStep(step: StoredStep): Record<string, unknown> {
  return {
    actionType: step.action.actionType,
    path: step.action.path ?? null,
    value: step.action.value ?? null,
    description: step.description,
    expectationsCount: step.expectations.length,
    continueOnFailure: step.continueOnFailure,
  };
}

function prepareActionForReplay(
  action: StoredStep["action"]
): StoredStep["action"] {
  if (!isTransientSnapshotSelector(action.path)) {
    return action;
  }

  const replayPath = buildReplaySelectorFromDescription(
    action.actionType,
    action.description,
    action.path
  );

  if (!replayPath) {
    return action;
  }

  return {
    ...action,
    path: replayPath,
  };
}

/**
 * Execute a single test element: run actions, decompose page, evaluate expertises,
 * set outcomes, create findings, and optionally discover new test elements.
 */
export async function executeTestInteraction(
  adapter: BrowserAdapter,
  testInteractionRun: TestInteractionRunResponse,
  testRun: TestRunResponse,
  expertises: Expertise[],
  analyzer: PageAnalyzer | null,
  api: ApiClient,
  events: ScanEventHandler,
  discoveryContext?: {
    navigationSurface: TestSurfaceResponse;
    bundleRun: TestSurfaceBundleRunResponse;
  },
  scanScopePath?: string,
  loginManager?: import("./login-manager").LoginManager
): Promise<void> {
  const startTime = Date.now();
  const consoleLogs: string[] = [];
  const networkLogs: NetworkLogEntry[] = [];
  let currentPhase = "initialization";

  // Listen for console and network events
  adapter.on("console", (...args: unknown[]) => {
    consoleLogs.push(String(args[0] ?? ""));
  });
  adapter.on("response", (...args: unknown[]) => {
    const entry = args[0] as {
      method?: string;
      url: string;
      status: number;
      contentType?: string;
      timestampMs?: number;
    };
    if (entry && typeof entry.url === "string") {
      networkLogs.push({
        method: entry.method ?? "GET",
        url: entry.url,
        status: entry.status,
        contentType: entry.contentType ?? "",
        timestampMs:
          typeof entry.timestampMs === "number"
            ? entry.timestampMs
            : Date.now(),
      });
    }
  });

  try {
    currentPhase = "loading-test-interactions";
    const allTestInteractions = await api.getTestInteractionsByRunner(
      testRun.runnerId
    );
    const testInteractionById = new Map(
      allTestInteractions.map(testInteraction => [
        testInteraction.id,
        testInteraction,
      ])
    );
    const loadedTestInteraction = testInteractionById.get(
      testInteractionRun.testInteractionId
    );
    if (!loadedTestInteraction) {
      throw new Error(
        `Test case ${testInteractionRun.testInteractionId} not found`
      );
    }
    let testInteraction = loadedTestInteraction;
    logExecutor("interaction:loaded", {
      testRunId: testRun.id,
      testInteractionRunId: testInteractionRun.id,
      testInteractionId: testInteraction.id,
      title: testInteraction.title,
      testType: testInteraction.testType,
      priority: testInteraction.priority,
      dependencyTestInteractionId:
        testInteraction.dependencyTestInteractionId ?? null,
      surfaceTags: testInteraction.surfaceTags,
      startingPath: testInteraction.startingPath ?? null,
      currentSurfaceRunId: testInteractionRun.testSurfaceRunId ?? null,
    });

    // Parse steps from JSON
    let steps = parseStoredSteps(testInteraction.stepsJson);
    const dependencyChain = buildDependencyChain(
      testInteraction,
      testInteractionById
    );
    const setupCases = dependencyChain.slice(0, -1);
    const journeySteps = dependencyChain.flatMap(item =>
      parseStoredSteps(item.stepsJson)
    );
    logExecutor("interaction:parsed", {
      testInteractionRunId: testInteractionRun.id,
      testInteractionId: testInteraction.id,
      steps: steps.map(summarizeStoredStep),
      dependencyChain: dependencyChain.map(item => ({
        id: item.id,
        dependencyTestInteractionId: item.dependencyTestInteractionId ?? null,
        stepsCount: parseStoredSteps(item.stepsJson).length,
      })),
      setupCaseIds: setupCases.map(item => item.id),
      journeyStepsCount: journeySteps.length,
    });

    // Record beginning page state
    const _beginningUrl = await adapter.getUrl();
    const beginningPageStateId = testInteraction.startingPageStateId ?? 0;
    logExecutor("interaction:starting-state", {
      testInteractionRunId: testInteractionRun.id,
      beginningUrl: _beginningUrl,
      beginningPageStateId,
    });

    // Navigate to starting path if needed
    if (testInteraction.startingPath) {
      const baseUrl = testRun.scanUrl
        ? new URL(testRun.scanUrl).origin
        : "http://localhost";
      const absoluteUrl = testInteraction.startingPath.startsWith("http")
        ? testInteraction.startingPath
        : new URL(testInteraction.startingPath, baseUrl).toString();
      logExecutor("interaction:navigate-to-start", {
        testInteractionRunId: testInteractionRun.id,
        absoluteUrl,
        baseUrl,
      });
      await adapter.goto(absoluteUrl, { waitUntil: "networkidle0" });
    }

    // Check if the current URL is within the scan scope boundary
    if (scanScopePath) {
      const currentUrl = await adapter.getUrl();
      const baseUrl = testRun.scanUrl
        ? new URL(testRun.scanUrl).origin
        : "http://localhost";
      if (!isWithinScopePath(currentUrl, baseUrl, scanScopePath)) {
        logExecutor("interaction:out-of-scope", {
          testInteractionRunId: testInteractionRun.id,
          currentUrl,
          scanScopePath,
        });
        await api.completeTestInteractionRun(testInteractionRun.id, {
          status: "skipped",
          errorMessage: `URL ${currentUrl} is outside scan scope path: ${scanScopePath}`,
        });
        events.onTestInteractionRunCompleted({
          testInteractionRunId: testInteractionRun.id,
          passed: true,
        });
        return;
      }
    }

    currentPhase = "replaying-setup-interactions";

    // Recreate the dependent target state before running this case itself.
    for (const setupCase of setupCases) {
      logExecutor("interaction:replay-setup-case", {
        testInteractionRunId: testInteractionRun.id,
        setupTestInteractionId: setupCase.id,
        setupStepsCount: parseStoredSteps(setupCase.stepsJson).length,
      });
      const setupSteps = parseStoredSteps(setupCase.stepsJson);
      for (const step of setupSteps) {
        const replayAction = prepareActionForReplay(step.action);
        currentPhase = `replaying-setup:${replayAction.actionType}`;
        logExecutor("interaction:replay-setup-step", {
          testInteractionRunId: testInteractionRun.id,
          setupTestInteractionId: setupCase.id,
          step: summarizeStoredStep({
            ...step,
            action: replayAction,
          }),
        });
        try {
          await executeAction(adapter, replayAction, testRun);
          if (adapter.closeOtherTabs) {
            await adapter.closeOtherTabs();
          }
        } catch (replayError) {
          logExecutor("interaction:replay-setup-step-skipped", {
            testInteractionRunId: testInteractionRun.id,
            setupTestInteractionId: setupCase.id,
            actionType: replayAction.actionType,
            error:
              replayError instanceof Error
                ? replayError.message
                : String(replayError),
          });
        }
      }
    }

    currentPhase = "capturing-initial-snapshot";
    const initialSnapshot = await captureExecutionSnapshot(adapter);
    const stepExecutions: StepExecution[] = [];
    let previousSnapshot = initialSnapshot;

    currentPhase = "executing-steps";
    // Execute test actions
    for (let stepIndex = 0; stepIndex < steps.length; stepIndex += 1) {
      const step = steps[stepIndex];
      const replayAction = prepareActionForReplay(step.action);
      const startedAtMs = Date.now();
      const beforeSnapshot = previousSnapshot;
      currentPhase = `executing-step:${replayAction.actionType}`;
      logExecutor("interaction:step-start", {
        testInteractionRunId: testInteractionRun.id,
        testInteractionId: testInteraction.id,
        step: summarizeStoredStep({
          ...step,
          action: replayAction,
        }),
        beforeUrl: beforeSnapshot.url,
      });
      try {
        await executeAction(adapter, replayAction, testRun);
        // Close any new tabs/windows opened by the action (e.g. target="_blank")
        if (adapter.closeOtherTabs) {
          await adapter.closeOtherTabs();
        }
        const afterSnapshot = await captureExecutionSnapshot(adapter);
        previousSnapshot = afterSnapshot;
        stepExecutions.push({
          step: {
            ...step,
            action: replayAction,
          },
          startedAtMs,
          endedAtMs: Date.now(),
          beforeSnapshot,
          afterSnapshot,
        });
        logExecutor("interaction:step-complete", {
          testInteractionRunId: testInteractionRun.id,
          testInteractionId: testInteraction.id,
          step: summarizeStoredStep({
            ...step,
            action: replayAction,
          }),
          afterUrl: afterSnapshot.url,
          durationMs: Date.now() - startedAtMs,
        });
        const refreshed = await maybeRefreshInteractionActions({
          adapter,
          analyzer,
          api,
          testRun,
          testInteraction,
          testInteractionRun,
          steps,
        });
        if (refreshed) {
          testInteraction = refreshed.testInteraction;
          steps = refreshed.steps;
          logExecutor("interaction:steps-reloaded", {
            testInteractionRunId: testInteractionRun.id,
            testInteractionId: testInteraction.id,
            completedStepIndex: stepIndex,
            stepsCount: steps.length,
          });
        }
      } catch (error) {
        const afterSnapshot = await captureExecutionSnapshotSafe(
          adapter,
          beforeSnapshot
        );
        previousSnapshot = afterSnapshot;
        stepExecutions.push({
          step: {
            ...step,
            action: replayAction,
          },
          startedAtMs,
          endedAtMs: Date.now(),
          beforeSnapshot,
          afterSnapshot,
        });
        logExecutor("interaction:step-error", {
          testInteractionRunId: testInteractionRun.id,
          testInteractionId: testInteraction.id,
          step: summarizeStoredStep({
            ...step,
            action: replayAction,
          }),
          error:
            error instanceof Error
              ? { name: error.name, message: error.message }
              : error,
          durationMs: Date.now() - startedAtMs,
          continueOnFailure: step.continueOnFailure,
        });
        if (!step.continueOnFailure) {
          throw error;
        }
        // Still attempt to refresh (e.g. append click to failed hover)
        const refreshed = await maybeRefreshInteractionActions({
          adapter,
          analyzer,
          api,
          testRun,
          testInteraction,
          testInteractionRun,
          steps,
        });
        if (refreshed) {
          testInteraction = refreshed.testInteraction;
          steps = refreshed.steps;
          logExecutor("interaction:steps-reloaded", {
            testInteractionRunId: testInteractionRun.id,
            testInteractionId: testInteraction.id,
            completedStepIndex: stepIndex,
            stepsCount: steps.length,
          });
        }
      }
    }

    // Decompose the page using local detectors
    currentPhase = "decomposing-page";
    const html = normalizeHtml(await adapter.content());
    const scaffolds = ensureArray(await detectScaffoldRegions(adapter));
    const patterns = ensureArray(await detectPatternsWithInstances(adapter));
    const items = ensureArray(await extractActionableItems(adapter));
    const forms = ensureArray(await extractForms(adapter));
    const finalUiSnapshot = normalizeUiSnapshot(
      await captureUiSnapshot(adapter)
    );
    const finalControlStates = ensureArray(await captureControlStates(adapter));
    const currentUrl = await adapter.getUrl();
    await emitLiveScreenshot(adapter, events, currentUrl);
    const scaffoldSelectorByItemSelector = await mapItemsToScaffolds(
      adapter,
      scaffolds,
      items
    );
    logExecutor("interaction:decomposed", {
      testInteractionRunId: testInteractionRun.id,
      testInteractionId: testInteraction.id,
      htmlLength: html.length,
      scaffoldsCount: scaffolds.length,
      patternsCount: patterns.length,
      actionableItemsCount: items.length,
      formsCount: forms.length,
      currentUrl,
      hoverActionableItemsCount: items.filter(
        item =>
          item.visible &&
          !item.disabled &&
          (item.actionKind === "click" || item.actionKind === "navigate")
      ).length,
    });

    // Parse global expectations
    const globalExpectations = parseStoredExpectations(
      testInteraction.globalExpectationsJson
    );
    const stepExpectations = steps.flatMap(step => step.expectations ?? []);

    // If discovery mode: generate baseline expectations
    let expectations = [...stepExpectations, ...globalExpectations];
    if (analyzer && testInteraction.stepsJson) {
      const parsedTestInteraction = {
        title: testInteraction.title,
        type: testInteraction.testType as
          | "navigation"
          | "render"
          | "interaction"
          | "form"
          | "form_negative"
          | "password"
          | "e2e",
        sizeClass: testInteraction.sizeClass as "desktop" | "mobile",
        surface_tags: testInteraction.surfaceTags,
        priority: testInteraction.priority,
        startingPageStateId: testInteraction.startingPageStateId ?? 0,
        startingPath: testInteraction.startingPath ?? "",
        steps: steps as any,
        globalExpectations: globalExpectations as any,
      };
      const generated = analyzer.generateExpectations(parsedTestInteraction);
      expectations = [...expectations, ...generated];
    }

    const expertiseBaseContext: Omit<
      ExpertiseContext,
      | "networkLogs"
      | "expectations"
      | "html"
      | "initialHtml"
      | "initialUrl"
      | "currentUrl"
      | "initialUiSnapshot"
      | "finalUiSnapshot"
      | "initialControlStates"
      | "finalControlStates"
    > = {
      scaffolds,
      patterns,
      consoleLogs,
      startingPath: testInteraction.startingPath ?? undefined,
    };

    // Evaluate all expertises
    const allOutcomes: Outcome[] = [];
    const generatedExpectations = expectations.filter(
      expectation =>
        !stepExpectations.includes(
          expectation as (typeof stepExpectations)[number]
        )
    );
    const expectationGroups = buildExpectationEvaluationGroups({
      stepExecutions,
      generatedExpectations: generatedExpectations as StoredExpectation[],
      networkLogs,
      initialSnapshot,
      finalSnapshot: {
        html,
        url: currentUrl,
        uiSnapshot: finalUiSnapshot,
        controlStates: finalControlStates,
      },
    });

    currentPhase = "evaluating-expectations";
    for (const expertise of expertises) {
      for (const group of expectationGroups) {
        const outcomes = expertise.evaluate({
          ...expertiseBaseContext,
          html: normalizeHtml(group.snapshot.html),
          initialHtml: normalizeHtml(group.previousSnapshot.html),
          expectations: group.expectations as any,
          networkLogs: group.networkLogs,
          initialUrl: group.previousSnapshot.url,
          currentUrl: group.snapshot.url,
          initialUiSnapshot: group.previousSnapshot.uiSnapshot,
          finalUiSnapshot: group.snapshot.uiSnapshot,
          initialControlStates: group.previousSnapshot.controlStates,
          finalControlStates: group.snapshot.controlStates,
        });
        allOutcomes.push(...outcomes);

        // Create findings for unmet expectations based on configured severity.
        for (const outcome of outcomes) {
          const findingType = getFindingTypeForOutcome(outcome);
          if (findingType) {
            const priority = derivePriority(outcome);
            await api.createTestRunFinding({
              testInteractionRunId: testInteractionRun.id,
              type: findingType,
              priority,
              title: `[${expertise.name}] ${outcome.expected}`,
              description: outcome.observed,
            });
            events.onFindingCreated({
              type: findingType,
              priority,
              title: `[${expertise.name}] ${outcome.expected}`,
              description: outcome.observed,
            });
          }
        }
      }
    }

    // Page health evaluation — browser-side checks for broken images, overlaps, etc.
    currentPhase = "evaluating-page-health";
    try {
      const healthIssues = await evaluatePageHealth(adapter);
      for (const issue of healthIssues) {
        const findingType = issue.severity === "error" ? "error" : "warning";
        const priority = derivePageHealthPriority(issue.severity);
        await api.createTestRunFinding({
          testInteractionRunId: testInteractionRun.id,
          type: findingType,
          priority,
          title: `[page-health] ${issue.title}`,
          description: issue.description,
        });
        events.onFindingCreated({
          type: findingType,
          priority,
          title: `[page-health] ${issue.title}`,
          description: issue.description,
        });
      }
    } catch (healthError) {
      logExecutor("page-health:error", {
        error:
          healthError instanceof Error
            ? healthError.message
            : String(healthError),
      });
    }

    // Aggregate outcomes
    const expectedOutcome = allOutcomes.map(o => o.expected).join("\n");
    const observedOutcome = allOutcomes
      .map(
        o =>
          `[${getFindingTypeForOutcome(o) ?? o.result}/${o.severity ?? "unknown"}] ${o.observed}`
      )
      .join("\n");
    const hasErrors = allOutcomes.some(isMustPassFailure);
    const hasWarnings = allOutcomes.some(isNonBlockingFailure);
    const status = hasErrors
      ? "failed"
      : hasWarnings
        ? "completed"
        : "completed";

    currentPhase = "healing-superseded-findings";
    await api.clearSupersededFindings(testInteractionRun.id);

    // Complete test element run
    const durationMs = Date.now() - startTime;
    await api.completeTestInteractionRun(testInteractionRun.id, {
      status,
      durationMs,
      expectedOutcome: expectedOutcome || undefined,
      observedOutcome: observedOutcome || undefined,
      // Attach logs if there were issues
      ...(hasErrors || hasWarnings
        ? {
            consoleLog: consoleLogs.join("\n") || undefined,
            networkLog: JSON.stringify(networkLogs) || undefined,
          }
        : {}),
    });

    events.onTestInteractionRunCompleted({
      testInteractionRunId: testInteractionRun.id,
      passed: !hasErrors,
    });

    // If discovery mode: generate new test elements
    currentPhase = "discovering-follow-up-tests";
    if (analyzer && discoveryContext) {
      const currentUrl = await adapter.getUrl();
      const url = new URL(currentUrl);
      const currentPath = `${url.pathname}${url.search}`;

      const page = await api.findOrCreatePage(
        testRun.runnerId,
        currentPath,
        testRun.testEnvironmentId ?? undefined
      );
      events.onPageFound({
        relativePath: currentPath,
        pageId: page.id,
      });

      // Detect if this is a login page
      const loginDetection = await detectLoginPage(
        adapter,
        currentPath,
        ensureArray(forms)
      );

      // If login page detected, mark it in the DB
      if (loginDetection.isLoginPage) {
        await api.markIsLoginPage(page.id).catch(() => {});
      }

      const analyzerCtx: AnalyzerContext = {
        runnerId: testRun.runnerId,
        testEnvironmentId: testRun.testEnvironmentId ?? undefined,
        sizeClass: testRun.sizeClass as "desktop" | "mobile",
        uid: testRun.createdByUserId ?? undefined,
        currentTestInteractionId: testInteraction.id,
        currentTestSurfaceId: testInteraction.testSurfaceId,
        currentSurfaceRunId: testInteractionRun.testSurfaceRunId,
        html: normalizeHtml(html),
        currentPageStateId: 0,
        beginningPageStateId: beginningPageStateId,
        currentPath,
        pageId: page.id,
        pageRequiresLogin: page.requiresLogin ?? false,
        scaffolds,
        scaffoldSelectorByItemSelector,
        actionableItems: ensureArray(items),
        forms: ensureArray(forms),
        journeySteps: ensureArray(journeySteps) as any,
        navigationSurface: discoveryContext.navigationSurface,
        bundleRun: discoveryContext.bundleRun,
        api,
        events,
        scanScopePath,
        loginDetection,
        loginConfig: loginManager ? loginManager.getConfig() : undefined,
      };

      const parsedTestInteraction = {
        title: testInteraction.title,
        type: testInteraction.testType as any,
        sizeClass: testInteraction.sizeClass as any,
        surface_tags: testInteraction.surfaceTags,
        priority: testInteraction.priority,
        startingPageStateId: testInteraction.startingPageStateId ?? 0,
        startingPath: testInteraction.startingPath ?? "",
        steps: steps as any,
        globalExpectations: globalExpectations as any,
      };

      await analyzer.generateTestInteractions(
        parsedTestInteraction,
        analyzerCtx
      );
      logExecutor("interaction:follow-up-generation-complete", {
        testInteractionRunId: testInteractionRun.id,
        testInteractionId: testInteraction.id,
        currentPath,
        currentPageStateId: analyzerCtx.currentPageStateId,
        beginningPageStateId: analyzerCtx.beginningPageStateId,
      });
    }
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const detail =
      error instanceof Error
        ? error.stack || error.message
        : typeof error === "string"
          ? error
          : JSON.stringify(error);
    const errorMessage = `Phase: ${currentPhase}\n${detail}`;

    // "Element not found" and "Could not resolve clickable point" are replay
    // infrastructure issues, not bugs in the app under test.  Mark the
    // interaction as skipped rather than creating a noisy finding.
    const isReplayError =
      error instanceof Error &&
      (error.message.includes("Element not found") ||
        error.message.includes("Could not resolve clickable point"));

    await api.completeTestInteractionRun(testInteractionRun.id, {
      status: isReplayError ? "skipped" : "failed",
      durationMs,
      errorMessage,
      consoleLog: consoleLogs.join("\n") || undefined,
      networkLog: JSON.stringify(networkLogs) || undefined,
    });
    logExecutor(isReplayError ? "interaction:skipped" : "interaction:failed", {
      testInteractionRunId: testInteractionRun.id,
      testInteractionId: testInteractionRun.testInteractionId,
      phase: currentPhase,
      durationMs,
      errorMessage,
    });

    if (!isReplayError) {
      await api.createTestRunFinding({
        testInteractionRunId: testInteractionRun.id,
        type: "error",
        priority: FindingPriority.Crash,
        title: `Test execution error`,
        description: errorMessage,
      });

      events.onFindingCreated({
        type: "error",
        priority: FindingPriority.Crash,
        title: "Test execution error",
        description: errorMessage,
      });
    }

    events.onTestInteractionRunCompleted({
      testInteractionRunId: testInteractionRun.id,
      passed: isReplayError ? true : false,
    });
  }
}

async function emitLiveScreenshot(
  adapter: BrowserAdapter,
  events: ScanEventHandler,
  pageUrl: string
): Promise<void> {
  try {
    const bytes = await adapter.screenshot({ type: "png" });
    const base64 = Buffer.from(bytes).toString("base64");
    events.onScreenshotCaptured({
      dataUrl: `data:image/png;base64,${base64}`,
      pageUrl,
    });
  } catch {
    // Best effort only.
  }
}

async function mapItemsToScaffolds(
  adapter: BrowserAdapter,
  scaffolds: Array<{
    selector: string;
  }>,
  items: Array<{
    selector: string;
  }>
): Promise<Record<string, string>> {
  const scaffoldSelectors = scaffolds.map(scaffold => scaffold.selector);
  const itemSelectors = items.map(item => item.selector).filter(Boolean);

  if (scaffoldSelectors.length === 0 || itemSelectors.length === 0) {
    return {};
  }

  return adapter.evaluate(
    (...args: unknown[]) => {
      const rawScaffoldSelectors = args[0] as string[];
      const rawItemSelectors = args[1] as string[];
      const assignments: Record<string, string> = {};

      for (const itemSelector of rawItemSelectors) {
        let itemEl: Element | null = null;
        try {
          itemEl = document.querySelector(itemSelector);
        } catch {
          itemEl = null;
        }
        if (!itemEl) continue;

        for (const scaffoldSelector of rawScaffoldSelectors) {
          try {
            if (itemEl.closest(scaffoldSelector)) {
              assignments[itemSelector] = scaffoldSelector;
              break;
            }
          } catch {
            // Ignore invalid selectors and continue matching.
          }
        }
      }

      return assignments;
    },
    scaffoldSelectors,
    itemSelectors
  );
}

function parseStoredSteps(stepsJson: unknown): StoredStep[] {
  if (!Array.isArray(stepsJson)) {
    return [];
  }

  return stepsJson
    .filter((step): step is Partial<StoredStep> => Boolean(step))
    .map(step => ({
      action: {
        actionType:
          typeof step.action?.actionType === "string"
            ? step.action.actionType
            : "waitForTimeout",
        path:
          typeof step.action?.path === "string" ? step.action.path : undefined,
        value:
          typeof step.action?.value === "string"
            ? step.action.value
            : undefined,
        playwrightCode:
          typeof step.action?.playwrightCode === "string"
            ? step.action.playwrightCode
            : "",
        description:
          typeof step.action?.description === "string"
            ? step.action.description
            : "",
      },
      expectations: parseStoredExpectations(step.expectations),
      description: typeof step.description === "string" ? step.description : "",
      continueOnFailure: Boolean(step.continueOnFailure),
    }));
}

function parseStoredExpectations(value: unknown): StoredExpectation[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((expectation): expectation is StoredExpectation =>
    Boolean(
      expectation &&
      typeof expectation === "object" &&
      "expectationType" in expectation &&
      "description" in expectation
    )
  );
}

function buildDependencyChain(
  testInteraction: {
    id: number;
    dependencyTestInteractionId: number | null;
  },
  testInteractionById: Map<
    number,
    {
      id: number;
      dependencyTestInteractionId: number | null;
      stepsJson: unknown;
    }
  >
) {
  const chain: Array<{
    id: number;
    dependencyTestInteractionId: number | null;
    stepsJson: unknown;
  }> = [];
  const seen = new Set<number>();
  let current:
    | {
        id: number;
        dependencyTestInteractionId: number | null;
        stepsJson: unknown;
      }
    | undefined = testInteractionById.get(testInteraction.id);

  while (current) {
    if (seen.has(current.id)) {
      throw new Error(
        `Cyclic test element dependency detected at ${current.id}`
      );
    }
    seen.add(current.id);
    chain.unshift(current);
    current = current.dependencyTestInteractionId
      ? testInteractionById.get(current.dependencyTestInteractionId)
      : undefined;
  }

  return chain;
}

function filterNetworkLogsForStep(
  networkLogs: NetworkLogEntry[],
  startedAtMs: number,
  endedAtMs: number,
  expectations: StoredExpectation[]
): NetworkLogEntry[] {
  const timedEntries = networkLogs.filter(
    entry => typeof entry.timestampMs === "number"
  );
  if (timedEntries.length === 0) {
    return networkLogs;
  }

  const bufferMs = Math.max(
    250,
    ...expectations.map(expectation => expectation.timeoutMs ?? 2000)
  );
  const windowStart = startedAtMs - 100;
  const windowEnd = endedAtMs + bufferMs;

  return timedEntries.filter(entry => {
    const timestampMs = entry.timestampMs ?? 0;
    return timestampMs >= windowStart && timestampMs <= windowEnd;
  });
}

export function buildExpectationEvaluationGroups(params: {
  stepExecutions: StepExecution[];
  generatedExpectations: StoredExpectation[];
  networkLogs: NetworkLogEntry[];
  initialSnapshot: ExecutionSnapshot;
  finalSnapshot: ExecutionSnapshot;
}): ExpectationEvaluationGroup[] {
  const groups = params.stepExecutions
    .filter(stepExecution => (stepExecution.step.expectations?.length ?? 0) > 0)
    .map(stepExecution => ({
      expectations: stepExecution.step.expectations,
      networkLogs: filterNetworkLogsForStep(
        params.networkLogs,
        stepExecution.startedAtMs,
        stepExecution.endedAtMs,
        stepExecution.step.expectations
      ),
      snapshot: normalizeExecutionSnapshot(stepExecution.afterSnapshot),
      previousSnapshot: normalizeExecutionSnapshot(
        stepExecution.beforeSnapshot
      ),
    }));

  if ((params.generatedExpectations?.length ?? 0) > 0) {
    groups.push({
      expectations: params.generatedExpectations,
      networkLogs: params.networkLogs,
      snapshot: normalizeExecutionSnapshot(params.finalSnapshot),
      previousSnapshot: normalizeExecutionSnapshot(params.initialSnapshot),
    });
  }

  return groups;
}

function derivePriority(outcome: Outcome): number {
  const severity = outcome.severity ?? ExpectationSeverity.MustPass;
  if (severity === ExpectationSeverity.MustPass && outcome.result === "error") {
    return FindingPriority.Critical;
  }
  if (
    severity === ExpectationSeverity.ShouldPass &&
    outcome.result === "error"
  ) {
    return FindingPriority.Major;
  }
  if (outcome.result === "warning") {
    return FindingPriority.Minor;
  }
  return FindingPriority.Minor;
}

function derivePageHealthPriority(severity: "error" | "warning"): number {
  return severity === "error" ? FindingPriority.Major : FindingPriority.Minor;
}

function getFindingTypeForOutcome(
  outcome: Outcome
): "warning" | "error" | null {
  if (outcome.result === "pass") {
    return null;
  }

  const severity = outcome.severity ?? ExpectationSeverity.MustPass;
  return severity === ExpectationSeverity.MustPass ? "error" : "warning";
}

function isMustPassFailure(outcome: Outcome): boolean {
  return getFindingTypeForOutcome(outcome) === "error";
}

function isNonBlockingFailure(outcome: Outcome): boolean {
  return getFindingTypeForOutcome(outcome) === "warning";
}

async function maybeRefreshInteractionActions(params: {
  adapter: BrowserAdapter;
  analyzer: PageAnalyzer | null;
  api: ApiClient;
  testRun: TestRunResponse;
  testInteraction: TestInteractionResponse;
  testInteractionRun: TestInteractionRunResponse;
  steps: StoredStep[];
}): Promise<{
  testInteraction: TestInteractionResponse;
  steps: StoredStep[];
} | null> {
  if (!params.analyzer) {
    return null;
  }

  const currentUrl = await params.adapter.getUrl();
  const url = new URL(currentUrl);
  const currentPath = `${url.pathname}${url.search}`;
  const actionableItems = ensureArray(
    await extractActionableItems(params.adapter)
  );

  const appendResult = await params.analyzer.maybeAppendActionToInteraction(
    {
      title: params.testInteraction.title,
      type: params.testInteraction.testType as
        | "navigation"
        | "render"
        | "interaction"
        | "form"
        | "form_negative"
        | "password"
        | "e2e",
      sizeClass: params.testInteraction.sizeClass as "desktop" | "mobile",
      surface_tags: params.testInteraction.surfaceTags ?? [],
      priority: params.testInteraction.priority ?? 0,
      dependencyTestInteractionId:
        params.testInteraction.dependencyTestInteractionId ?? undefined,
      startingPageStateId: params.testInteraction.startingPageStateId ?? 0,
      startingPath: params.testInteraction.startingPath ?? "",
      steps: params.steps as any,
      globalExpectations: parseStoredExpectations(
        params.testInteraction.globalExpectationsJson
      ) as any,
      generatedKey: params.testInteraction.generatedKey ?? undefined,
      uid: params.testInteraction.uid ?? undefined,
    },
    {
      runnerId: params.testRun.runnerId,
      testEnvironmentId: params.testRun.testEnvironmentId ?? undefined,
      sizeClass: params.testRun.sizeClass as "desktop" | "mobile",
      uid: params.testRun.createdByUserId ?? undefined,
      currentTestInteractionId: params.testInteraction.id,
      currentTestSurfaceId: params.testInteraction.testSurfaceId,
      currentSurfaceRunId: params.testInteractionRun.testSurfaceRunId,
      beginningPageStateId: params.testInteraction.startingPageStateId ?? 0,
      currentPath,
      actionableItems,
      api: params.api,
    }
  );

  if (!appendResult.appended) {
    return null;
  }

  const allTestInteractions = await params.api.getTestInteractionsByRunner(
    params.testRun.runnerId
  );
  const reloaded = allTestInteractions.find(
    candidate => candidate.id === params.testInteraction.id
  );
  if (!reloaded) {
    return null;
  }

  return {
    testInteraction: reloaded,
    steps: parseStoredSteps(reloaded.stepsJson),
  };
}

async function executeAction(
  adapter: BrowserAdapter,
  action: {
    actionType: string;
    path?: string;
    value?: string;
    playwrightCode: string;
  },
  testRun: TestRunResponse
): Promise<void> {
  const baseUrl = testRun.scanUrl
    ? new URL(testRun.scanUrl).origin
    : "http://localhost";

  switch (action.actionType) {
    case "goto": {
      const path = action.path ?? "/";
      const url = path.startsWith("http")
        ? path
        : new URL(path, baseUrl).toString();
      await adapter.goto(url, { waitUntil: "networkidle0" });
      break;
    }
    case "reload":
      await adapter.goto(await adapter.getUrl(), { waitUntil: "networkidle0" });
      break;
    case "goBack":
      await adapter.pressKey("Alt+Left");
      break;
    case "goForward":
      await adapter.pressKey("Alt+Right");
      break;
    case "waitForLoadState":
      try {
        await adapter.waitForNavigation({
          waitUntil: "networkidle0",
          timeout: 5000,
        });
      } catch {
        // No navigation pending is fine
      }
      break;
    case "click":
      if (action.path) {
        await adapter.click(action.path);
        if (_clickWaitMs > 0)
          await new Promise(r => setTimeout(r, _clickWaitMs));
        await adapter.waitForNavigation({ timeout: 5000 });
      }
      break;
    case "dblclick":
      if (action.path) {
        await adapter.click(action.path);
        if (_clickWaitMs > 0)
          await new Promise(r => setTimeout(r, _clickWaitMs));
        await adapter.waitForNavigation({ timeout: 5000 });
      }
      break;
    case "fill":
      if (action.path && action.value != null)
        await adapter.type(action.path, action.value);
      break;
    case "type":
      if (action.path && action.value != null)
        await adapter.type(action.path, action.value);
      break;
    case "select":
    case "selectOption":
      if (action.path && action.value != null)
        await adapter.select(action.path, action.value);
      break;
    case "check":
    case "uncheck":
    case "radio_select":
      if (action.path) await adapter.click(action.path);
      break;
    case "hover":
      if (action.path) await adapter.hover(action.path);
      break;
    case "focus":
      if (action.path) await adapter.click(action.path);
      break;
    case "press":
      if (action.value) await adapter.pressKey(action.value);
      break;
    case "screenshot":
      await adapter.screenshot({ type: "png" });
      break;
    case "waitForTimeout":
      await new Promise(resolve =>
        setTimeout(resolve, Number.parseInt(action.value ?? "500", 10) || 500)
      );
      break;
    default:
      break;
  }
}

async function captureExecutionSnapshot(
  adapter: BrowserAdapter
): Promise<ExecutionSnapshot> {
  const html = normalizeHtml(await adapter.content());
  const url = normalizeString(await adapter.getUrl());
  const uiSnapshot = await captureUiSnapshot(adapter);
  const controlStates = ensureArray(await captureControlStates(adapter));

  return {
    html,
    url,
    uiSnapshot,
    controlStates,
  };
}

async function captureExecutionSnapshotSafe(
  adapter: BrowserAdapter,
  fallback: ExecutionSnapshot
): Promise<ExecutionSnapshot> {
  try {
    return await captureExecutionSnapshot(adapter);
  } catch {
    return normalizeExecutionSnapshot(fallback);
  }
}

function ensureArray<T>(value: T[] | null | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function normalizeHtml(value: unknown): string {
  return normalizeString(value);
}

function normalizeExecutionSnapshot(snapshot: SnapshotLike): ExecutionSnapshot {
  return {
    html: normalizeHtml(snapshot?.html),
    url: normalizeString(snapshot?.url),
    uiSnapshot: normalizeUiSnapshot(snapshot?.uiSnapshot),
    controlStates: ensureArray(snapshot?.controlStates),
  };
}

function normalizeUiSnapshot(
  snapshot: Partial<UiSnapshot> | null | undefined
): UiSnapshot {
  const feedbackTexts = Array.isArray(snapshot?.feedbackTexts)
    ? snapshot.feedbackTexts.filter(
        (text): text is string => typeof text === "string"
      )
    : [];

  return {
    activeElementSelector:
      typeof snapshot?.activeElementSelector === "string"
        ? snapshot.activeElementSelector
        : undefined,
    dialogCount:
      typeof snapshot?.dialogCount === "number" ? snapshot.dialogCount : 0,
    toastCount:
      typeof snapshot?.toastCount === "number"
        ? snapshot.toastCount
        : feedbackTexts.length,
    feedbackTexts,
  };
}
