import type { BrowserAdapter } from "../adapter";
import type { ApiClient } from "../api/client";
import {
  ExpectationSeverity,
  FindingPriority,
} from "@sudobility/testomniac_types";
import type {
  EnsureTestRunFindingRequest,
  NetworkLogEntry,
  TestInteractionResponse,
  TestInteractionRunResponse,
  TestRunResponse,
  TestSurfaceResponse,
  TestSurfaceBundleRunResponse,
  ScanNextPageStatePayload,
  ScanNextResponse,
  UserData,
} from "@sudobility/testomniac_types";
import type { ScanEventHandler } from "./types";
import type { Expertise, ExpertiseContext, Outcome } from "../expertise/types";
import type { PageAnalyzer } from "../analyzer";
import { isWithinScopePath } from "../crawler/scope-checker";
import { detectLoginPage } from "../scanner/login-detector";
import { evaluatePageHealth } from "../scanner/page-health-evaluator";
import { extractActionableItems } from "../extractors";
import { extractForms } from "../extractors/form-extractor";
import { captureControlStates } from "../browser/control-snapshot";
import {
  buildReplaySelectorFromDescription,
  isTransientSnapshotSelector,
  parseReplaySelector,
} from "../browser/replay-selector";
import { captureUiSnapshot, type UiSnapshot } from "../browser/ui-snapshot";
import { detectScaffoldRegions } from "../scanner/component-detector";
import { detectPatternsWithInstances } from "../scanner/pattern-detector";
import { settleForRead } from "./settle-for-read";
import { interpolateAction } from "./interpolate-action";
import { computeHashes } from "../browser/page-utils";

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

function describeStepStatus(
  step: StoredStep,
  action: StoredStep["action"]
): string {
  const rawDescription = (step.description || action.description || "").trim();
  const target = describeActionTarget(action.path);

  switch (action.actionType) {
    case "goto":
      return `Navigate to ${action.path ?? target ?? "the target page"}`;
    case "hover":
      return `Hover on ${(target ?? rawDescription) || "the target element"}`;
    case "click":
    case "dblclick":
      return `Click ${(target ?? rawDescription) || "the target element"}`;
    case "fill":
    case "type":
      return `Enter text in ${(target ?? rawDescription) || "the target field"}`;
    case "select":
    case "selectOption":
      return `Select ${action.value ?? "an option"} in ${(target ?? rawDescription) || "the target field"}`;
    case "press":
      return `Press ${action.value ?? "a key"}`;
    case "screenshot":
      return "Capture screenshot";
    case "waitForTimeout":
    case "waitForLoadState":
      return rawDescription || "Wait for the page to settle";
    default:
      return rawDescription || `Run ${action.actionType} action`;
  }
}

