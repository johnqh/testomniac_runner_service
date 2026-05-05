import type { BrowserAdapter } from "../adapter";
import type { ApiClient } from "../api/client";
import type {
  TestCaseRunResponse,
  TestRunResponse,
  TestSuiteResponse,
  TestSuiteBundleRunResponse,
} from "@sudobility/testomniac_types";
import type { ScanEventHandler } from "./types";
import type { Expertise, ExpertiseContext, Outcome } from "../expertise/types";
import type { PageAnalyzer, AnalyzerContext } from "../analyzer";
import { extractActionableItems } from "../extractors";
import { computeHashes } from "../browser/page-utils";
import { detectScaffoldRegions } from "../scanner/component-detector";
import { detectPatternsWithInstances } from "../scanner/pattern-detector";

/**
 * Execute a single test case: run actions, decompose page, evaluate expertises,
 * set outcomes, create findings, and optionally discover new test cases.
 */
export async function executeTestCase(
  adapter: BrowserAdapter,
  testCaseRun: TestCaseRunResponse,
  testRun: TestRunResponse,
  expertises: Expertise[],
  analyzer: PageAnalyzer | null,
  api: ApiClient,
  events: ScanEventHandler,
  discoveryContext?: {
    navigationSuite: TestSuiteResponse;
    bundleRun: TestSuiteBundleRunResponse;
  }
): Promise<void> {
  const startTime = Date.now();
  const consoleLogs: string[] = [];
  const networkLogs: {
    method: string;
    url: string;
    status: number;
    contentType: string;
  }[] = [];

  // Listen for console and network events
  adapter.on("console", (...args: unknown[]) => {
    consoleLogs.push(String(args[0] ?? ""));
  });
  adapter.on("response", (...args: unknown[]) => {
    const entry = args[0] as {
      url: string;
      status: number;
      contentType?: string;
    };
    if (entry && typeof entry.url === "string") {
      networkLogs.push({
        method: "GET",
        url: entry.url,
        status: entry.status,
        contentType: entry.contentType ?? "",
      });
    }
  });

  try {
    const tc = await api.getTestCasesByRunner(testRun.runnerId);
    const testCase = tc.find(c => c.id === testCaseRun.testCaseId);
    if (!testCase) {
      throw new Error(`Test case ${testCaseRun.testCaseId} not found`);
    }

    // Parse steps from JSON
    const steps =
      (testCase.stepsJson as Array<{
        action: {
          actionType: string;
          path?: string;
          value?: string;
          playwrightCode: string;
          description: string;
        };
        expectations: Array<{
          expectationType: string;
          expectedValue?: string;
          severity: string;
          description: string;
          playwrightCode: string;
        }>;
        description: string;
        continueOnFailure: boolean;
      }>) ?? [];

    // Record beginning page state
    const _beginningUrl = await adapter.getUrl();
    const beginningPageStateId = testCase.startingPageStateId ?? 0;

    // Navigate to starting path if needed
    if (testCase.startingPath) {
      const baseUrl = testRun.scanUrl
        ? new URL(testRun.scanUrl).origin
        : "http://localhost";
      const absoluteUrl = testCase.startingPath.startsWith("http")
        ? testCase.startingPath
        : new URL(testCase.startingPath, baseUrl).toString();
      await adapter.goto(absoluteUrl, { waitUntil: "networkidle0" });
    }

    // Execute test actions
    for (const step of steps) {
      await executeAction(adapter, step.action, testRun);
    }

    // Decompose the page using local detectors
    const html = await adapter.content();
    const scaffolds = await detectScaffoldRegions(adapter);
    const patterns = await detectPatternsWithInstances(adapter);
    const items = await extractActionableItems(adapter);

    // Parse global expectations
    const globalExpectations =
      (testCase.globalExpectationsJson as Array<{
        expectationType: string;
        elementIdentityId?: number;
        expectedValue?: string;
        attributeName?: string;
        severity: string;
        description: string;
        playwrightCode: string;
      }>) ?? [];

    // If discovery mode: generate baseline expectations
    let expectations = [...globalExpectations];
    if (analyzer && testCase.stepsJson) {
      const parsedTestCase = {
        title: testCase.title,
        type: testCase.testType as
          | "navigation"
          | "render"
          | "interaction"
          | "form"
          | "form_negative"
          | "password"
          | "e2e",
        sizeClass: testCase.sizeClass as "desktop" | "mobile",
        suite_tags: testCase.suiteTags,
        priority: testCase.priority,
        startingPageStateId: testCase.startingPageStateId ?? 0,
        startingPath: testCase.startingPath ?? "",
        steps: steps as any,
        globalExpectations: globalExpectations as any,
      };
      const generated = analyzer.generateExpectations(parsedTestCase);
      expectations = [...expectations, ...generated];
    }

    // Build expertise context
    const expertiseContext: ExpertiseContext = {
      html,
      scaffolds,
      patterns,
      consoleLogs,
      networkLogs,
      expectations: expectations as any,
    };

    // Evaluate all expertises
    const allOutcomes: Outcome[] = [];
    for (const expertise of expertises) {
      const outcomes = expertise.evaluate(expertiseContext);
      allOutcomes.push(...outcomes);

      // Create findings for warnings and errors
      for (const outcome of outcomes) {
        if (outcome.result === "warning" || outcome.result === "error") {
          await api.createTestRunFinding({
            testCaseRunId: testCaseRun.id,
            type: outcome.result === "error" ? "error" : "warning",
            title: `[${expertise.name}] ${outcome.expected}`,
            description: outcome.observed,
          });
          events.onFindingCreated({
            type: outcome.result,
            title: `[${expertise.name}] ${outcome.expected}`,
          });
        }
      }
    }

    // Aggregate outcomes
    const expectedOutcome = allOutcomes.map(o => o.expected).join("\n");
    const observedOutcome = allOutcomes
      .map(o => `[${o.result}] ${o.observed}`)
      .join("\n");
    const hasErrors = allOutcomes.some(o => o.result === "error");
    const hasWarnings = allOutcomes.some(o => o.result === "warning");
    const status = hasErrors
      ? "failed"
      : hasWarnings
        ? "completed"
        : "completed";

    // Complete test case run
    const durationMs = Date.now() - startTime;
    await api.completeTestCaseRun(testCaseRun.id, {
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

    events.onTestCaseRunCompleted({
      testCaseRunId: testCaseRun.id,
      passed: !hasErrors,
    });

    // If discovery mode: generate new test cases
    if (analyzer && discoveryContext) {
      const currentUrl = await adapter.getUrl();
      const currentPath = new URL(currentUrl).pathname;
      const currentHashes = await computeHashes(html, items);
      const currentPageState = await api.findMatchingPageState(
        0, // pageId not needed for state comparison
        currentHashes,
        testRun.sizeClass
      );

      const page = await api.findOrCreatePage(testRun.runnerId, currentPath);

      const analyzerCtx: AnalyzerContext = {
        runnerId: testRun.runnerId,
        sizeClass: testRun.sizeClass as "desktop" | "mobile",
        uid: testRun.createdByUserId ?? undefined,
        currentPageStateId: currentPageState?.id ?? 0,
        beginningPageStateId: beginningPageStateId,
        currentPath,
        pageId: page.id,
        pageRequiresLogin: page.requiresLogin ?? false,
        scaffolds,
        actionableItems: items,
        navigationSuite: discoveryContext.navigationSuite,
        bundleRun: discoveryContext.bundleRun,
        api,
      };

      const parsedTestCase = {
        title: testCase.title,
        type: testCase.testType as any,
        sizeClass: testCase.sizeClass as any,
        suite_tags: testCase.suiteTags,
        priority: testCase.priority,
        startingPageStateId: testCase.startingPageStateId ?? 0,
        startingPath: testCase.startingPath ?? "",
        steps: steps as any,
        globalExpectations: globalExpectations as any,
      };

      await analyzer.generateTestCases(parsedTestCase, analyzerCtx);
    }
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";

    await api.completeTestCaseRun(testCaseRun.id, {
      status: "failed",
      durationMs,
      errorMessage,
      consoleLog: consoleLogs.join("\n") || undefined,
      networkLog: JSON.stringify(networkLogs) || undefined,
    });

    await api.createTestRunFinding({
      testCaseRunId: testCaseRun.id,
      type: "error",
      title: `Test execution error`,
      description: errorMessage,
    });

    events.onFindingCreated({ type: "error", title: "Test execution error" });
    events.onTestCaseRunCompleted({
      testCaseRunId: testCaseRun.id,
      passed: false,
    });
  }
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
    case "select":
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
    case "press":
      if (action.value) await adapter.pressKey(action.value);
      break;
    case "screenshot":
      await adapter.screenshot({ type: "png" });
      break;
    default:
      break;
  }
}
