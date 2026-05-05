import type { BrowserAdapter } from "../adapter";
import type { ApiClient } from "../api/client";
import type { RunConfig, ScanEventHandler, ScanResult } from "./types";
import type { Expertise } from "../expertise/types";
import { PageAnalyzer } from "../analyzer";
import { executeTestCase } from "./test-case-executor";

/**
 * Main entry point for the new runner execution loop.
 * Replaces the old runScan/processDecompositionJob/executeTestCases orchestrator.
 *
 * Execution: bundle → iterate suites → iterate cases → run case
 */
export async function runTestRun(
  adapter: BrowserAdapter,
  config: RunConfig,
  api: ApiClient,
  expertises: Expertise[],
  events: ScanEventHandler
): Promise<ScanResult> {
  const startTime = Date.now();
  let pagesFound = 0;
  let pageStatesFound = 0;
  let testRunsCompleted = 0;
  let findingsFound = 0;

  // Wrap event handler to track stats
  const wrappedEvents: ScanEventHandler = {
    ...events,
    onPageFound(page) {
      pagesFound++;
      events.onPageFound(page);
      emitStats();
    },
    onPageStateCreated(state) {
      pageStatesFound++;
      events.onPageStateCreated(state);
      emitStats();
    },
    onTestCaseRunCompleted(run) {
      testRunsCompleted++;
      events.onTestCaseRunCompleted(run);
      emitStats();
    },
    onTestRunCompleted(run) {
      events.onTestRunCompleted(run);
    },
    onFindingCreated(finding) {
      findingsFound++;
      events.onFindingCreated(finding);
      emitStats();
    },
  };

  function emitStats() {
    events.onStatsUpdated({
      pagesFound,
      pageStatesFound,
      testRunsCompleted,
      findingsFound,
    });
  }

  try {
    // Claim the test run
    const claimed = await api.claimTestRun(
      config.testRunId,
      config.runnerInstanceId,
      config.runnerInstanceName
    );
    if (!claimed) {
      throw new Error(
        `Test run ${config.testRunId} already claimed by another runner`
      );
    }

    // Get the test run to find the bundle run
    const testRun = await api.getTestRun(config.testRunId);
    if (!testRun) {
      throw new Error(`Test run ${config.testRunId} not found`);
    }

    if (!testRun.testSuiteBundleRunId) {
      throw new Error(
        `Test run ${config.testRunId} has no test suite bundle run`
      );
    }

    // Set up analyzer for discovery mode
    const analyzer = testRun.discovery ? new PageAnalyzer() : null;

    // Get navigation suite for discovery context
    let navigationSuite = null;
    if (testRun.discovery) {
      const suites = await api.getTestSuitesByRunner(config.runnerId);
      navigationSuite =
        suites.find(
          s =>
            s.title === "Navigation" &&
            (config.uid ? s.uid === config.uid : s.uid == null)
        ) ?? null;
    }

    // Execution loop: iterate open suite runs in the bundle
    let hasOpenSuites = true;
    while (hasOpenSuites) {
      if (config.signal?.aborted) break;

      const openSuiteRuns = await api.getOpenTestSuiteRuns(
        testRun.testSuiteBundleRunId
      );
      if (openSuiteRuns.length === 0) {
        hasOpenSuites = false;
        break;
      }

      const currentSuiteRun = openSuiteRuns[0];

      // Iterate open case runs in this suite
      let hasOpenCases = true;
      while (hasOpenCases) {
        if (config.signal?.aborted) break;

        const openCaseRuns = await api.getOpenTestCaseRuns(currentSuiteRun.id);
        if (openCaseRuns.length === 0) {
          hasOpenCases = false;
          break;
        }

        const currentCaseRun = openCaseRuns[0];

        // Execute the test case
        await executeTestCase(
          adapter,
          currentCaseRun,
          testRun,
          expertises,
          analyzer,
          api,
          wrappedEvents,
          navigationSuite && testRun.testSuiteBundleRunId
            ? {
                navigationSuite,
                bundleRun: {
                  id: testRun.testSuiteBundleRunId,
                  testSuiteBundleId: 0, // will be resolved by API
                  status: "running",
                  startedAt: null,
                  completedAt: null,
                  createdAt: null,
                },
              }
            : undefined
        );
      }

      // All cases done in this suite — mark suite run completed
      await api.completeTestSuiteRun(currentSuiteRun.id, {
        status: "completed",
      });
    }

    // All suites done — mark bundle run and test run completed
    await api.completeTestSuiteBundleRun(testRun.testSuiteBundleRunId, {
      status: "completed",
    });

    const durationMs = Date.now() - startTime;
    await api.completeTestRun(config.testRunId, {
      status: "completed",
      totalDurationMs: durationMs,
      pagesFound,
      pageStatesFound,
      testRunsCompleted,
    });

    const result: ScanResult = {
      testRunId: config.testRunId,
      pagesFound,
      pageStatesFound,
      testRunsCompleted,
      findingsFound,
      durationMs,
    };

    wrappedEvents.onScanComplete({
      totalPages: pagesFound,
      totalFindings: findingsFound,
      durationMs,
    });

    wrappedEvents.onTestRunCompleted({
      testRunId: config.testRunId,
      passed: findingsFound === 0,
    });

    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    wrappedEvents.onError({ message });

    // Try to mark the run as failed
    try {
      await api.completeTestRun(config.testRunId, {
        status: "failed",
        totalDurationMs: Date.now() - startTime,
      });
    } catch {
      // best effort
    }

    throw error;
  }
}
