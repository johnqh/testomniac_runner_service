import type { BrowserAdapter } from "../adapter";
import type { ApiClient } from "../api/client";
import type {
  TestElementResponse,
  TestElementRunResponse,
} from "@sudobility/testomniac_types";
import type {
  RunCheckpoint,
  RunConfig,
  ScanEventHandler,
  ScanResult,
} from "./types";
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
  let activeDependencyBranch: number[] = [];

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

  async function hydratePersistedDiscoveryStats(
    runnerId: number,
    testEnvironmentId?: number | null
  ): Promise<void> {
    const pages = await api.getPagesByRunner(runnerId);
    const relevantPages = pages.filter(page =>
      testEnvironmentId == null
        ? true
        : page.testEnvironmentId === testEnvironmentId
    );

    await Promise.all(
      relevantPages.map(async page => {
        pageIdsFound.add(page.id);
        const pageStates = await api.getPageStates(page.id);
        for (const pageState of pageStates) {
          pageStateIdsFound.add(pageState.id);
        }
      })
    );
  }

  async function waitForCheckpoint(checkpoint: RunCheckpoint): Promise<void> {
    if (config.signal?.aborted) {
      throw createAbortError();
    }
    await config.waitForCheckpoint?.(checkpoint);
    if (config.signal?.aborted) {
      throw createAbortError();
    }
  }

  try {
    await waitForCheckpoint("before_claim");
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

    if (testRun.discovery) {
      try {
        await hydratePersistedDiscoveryStats(
          config.runnerId,
          testRun.testEnvironmentId
        );
        await emitStats();
      } catch {
        // best effort hydration for live counters
      }
    }

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
      await waitForCheckpoint("before_surface");

      const openSurfaceRuns = await api.getOpenTestSurfaceRuns(
        testRun.testSurfaceBundleRunId
      );
      if (openSurfaceRuns.length === 0) {
        hasOpenSurfaces = false;
        break;
      }

      const currentSurfaceRun = openSurfaceRuns[0];
      activeDependencyBranch = [];

      // Iterate open element runs in this surface
      let hasOpenCases = true;
      while (hasOpenCases) {
        await waitForCheckpoint("before_test_element");

        const openCaseRuns = await api.getOpenTestElementRuns(
          currentSurfaceRun.id
        );
        if (openCaseRuns.length === 0) {
          hasOpenCases = false;
          break;
        }

        const testElements = await api.getTestElementsByRunner(config.runnerId);
        const currentCaseRun = selectNextOpenTestElementRun(
          openCaseRuns,
          testElements,
          activeDependencyBranch
        );

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
        activeDependencyBranch = buildDependencyChainIds(
          currentCaseRun.testElementId,
          testElements
        );

        await waitForCheckpoint("after_test_element");
      }

      // All elements done in this surface — mark surface run completed
      await api.completeTestSurfaceRun(currentSurfaceRun.id, {
        status: "completed",
      });
    }

    await waitForCheckpoint("before_completion");

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

function selectNextOpenTestElementRun(
  openRuns: TestElementRunResponse[],
  testElements: TestElementResponse[],
  activeDependencyBranch: number[]
): TestElementRunResponse {
  if (openRuns.length <= 1 || activeDependencyBranch.length === 0) {
    return openRuns[0]!;
  }

  const testElementById = new Map(
    testElements.map(testElement => [testElement.id, testElement])
  );
  const runsByDependency = new Map<number | null, TestElementRunResponse[]>();

  for (const openRun of openRuns) {
    const dependencyTestElementId =
      testElementById.get(openRun.testElementId)?.dependencyTestElementId ??
      null;
    const bucket = runsByDependency.get(dependencyTestElementId) ?? [];
    bucket.push(openRun);
    runsByDependency.set(dependencyTestElementId, bucket);
  }

  for (let index = activeDependencyBranch.length - 1; index >= 0; index -= 1) {
    const parentTestElementId = activeDependencyBranch[index]!;
    const branchChildren = runsByDependency.get(parentTestElementId) ?? [];
    if (branchChildren.length > 0) {
      return branchChildren[0]!;
    }
  }

  return openRuns[0]!;
}

function buildDependencyChainIds(
  testElementId: number,
  testElements: TestElementResponse[]
): number[] {
  const testElementById = new Map(
    testElements.map(testElement => [testElement.id, testElement])
  );
  const chain: number[] = [];
  const seen = new Set<number>();
  let current = testElementById.get(testElementId);

  while (current) {
    if (seen.has(current.id)) {
      break;
    }
    seen.add(current.id);
    chain.unshift(current.id);
    current = current.dependencyTestElementId
      ? testElementById.get(current.dependencyTestElementId)
      : undefined;
  }

  return chain;
}

function createAbortError(): Error {
  const error = new Error("Run aborted");
  error.name = "AbortError";
  return error;
}
