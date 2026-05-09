import type { BrowserAdapter } from "../adapter";
import type { ApiClient } from "../api/client";
import type { RunConfig, ScanEventHandler, ScanResult } from "./types";
import type { Expertise } from "../expertise/types";
import { PageAnalyzer } from "../analyzer";
import { executeTestElement } from "./test-element-executor";

/**
 * Main entry point for the runner execution loop.
 *
 * Execution: bundle → iterate surfaces → iterate cases → run case
 */
export async function runTestRun(
  adapter: BrowserAdapter,
  config: RunConfig,
  api: ApiClient,
  expertises: Expertise[],
  events: ScanEventHandler
): Promise<ScanResult> {
  const startTime = Date.now();
  const pageIdsFound = new Set<number>();
  const pageStateIdsFound = new Set<number>();
  const completedTestElementRunIds = new Set<number>();
  let findingsFound = 0;

  // Wrap event handler to track stats
  const wrappedEvents: ScanEventHandler = {
    ...events,
    onPageFound(page) {
      pageIdsFound.add(page.pageId);
      events.onPageFound(page);
      void emitStats();
    },
    onPageStateCreated(state) {
      pageStateIdsFound.add(state.pageStateId);
      events.onPageStateCreated(state);
      void emitStats();
    },
    onTestElementRunCompleted(run) {
      completedTestElementRunIds.add(run.testElementRunId);
      events.onTestElementRunCompleted(run);
      void emitStats();
    },
    onTestRunCompleted(run) {
      events.onTestRunCompleted(run);
    },
    onFindingCreated(finding) {
      findingsFound++;
      events.onFindingCreated(finding);
      void emitStats();
    },
  };

  async function emitStats() {
    const pagesFound = pageIdsFound.size;
    const pageStatesFound = pageStateIdsFound.size;
    const testRunsCompleted = completedTestElementRunIds.size;

    events.onStatsUpdated({
      pagesFound,
      pageStatesFound,
      testRunsCompleted,
      findingsFound,
    });

    try {
      await api.updateTestRunStats(config.testRunId, {
        pagesFound,
        pageStatesFound,
        testRunsCompleted,
      });
    } catch {
      // best effort while the run is still in flight
    }
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

    if (!testRun.testSurfaceBundleRunId) {
      throw new Error(
        `Test run ${config.testRunId} has no test surface bundle run`
      );
    }

    // Set up analyzer for discovery mode
    const analyzer = testRun.discovery ? new PageAnalyzer() : null;

    // Get navigation surface for discovery context
    let navigationSurface = null;
    if (testRun.discovery) {
      const surfaces = await api.getTestSurfacesByRunner(config.runnerId);
      navigationSurface =
        surfaces.find(
          s =>
            s.title === "Direct Navigations" &&
            (config.uid ? s.uid === config.uid : s.uid == null)
        ) ?? null;
    }

    const bundleRun = testRun.testSurfaceBundleRunId
      ? await api.getTestSurfaceBundleRun(testRun.testSurfaceBundleRunId)
      : null;

    // Execution loop: iterate open surface runs in the bundle
    let hasOpenSurfaces = true;
    while (hasOpenSurfaces) {
      if (config.signal?.aborted) break;

      const openSurfaceRuns = await api.getOpenTestSurfaceRuns(
        testRun.testSurfaceBundleRunId
      );
      if (openSurfaceRuns.length === 0) {
        hasOpenSurfaces = false;
        break;
      }

      const currentSurfaceRun = openSurfaceRuns[0];

      // Iterate open element runs in this surface
      let hasOpenCases = true;
      while (hasOpenCases) {
        if (config.signal?.aborted) break;

        const openCaseRuns = await api.getOpenTestElementRuns(
          currentSurfaceRun.id
        );
        if (openCaseRuns.length === 0) {
          hasOpenCases = false;
          break;
        }

        const currentCaseRun = openCaseRuns[0];

        // Execute the test element
        await executeTestElement(
          adapter,
          currentCaseRun,
          testRun,
          expertises,
          analyzer,
          api,
          wrappedEvents,
          navigationSurface && bundleRun
            ? {
                navigationSurface,
                bundleRun,
              }
            : undefined
        );
      }

      // All elements done in this surface — mark surface run completed
      await api.completeTestSurfaceRun(currentSurfaceRun.id, {
        status: "completed",
      });
    }

    // All surfaces done — mark bundle run and test run completed
    await api.completeTestSurfaceBundleRun(testRun.testSurfaceBundleRunId, {
      status: "completed",
    });

    const durationMs = Date.now() - startTime;
    const pagesFound = pageIdsFound.size;
    const pageStatesFound = pageStateIdsFound.size;
    const testRunsCompleted = completedTestElementRunIds.size;
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
