import type { BrowserAdapter } from "../adapter";
import type { ApiClient } from "../api/client";
import { ExpectationSeverity } from "@sudobility/testomniac_types";
import type {
  NetworkLogEntry,
  TestElementRunResponse,
  TestRunResponse,
  TestSurfaceResponse,
  TestSurfaceBundleRunResponse,
} from "@sudobility/testomniac_types";
import type { ScanEventHandler } from "./types";
import type { Expertise, ExpertiseContext, Outcome } from "../expertise/types";
import type { PageAnalyzer, AnalyzerContext } from "../analyzer";
import { extractActionableItems } from "../extractors";
import { extractForms } from "../extractors/form-extractor";
import { captureControlStates } from "../browser/control-snapshot";
import { captureUiSnapshot, type UiSnapshot } from "../browser/ui-snapshot";
import { detectScaffoldRegions } from "../scanner/component-detector";
import { detectPatternsWithInstances } from "../scanner/pattern-detector";

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

/**
 * Execute a single test element: run actions, decompose page, evaluate expertises,
 * set outcomes, create findings, and optionally discover new test elements.
 */
export async function executeTestElement(
  adapter: BrowserAdapter,
  testElementRun: TestElementRunResponse,
  testRun: TestRunResponse,
  expertises: Expertise[],
  analyzer: PageAnalyzer | null,
  api: ApiClient,
  events: ScanEventHandler,
  discoveryContext?: {
    navigationSurface: TestSurfaceResponse;
    bundleRun: TestSurfaceBundleRunResponse;
  }
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
    currentPhase = "loading-test-elements";
    const allTestElements = await api.getTestElementsByRunner(testRun.runnerId);
    const testElementById = new Map(
      allTestElements.map(testElement => [testElement.id, testElement])
    );
    const testElement = testElementById.get(testElementRun.testElementId);
    if (!testElement) {
      throw new Error(`Test case ${testElementRun.testElementId} not found`);
    }

    // Parse steps from JSON
    const steps = parseStoredSteps(testElement.stepsJson);
    const dependencyChain = buildDependencyChain(testElement, testElementById);
    const setupCases = dependencyChain.slice(0, -1);
    const journeySteps = dependencyChain.flatMap(item =>
      parseStoredSteps(item.stepsJson)
    );

    // Record beginning page state
    const _beginningUrl = await adapter.getUrl();
    const beginningPageStateId = testElement.startingPageStateId ?? 0;

    // Navigate to starting path if needed
    if (testElement.startingPath) {
      const baseUrl = testRun.scanUrl
        ? new URL(testRun.scanUrl).origin
        : "http://localhost";
      const absoluteUrl = testElement.startingPath.startsWith("http")
        ? testElement.startingPath
        : new URL(testElement.startingPath, baseUrl).toString();
      await adapter.goto(absoluteUrl, { waitUntil: "networkidle0" });
    }

    // Recreate the dependent target state before running this case itself.
    for (const setupCase of setupCases) {
      const setupSteps = parseStoredSteps(setupCase.stepsJson);
      for (const step of setupSteps) {
        await executeAction(adapter, step.action, testRun);
      }
    }

    currentPhase = "capturing-initial-snapshot";
    const initialSnapshot = await captureExecutionSnapshot(adapter);
    const stepExecutions: StepExecution[] = [];
    let previousSnapshot = initialSnapshot;

    currentPhase = "executing-steps";
    // Execute test actions
    for (const step of steps) {
      const startedAtMs = Date.now();
      const beforeSnapshot = previousSnapshot;
      try {
        await executeAction(adapter, step.action, testRun);
        const afterSnapshot = await captureExecutionSnapshot(adapter);
        previousSnapshot = afterSnapshot;
        stepExecutions.push({
          step,
          startedAtMs,
          endedAtMs: Date.now(),
          beforeSnapshot,
          afterSnapshot,
        });
      } catch (error) {
        const afterSnapshot = await captureExecutionSnapshotSafe(
          adapter,
          beforeSnapshot
        );
        previousSnapshot = afterSnapshot;
        stepExecutions.push({
          step,
          startedAtMs,
          endedAtMs: Date.now(),
          beforeSnapshot,
          afterSnapshot,
        });
        if (!step.continueOnFailure) {
          throw error;
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
    const scaffoldSelectorByItemSelector = await mapItemsToScaffolds(
      adapter,
      scaffolds,
      items
    );

    // Parse global expectations
    const globalExpectations = parseStoredExpectations(
      testElement.globalExpectationsJson
    );
    const stepExpectations = steps.flatMap(step => step.expectations ?? []);

    // If discovery mode: generate baseline expectations
    let expectations = [...stepExpectations, ...globalExpectations];
    if (analyzer && testElement.stepsJson) {
      const parsedTestElement = {
        title: testElement.title,
        type: testElement.testType as
          | "navigation"
          | "render"
          | "interaction"
          | "form"
          | "form_negative"
          | "password"
          | "e2e",
        sizeClass: testElement.sizeClass as "desktop" | "mobile",
        surface_tags: testElement.surfaceTags,
        priority: testElement.priority,
        startingPageStateId: testElement.startingPageStateId ?? 0,
        startingPath: testElement.startingPath ?? "",
        steps: steps as any,
        globalExpectations: globalExpectations as any,
      };
      const generated = analyzer.generateExpectations(parsedTestElement);
      expectations = [...expectations, ...generated];
    }

    const currentUrl = await adapter.getUrl();
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
      startingPath: testElement.startingPath ?? undefined,
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
            await api.createTestRunFinding({
              testElementRunId: testElementRun.id,
              type: findingType,
              title: `[${expertise.name}] ${outcome.expected}`,
              description: outcome.observed,
            });
            events.onFindingCreated({
              type: findingType,
              title: `[${expertise.name}] ${outcome.expected}`,
            });
          }
        }
      }
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
    await api.clearSupersededFindings(testElementRun.id);

    // Complete test element run
    const durationMs = Date.now() - startTime;
    await api.completeTestElementRun(testElementRun.id, {
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

    events.onTestElementRunCompleted({
      testElementRunId: testElementRun.id,
      passed: !hasErrors,
    });

    // If discovery mode: generate new test elements
    currentPhase = "discovering-follow-up-tests";
    if (analyzer && discoveryContext) {
      const currentUrl = await adapter.getUrl();
      const url = new URL(currentUrl);
      const currentPath = `${url.pathname}${url.search}`;

      const page = await api.findOrCreatePage(testRun.runnerId, currentPath);
      events.onPageFound({
        relativePath: currentPath,
        pageId: page.id,
      });

      const analyzerCtx: AnalyzerContext = {
        runnerId: testRun.runnerId,
        sizeClass: testRun.sizeClass as "desktop" | "mobile",
        uid: testRun.createdByUserId ?? undefined,
        currentTestElementId: testElement.id,
        currentTestSurfaceId: testElement.testSurfaceId,
        currentSurfaceRunId: testElementRun.testSurfaceRunId,
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
      };

      const parsedTestElement = {
        title: testElement.title,
        type: testElement.testType as any,
        sizeClass: testElement.sizeClass as any,
        surface_tags: testElement.surfaceTags,
        priority: testElement.priority,
        startingPageStateId: testElement.startingPageStateId ?? 0,
        startingPath: testElement.startingPath ?? "",
        steps: steps as any,
        globalExpectations: globalExpectations as any,
      };

      await analyzer.generateTestElements(parsedTestElement, analyzerCtx);
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

    await api.completeTestElementRun(testElementRun.id, {
      status: "failed",
      durationMs,
      errorMessage,
      consoleLog: consoleLogs.join("\n") || undefined,
      networkLog: JSON.stringify(networkLogs) || undefined,
    });

    await api.createTestRunFinding({
      testElementRunId: testElementRun.id,
      type: "error",
      title: `Test execution error`,
      description: errorMessage,
    });

    events.onFindingCreated({ type: "error", title: "Test execution error" });
    events.onTestElementRunCompleted({
      testElementRunId: testElementRun.id,
      passed: false,
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
  testElement: {
    id: number;
    dependencyTestElementId: number | null;
  },
  testElementById: Map<
    number,
    {
      id: number;
      dependencyTestElementId: number | null;
      stepsJson: unknown;
    }
  >
) {
  const chain: Array<{
    id: number;
    dependencyTestElementId: number | null;
    stepsJson: unknown;
  }> = [];
  const seen = new Set<number>();
  let current:
    | {
        id: number;
        dependencyTestElementId: number | null;
        stepsJson: unknown;
      }
    | undefined = testElementById.get(testElement.id);

  while (current) {
    if (seen.has(current.id)) {
      throw new Error(
        `Cyclic test element dependency detected at ${current.id}`
      );
    }
    seen.add(current.id);
    chain.unshift(current);
    current = current.dependencyTestElementId
      ? testElementById.get(current.dependencyTestElementId)
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
      if (action.path) await adapter.click(action.path);
      break;
    case "dblclick":
      if (action.path) await adapter.click(action.path); // adapter may not support dblclick
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
