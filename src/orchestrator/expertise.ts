import type { BrowserAdapter } from "../adapter";
import type { ApiClient } from "../api/client";
import { ExpectationType } from "../domain/types";
import { createDefaultExpertises } from "../expertise";
import type { ExpertiseContext, Outcome } from "../expertise/types";
import type { ScanConfig, ScanEventHandler } from "./types";
import { detectScaffoldRegions } from "../scanner/component-detector";
import { detectPatternsWithInstances } from "../scanner/pattern-detector";

const EXPERTISE_PREFIX = "Expertise:";

function buildDefaultExpectations() {
  return [
    {
      expectationType: ExpectationType.PageLoaded,
      description: "Page should load successfully",
    },
    {
      expectationType: ExpectationType.NoConsoleErrors,
      description: "Page should not produce console errors",
    },
    {
      expectationType: ExpectationType.NoNetworkErrors,
      description: "Page should not produce network errors",
    },
  ];
}

function normalizeOutcomes(outcomes: Outcome[]): {
  expectedOutcome?: string;
  observedOutcome?: string;
  status: "completed" | "failed";
} {
  const expectedOutcome =
    outcomes.length > 0
      ? outcomes.map(item => item.expected).join("\n")
      : undefined;
  const observedOutcome =
    outcomes.length > 0
      ? outcomes.map(item => `[${item.result}] ${item.observed}`).join("\n")
      : undefined;
  const hasErrors = outcomes.some(item => item.result === "error");

  return {
    expectedOutcome,
    observedOutcome,
    status: hasErrors ? "failed" : "completed",
  };
}

async function ensureExpertiseSuite(
  api: ApiClient,
  config: ScanConfig,
  events: ScanEventHandler,
  expertiseName: string
): Promise<number> {
  const title = `${EXPERTISE_PREFIX} ${expertiseName}`;
  const suites = await api.getTestSuitesByRunner(config.runnerId);
  const existing = suites.find(suite => suite.title === title);
  if (existing) {
    return existing.id;
  }

  const created = await api.insertTestSuite(config.runnerId, {
    title,
    description: `Auto-generated expertise suite for ${expertiseName} findings`,
    startingPath: "/",
    sizeClass: config.sizeClass,
    priority: 2,
    suite_tags: ["expertise", expertiseName],
  } as any);
  events.onTestSuiteCreated({ suiteId: created.id, title: created.title });
  return created.id;
}

async function ensureExpertiseCase(
  api: ApiClient,
  config: ScanConfig,
  suiteId: number,
  expertiseName: string,
  pageStateId: number,
  pageId: number,
  relativePath: string
): Promise<number> {
  const testCase = await api.insertTestCase(
    config.runnerId,
    {
      title: `${expertiseName}: ${relativePath || "/"}`,
      type: "render",
      sizeClass: config.sizeClass,
      suite_tags: ["expertise", expertiseName],
      page_id: pageId,
      priority: 2,
      startingPageStateId: pageStateId,
      startingPath: relativePath || "/",
      steps: [],
      globalExpectations: [],
    } as any,
    suiteId
  );

  return testCase.id;
}

export async function executePageExpertises(
  adapter: BrowserAdapter,
  config: ScanConfig,
  api: ApiClient,
  events: ScanEventHandler,
  pageStateId: number,
  pageId: number,
  relativePath: string
): Promise<void> {
  const html = await adapter.content();
  const scaffolds = await detectScaffoldRegions(adapter);
  const patterns = await detectPatternsWithInstances(adapter);
  const expertises = createDefaultExpertises();

  for (const expertise of expertises) {
    const runtimeArtifacts = adapter.getRuntimeArtifacts?.() ?? {
      consoleLogs: [],
      networkLogs: [],
    };
    const context: ExpertiseContext = {
      html,
      scaffolds,
      patterns,
      consoleLogs: runtimeArtifacts.consoleLogs,
      networkLogs: runtimeArtifacts.networkLogs as any,
      expectations: buildDefaultExpectations() as any,
    };
    const suiteId = await ensureExpertiseSuite(
      api,
      config,
      events,
      expertise.name
    );
    const testCaseId = await ensureExpertiseCase(
      api,
      config,
      suiteId,
      expertise.name,
      pageStateId,
      pageId,
      relativePath
    );
    const testCaseRun = await api.createTestCaseRun({ testCaseId });
    const testRun = await api.createTestRun({
      runnerId: config.runnerId,
      testCaseRunId: testCaseRun.id,
      testEnvironmentId: config.testEnvironmentId,
      parentTestRunId: config.scanId,
      rootTestRunId: config.scanId,
      sizeClass: config.sizeClass,
      runnerInstanceId: config.runnerInstanceId,
      runnerInstanceName: config.runnerInstanceName,
    });

    const startedAt = Date.now();

    try {
      const outcomes = expertise.evaluate(context);
      const { expectedOutcome, observedOutcome, status } =
        normalizeOutcomes(outcomes);

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

      await api.completeTestCaseRun(testCaseRun.id, {
        status,
        durationMs: Date.now() - startedAt,
        expectedOutcome,
        observedOutcome,
        consoleLog: runtimeArtifacts.consoleLogs.join("\n") || undefined,
        networkLog:
          JSON.stringify(runtimeArtifacts.networkLogs ?? []) || undefined,
      });
      await api.completeTestRun(testRun.id, {
        status,
        totalDurationMs: Date.now() - startedAt,
      });
      events.onTestRunCompleted({
        testRunId: testRun.id,
        passed: status !== "failed",
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Expertise evaluation failed";
      await api.completeTestCaseRun(testCaseRun.id, {
        status: "failed",
        durationMs: Date.now() - startedAt,
        errorMessage: message,
        consoleLog: runtimeArtifacts.consoleLogs.join("\n") || undefined,
        networkLog:
          JSON.stringify(runtimeArtifacts.networkLogs ?? []) || undefined,
      });
      await api.completeTestRun(testRun.id, {
        status: "failed",
        totalDurationMs: Date.now() - startedAt,
      });
      await api.createTestRunFinding({
        testCaseRunId: testCaseRun.id,
        type: "error",
        title: `[${expertise.name}] expertise execution failed`,
        description: message,
      });
      events.onFindingCreated({
        type: "error",
        title: `[${expertise.name}] expertise execution failed`,
      });
      events.onTestRunCompleted({
        testRunId: testRun.id,
        passed: false,
      });
    } finally {
      adapter.resetRuntimeArtifacts?.();
    }
  }
}