function describeActionTarget(path?: string): string | null {
  if (!path) return null;
  const replay = parseReplaySelector(path);
  const parts = [
    replay?.role,
    replay?.accessibleName,
    replay?.textContent,
    replay?.href,
    replay?.testId,
    replay?.id,
  ]
    .filter((part): part is string => Boolean(part?.trim()))
    .map(part => part.trim());
  if (parts.length > 0) return parts.slice(0, 2).join(" ");
  return path.length > 80 ? `${path.slice(0, 77)}...` : path;
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
    /**
     * Scan-scoped set of page-state signatures whose body the server already
     * holds. When a signature is present, the runner sends a hashes-only
     * /scan/next; when absent (first sight this scan), it attaches the body up
     * front so the server can create/decompose without a second round-trip.
     */
    sentPageBodies?: Set<string>;
  },
  scanScopePath?: string,
  loginManager?: import("./login-manager").LoginManager,
  cachedTestInteractions?: TestInteractionResponse[],
  userData?: UserData,
  /**
   * When the loop is driven by /scan/next, the selected interaction and its
   * full dependency chain are handed in directly, so we skip fetching the
   * runner's interaction set just to resolve one row.
   */
  prefetched?: {
    interaction: TestInteractionResponse;
    chain: TestInteractionResponse[];
  }
): Promise<ScanNextResponse | null> {
  const startTime = Date.now();
  const consoleLogs: string[] = [];
  const networkLogs: NetworkLogEntry[] = [];
  let currentPhase = "initialization";

  function publishStatusUpdate(message: string): void {
    // Only emit locally — the runner's debounced flush handles the API call
    events.onStatusUpdate?.({ testRunId: testRun.id, message });
  }

  // Listen for console and network events. `adapter.on` returns an unsubscribe
  // function — capture both and detach them in the finally below. Leaving them
  // attached leaks one console + one response listener per interaction; once
  // past Node's default 10-listener limit each new interaction emits a
  // MaxListenersExceededWarning, which (because it fires the moment the listener
  // is added, before any navigation) lands at the very head of this
  // interaction's consoleLog — making every interaction "start with the same
  // thing." Detaching keeps each interaction's logs scoped to itself.
  const detachConsole = adapter.on("console", (...args: unknown[]) => {
    consoleLogs.push(String(args[0] ?? ""));
  });
  const detachResponse = adapter.on("response", (...args: unknown[]) => {
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
    let testInteraction: TestInteractionResponse;
    let dependencyChain: Array<{
      id: number;
      dependencyTestInteractionId: number | null;
      stepsJson: unknown;
    }>;
    if (prefetched) {
      // Fast path: interaction + chain delivered by /scan/next.
      testInteraction = prefetched.interaction;
      dependencyChain = prefetched.chain;
    } else {
      const allTestInteractions =
        cachedTestInteractions ??
        (await api.getTestInteractionsByRunner(testRun.runnerId));
      const testInteractionById = new Map(
        allTestInteractions.map(ti => [ti.id, ti])
      );
      const loadedTestInteraction = testInteractionById.get(
        testInteractionRun.testInteractionId
      );
      if (!loadedTestInteraction) {
        throw new Error(
          `Test case ${testInteractionRun.testInteractionId} not found`
        );
      }
      testInteraction = loadedTestInteraction;
      dependencyChain = buildDependencyChain(
        testInteraction,
        testInteractionById
      );
    }
    publishStatusUpdate(`Running interaction: ${testInteraction.title}`);
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
      publishStatusUpdate(`Navigate to ${absoluteUrl}`);
      await adapter.goto(absoluteUrl, { waitUntil: "load" });
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
        return null;
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
          await executeAction(
            adapter,
            interpolateAction(replayAction, userData),
            testRun
          );
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
    // Skip per-step before/after snapshots when no step has an expectation
    // (recomputed after a mid-loop action refresh). The final decomposition
    // snapshot is still captured unconditionally below.
    let needsStepSnapshots = interactionNeedsStepSnapshots(steps);

    currentPhase = "executing-steps";
    // Execute test actions
    for (let stepIndex = 0; stepIndex < steps.length; stepIndex += 1) {
      const step = steps[stepIndex];
      const replayAction = prepareActionForReplay(step.action);
      const startedAtMs = Date.now();
      const beforeSnapshot = previousSnapshot;
      currentPhase = `executing-step:${replayAction.actionType}`;
      publishStatusUpdate(describeStepStatus(step, replayAction));
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
        await executeAction(
          adapter,
          interpolateAction(replayAction, userData),
          testRun
        );
        // Close any new tabs/windows opened by the action (e.g. target="_blank")
        if (adapter.closeOtherTabs) {
          await adapter.closeOtherTabs();
        }
        const afterSnapshot = needsStepSnapshots
          ? await captureExecutionSnapshot(adapter)
          : previousSnapshot;
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
          needsStepSnapshots = interactionNeedsStepSnapshots(steps);
          logExecutor("interaction:steps-reloaded", {
            testInteractionRunId: testInteractionRun.id,
            testInteractionId: testInteraction.id,
            completedStepIndex: stepIndex,
            stepsCount: steps.length,
          });
        }
      } catch (error) {
        const afterSnapshot = needsStepSnapshots
          ? await captureExecutionSnapshotSafe(adapter, beforeSnapshot)
          : beforeSnapshot;
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
          needsStepSnapshots = interactionNeedsStepSnapshots(steps);
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
    await settleForRead(adapter);
    const html = normalizeHtml(await readPageHtml(adapter));
    const scaffolds = ensureArray(await detectScaffoldRegions(adapter));
    const patterns = ensureArray(await detectPatternsWithInstances(adapter));
    const items = ensureArray(await extractActionableItems(adapter));
    const forms = ensureArray(await extractForms(adapter));
    const finalUiSnapshot = normalizeUiSnapshot(
      await captureUiSnapshot(adapter)
    );
    const finalControlStates = ensureArray(await captureControlStates(adapter));
    const currentUrl = await adapter.getUrl();
    const currentUrlParsed = new URL(currentUrl);
    const currentPath = `${currentUrlParsed.pathname}${currentUrlParsed.search}`;
    const findingPath = currentUrlParsed.pathname;

    // Flag abnormally slow steps — a step taking >10s likely indicates a page
    // freeze or unresponsive interaction (e.g. currency dropdown crash).
    const SLOW_STEP_THRESHOLD_MS = 10_000;
    for (const exec of stepExecutions) {
      const stepDuration = exec.endedAtMs - exec.startedAtMs;
      if (stepDuration > SLOW_STEP_THRESHOLD_MS) {
        const stepDesc =
          exec.step.action?.description ??
          exec.step.action?.actionType ??
          "unknown";
        await api.ensureTestRunFinding({
          testRunId: testRun.id,
          testInteractionRunId: testInteractionRun.id,
          type: "warning",
          priority: 2,
          title: `[tester] Interaction step took ${Math.round(stepDuration / 1000)}s`,
          description: `Step "${stepDesc}" took ${stepDuration}ms — possible page freeze or performance issue`,
          path: findingPath,
        });
        break;
      }
    }

    // Capture this frame's screenshot ONCE and reuse it for both the live
    // side-panel emit and the page-state upload below (same frame — no
    // navigation happens between here and the upload).
    let sharedScreenshot: Uint8Array | undefined;
    try {
      sharedScreenshot = await adapter.screenshot({ type: "png" });
    } catch {
      sharedScreenshot = undefined;
    }
    await emitLiveScreenshot(adapter, events, currentUrl, sharedScreenshot);
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
    let reported404Path: string | null = null;
    const findingItems: EnsureTestRunFindingRequest[] = [];
    const pendingFindingEvents: Array<{
      type: string;
      priority: number;
      title: string;
      description: string;
    }> = [];
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

        for (const outcome of outcomes) {
          const findingType = getFindingTypeForOutcome(outcome);
          if (findingType) {
            const findingTitle = `[${expertise.name}] ${outcome.expected}`;

            // Suppress network-error finding when a 404 page-load error
            // was already reported for the same path
            if (
              reported404Path === findingPath &&
              outcome.expected.includes("No network errors") &&
              outcome.observed.includes("404")
            ) {
              continue;
            }

            if (
              (await analyzer?.hasReportedPageFinding(
                currentPath,
                findingTitle,
                outcome.observed
              )) ||
              (await analyzer?.hasReportedDescription(outcome.observed))
            ) {
              continue;
            }
            const priority = derivePriority(outcome);
            findingItems.push({
              testRunId: testRun.id,
              testInteractionRunId: testInteractionRun.id,
              type: findingType,
              priority,
              title: findingTitle,
              description: outcome.observed,
              path: findingPath,
            });
            pendingFindingEvents.push({
              type: findingType,
              priority,
              title: findingTitle,
              description: outcome.observed,
            });
            await analyzer?.markPageFindingReported(
              currentPath,
              findingTitle,
              outcome.observed
            );
            await analyzer?.markReportedDescription(outcome.observed);

            // Track 404 page-load errors to suppress redundant network-error
            if (
              outcome.result === "error" &&
              outcome.observed.includes("Page returned HTTP 404")
            ) {
              reported404Path = findingPath;
            }
          }
        }
      }
    }
    // Findings will be batched into the combinedNext call below
    const allFindingItems = [...findingItems];
    for (const evt of pendingFindingEvents) {
      events.onFindingCreated(evt);
    }

    // Page health evaluation — browser-side checks for broken images, overlaps, etc.
    // These are page-scoped: the same broken images and overlaps will be found
    // by every interaction on the same page.  Deduplicate via the analyzer so
    // each unique issue is reported only once per page path per run.
    //
    // Skip page-health entirely when the page returned a 404 — the checks
    // would describe the error page layout, not the intended page content.
    //
    // Page-health titles include variable counts ("5 broken image(s)") and
    // descriptions include variable element lists, so text-based dedup is
    // unreliable.  Use the stable issue.type + page path as the primary key.
    currentPhase = "evaluating-page-health";
    if (reported404Path === findingPath) {
      logExecutor("page-health:skipped-404", {
        testRunId: testRun.id,
        currentPath,
      });
    } else
      try {
        const healthIssues = await evaluatePageHealth(adapter);
        const healthFindingItems: EnsureTestRunFindingRequest[] = [];
        const healthFindingEvents: Array<{
          type: string;
          priority: number;
          title: string;
          description: string;
        }> = [];
        for (const issue of healthIssues) {
          // Key on the query-less path (the same value stored as the finding's
          // `path`), NOT currentPath which includes ?query. Store sites reach
          // the same page via many query variants (?pricepoint, ?perpage, sort);
          // keying on currentPath re-reported identical page-health findings for
          // every variant. Page-health issues are template/content level, so the
          // path is the right dedup granularity.
          const healthKey = `page-health:${issue.type}:${findingPath}`;
          if (await analyzer?.hasReportedFindingByKey(healthKey)) {
            continue;
          }
          const findingTitle = `[page-health] ${issue.title}`;
          const findingType = issue.severity === "error" ? "error" : "warning";
          const priority = derivePageHealthPriority(issue.severity);
          healthFindingItems.push({
            testRunId: testRun.id,
            testInteractionRunId: testInteractionRun.id,
            type: findingType,
            priority,
            title: findingTitle,
            description: issue.description,
            path: findingPath,
          });
          healthFindingEvents.push({
            type: findingType,
            priority,
            title: findingTitle,
            description: issue.description,
          });
          await analyzer?.markReportedFindingByKey(healthKey);
        }
        allFindingItems.push(...healthFindingItems);
        for (const evt of healthFindingEvents) {
          events.onFindingCreated(evt);
        }
      } catch (healthError) {
        logExecutor("page-health:error", {
          testRunId: testRun.id,
          currentPath,
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

    currentPhase = "completing-interaction-run";
    publishStatusUpdate(`Recording results for ${testInteraction.title}`);

    currentPhase = "completing-interaction-and-generating";
    const durationMs = Date.now() - startTime;

    // Prepare pageState data for server-side generation (discovery mode only)
    let pageStatePayload: ScanNextPageStatePayload | undefined;
    if (analyzer && discoveryContext) {
      const currentUrl = await adapter.getUrl();
      const url = new URL(currentUrl);
      const currentPath = `${url.pathname}${url.search}`;

      // Detect if this is a login page (browser-side)
      const loginDetection = await detectLoginPage(
        adapter,
        currentPath,
        ensureArray(forms)
      );

      // Capture and upload screenshot for page state
      let screenshotPath: string | undefined;
      try {
        const screenshotBytes =
          sharedScreenshot ?? (await adapter.screenshot({ type: "png" }));
        const safePath = currentPath.replace(/[^a-zA-Z0-9_/-]/g, "_");
        const filename = `screenshots/${testRun.runnerId}/${safePath.replace(/^\//, "") || "root"}-${Date.now()}.png`;
        const uploaded = await api.uploadScreenshot(screenshotBytes, filename);
        screenshotPath = uploaded.path;
      } catch (err) {
        logExecutor("screenshot-upload:failed", {
          testRunId: testRun.id,
          runnerId: testRun.runnerId,
          currentPath,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      // Real content hashes so the server can dedup the page state (and decide
      // whether it needs the body) without ever rehashing — and without us
      // shipping the HTML on every call. See the two-phase scanNext below.
      const fullHtml = normalizeHtml(html);
      const pageHashes = await computeHashes(fullHtml, ensureArray(items));

      pageStatePayload = {
        pageId: 0,
        relativePath: currentPath,
        screenshotPath,
        html: fullHtml,
        // contentText is omitted: it is the markdown projection of `html`, so
        // shipping both duplicates the page content. The server derives it from
        // `html` when persisting the page state.
        hashes: pageHashes,
        actionableItems: ensureArray(items),
        scaffolds: scaffolds.map(s => ({
          type: s.type,
          html: s.outerHtml,
          hash: s.hash,
          selector: s.selector,
        })),
        scaffoldSelectorByItemSelector,
        forms: ensureArray(forms).map(f => ({ form: f })),
        currentTestInteractionId: testInteraction.id,
        beginningPageStateId,
        journeySteps: ensureArray(journeySteps) as any,
        siteOrigin: currentUrlParsed.origin,
        scanScopePath,
        loginDetection,
        loginConfig: loginManager ? loginManager.getConfig() : undefined,
      };
    }

    // Single call: complete interaction + persist findings + page state + generators + get next
    //
    // PERFORMANCE — content-addressed page body. The full page HTML (and every
    // scaffold body) is the bulk of this payload, but the server only needs it
    // when it must CREATE or DECOMPOSE the page state. On revisits — the common
    // case in a scan — the hashes alone resolve the existing state. So we send a
    // hashes-only payload first; if the server replies `needHtml`, we resend the
    // same request with the body attached. The body therefore crosses the wire
    // once per unique page state instead of on every interaction.
    const stripBody = (
      ps: ScanNextPageStatePayload
    ): ScanNextPageStatePayload => ({
      ...ps,
      html: undefined,
      contentText: undefined,
      scaffolds: ps.scaffolds.map(s => ({ ...s, html: undefined })),
    });

    const buildScanNextRequest = (
      pageState: ScanNextPageStatePayload | undefined
    ) => ({
      runnerId: testRun.runnerId,
      testRunId: testRun.id,
      bundleRunId: testRun.testSurfaceBundleRunId ?? 0,
      testSurfaceBundleId: discoveryContext?.bundleRun.testSurfaceBundleId ?? 0,
      sizeClass: testRun.sizeClass as any,
      testEnvironmentId: testRun.testEnvironmentId ?? undefined,
      completion: {
        testInteractionRunId: testInteractionRun.id,
        testInteractionId: testInteraction.id,
        testSurfaceId: testInteraction.testSurfaceId,
        surfaceRunId: testInteractionRun.testSurfaceRunId,
        status,
        durationMs,
        expectedOutcome: expectedOutcome || undefined,
        observedOutcome: observedOutcome || undefined,
        screenshotPath: pageStatePayload?.screenshotPath,
        consoleLog:
          hasErrors || hasWarnings
            ? consoleLogs.join("\n") || undefined
            : undefined,
        networkLog:
          hasErrors || hasWarnings
            ? JSON.stringify(networkLogs) || undefined
            : undefined,
      },
      pageState,
      findings: allFindingItems.length > 0 ? allFindingItems : undefined,
    });

    // Signature identifying this page state's body. If the server is known to
    // already hold it (sent earlier this scan), we strip the body up front;
    // otherwise we attach it pre-emptively so a first visit needs only one call.
    const pageBodyCache = discoveryContext?.sentPageBodies;
    const bodyKey = pageStatePayload
      ? [
          pageStatePayload.hashes.htmlHash,
          pageStatePayload.hashes.normalizedHtmlHash,
          pageStatePayload.hashes.textHash,
          pageStatePayload.hashes.actionableHash,
        ].join("|")
      : null;
    const serverHasBody =
      bodyKey != null && pageBodyCache?.has(bodyKey) === true;

    let scanResult = await api.scanNext(
      buildScanNextRequest(
        !pageStatePayload
          ? undefined
          : serverHasBody
            ? stripBody(pageStatePayload)
            : pageStatePayload
      )
    );
    // Safety net: a stripped first attempt the server couldn't resolve (cache
    // wrong, e.g. server restart) comes back as needHtml — resend with the body.
    if (scanResult.needHtml && pageStatePayload) {
      scanResult = await api.scanNext(buildScanNextRequest(pageStatePayload));
    }
    // After a clean response the server holds this body; remember it so the rest
    // of the scan sends hashes only.
    if (bodyKey && pageBodyCache && !scanResult.needHtml) {
      pageBodyCache.add(bodyKey);
    }

    events.onTestInteractionRunCompleted({
      testInteractionRunId: testInteractionRun.id,
      passed: !hasErrors,
    });

    // Emit events from the combined response
    if (scanResult.pageState && scanResult.pageState.pageId > 0) {
      events.onPageFound({
        relativePath: pageStatePayload?.relativePath ?? "",
        pageId: scanResult.pageState.pageId,
      });
    }
    for (const surface of scanResult.generatedSurfaces) {
      events.onTestSurfaceCreated(surface);
    }

    logExecutor("interaction:combined-next-complete", {
      testInteractionRunId: testInteractionRun.id,
      testInteractionId: testInteraction.id,
      surfacesCreated: scanResult.created.surfaces,
      interactionsCreated: scanResult.created.interactions,
      findingsCreated: scanResult.created.findings,
      hasNext: scanResult.next != null,
    });

    return scanResult;
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const detail =
      error instanceof Error
        ? error.stack || error.message
        : typeof error === "string"
          ? error
          : JSON.stringify(error);
    const errorMessage = `Phase: ${currentPhase}\n${detail}`;

    // Infrastructure issues that are not bugs in the app under test.  Mark the
    // interaction as skipped rather than creating a noisy finding.
    // Use the raw error text (not instanceof Error) because Chrome extension
    // API rejections are sometimes plain objects, not Error instances.
    const errorText =
      error instanceof Error
        ? error.message
        : typeof error === "string"
          ? error
          : String(error);
    const isReplayError =
      errorText.includes("Element not found") ||
      errorText.includes("Could not resolve clickable point") ||
      (errorText.includes("Frame with ID") &&
        errorText.includes("was removed")) ||
      errorText.includes("Cannot access a chrome-extension://") ||
      errorText.includes("Cannot access contents of") ||
      errorText.includes("Debugger is not attached") ||
      errorText.includes("No tab with id") ||
      errorText.includes("non-web page") ||
      errorText.includes("Inspected target navigated or closed") ||
      errorText.includes("Page has no meaningful content after load");

    await api.completeTestInteractionRun(testInteractionRun.id, {
      status: isReplayError ? "skipped" : "failed",
      status_update: `${isReplayError ? "Skipped" : "Failed"} interaction: ${testInteractionRun.testInteractionId}`,
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
      let errorPath: string | undefined;
      try {
        errorPath = new URL(await adapter.getUrl()).pathname;
      } catch {
        // URL may not be available after crash
      }
      await api.ensureTestRunFinding({
        testRunId: testRun.id,
        testInteractionRunId: testInteractionRun.id,
        type: "error",
        priority: FindingPriority.Crash,
        title: `Test execution error`,
        description: errorMessage,
        path: errorPath,
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

    // No scan result on the error path — the loop falls back to a full state
    // read to choose the next interaction.
    return null;
  } finally {
    // Detach this interaction's console/response listeners so they don't
    // accumulate across the scan (see the capture site above).
    if (typeof detachConsole === "function") detachConsole();
    if (typeof detachResponse === "function") detachResponse();
  }
}

/** Convert Uint8Array to base64 without Node.js Buffer (works in browser + Node). */
function uint8ArrayToBase64(bytes: Uint8Array): string {
  // Use Buffer if available (Node.js), otherwise browser-compatible approach
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export async function emitLiveScreenshot(
  adapter: BrowserAdapter,
  events: ScanEventHandler,
  pageUrl: string,
  preCaptured?: Uint8Array
): Promise<void> {
  try {
    const bytes = preCaptured ?? (await adapter.screenshot({ type: "png" }));
    const base64 = uint8ArrayToBase64(bytes);
    events.onScreenshotCaptured({
      dataUrl: `data:image/png;base64,${base64}`,
      pageUrl,
    });
  } catch (err) {
    logExecutor("live-screenshot:failed", {
      pageUrl: adapter.url(),
      error: err instanceof Error ? err.message : String(err),
    });
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

      // Warn at most once per unique invalid selector. The inner loop runs
      // (items x scaffolds) times, so an invalid selector previously logged
      // hundreds of identical warnings into the persisted console log.
      const warnedSelectors = new Set<string>();
      const warnInvalid = (kind: string, selector: string, err: unknown) => {
        if (warnedSelectors.has(selector)) return;
        warnedSelectors.add(selector);
        console.warn(
          `[scaffold-mapping] invalid ${kind} selector:`,
          selector,
          String(err)
        );
      };

      // Pre-filter scaffold selectors to the ones that are valid CSS so the
      // hot inner loop never re-attempts (and re-throws on) a bad selector.
      const validScaffoldSelectors: string[] = [];
      for (const scaffoldSelector of rawScaffoldSelectors) {
        try {
          document.querySelector(scaffoldSelector);
          validScaffoldSelectors.push(scaffoldSelector);
        } catch (err) {
          warnInvalid("scaffold", scaffoldSelector, err);
        }
      }

      for (const itemSelector of rawItemSelectors) {
        let itemEl: Element | null = null;
        try {
          itemEl = document.querySelector(itemSelector);
        } catch (err) {
          warnInvalid("item", itemSelector, err);
          itemEl = null;
        }
        if (!itemEl) continue;

        for (const scaffoldSelector of validScaffoldSelectors) {
          if (itemEl.closest(scaffoldSelector)) {
            assignments[itemSelector] = scaffoldSelector;
            break;
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

  const reloaded = await params.api.getTestInteraction(
    params.testInteraction.id
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
      await adapter.goto(url, { waitUntil: "load" });
      break;
    }
    case "reload":
      await adapter.goto(await adapter.getUrl(), { waitUntil: "load" });
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
          waitUntil: "load",
          timeout: 5000,
        });
      } catch {
        // No navigation pending is fine
        logExecutor("wait-load-state:timeout", { step: "action-execution" });
      }
      break;
    case "click":
      if (action.path) {
        // Skip clicking non-browser links (mailto:, tel:, etc.) to avoid
        // launching external applications that cannot be controlled.
        const clickMeta = parseReplaySelector(action.path);
        if (
          clickMeta?.href &&
          /^(?!https?:)[a-z][a-z0-9+.-]*:/i.test(clickMeta.href)
        ) {
          logExecutor("click:skipped-non-browser-link", {
            href: clickMeta.href,
            path: action.path,
          });
          break;
        }
        await adapter.click(action.path);
        await settleForRead(adapter);
        await adapter.waitForNavigation({ timeout: 5000 });
      }
      break;
    case "dblclick":
      if (action.path) {
        await adapter.click(action.path);
        await settleForRead(adapter);
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

/**
 * Per-step before/after snapshots are only consumed by step-level expectation
 * evaluation (buildExpectationEvaluationGroups). When no step carries an
 * expectation (typical for navigation/render interactions), capturing them is
 * wasted work — the final decomposition snapshot is captured independently.
 */
export function interactionNeedsStepSnapshots(
  steps: Array<{ expectations?: unknown[] }>
): boolean {
  return steps.some(
    s => Array.isArray(s.expectations) && s.expectations.length > 0
  );
}

/** Read page HTML via the batched capturePageSnapshot seam when available. */
export async function readPageHtml(adapter: BrowserAdapter): Promise<string> {
  if (adapter.capturePageSnapshot) {
    const snap = await adapter.capturePageSnapshot();
    return snap.html;
  }
  return adapter.content();
}

async function captureExecutionSnapshot(
  adapter: BrowserAdapter
): Promise<ExecutionSnapshot> {
  await settleForRead(adapter);
  const html = normalizeHtml(await readPageHtml(adapter));
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
