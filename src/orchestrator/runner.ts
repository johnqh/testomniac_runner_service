import type { BrowserAdapter } from "../adapter";
import type { ApiClient } from "../api/client";
import type {
  TestInteractionResponse,
  TestInteractionRunResponse,
  TestSurfaceResponse,
  TestSurfaceRunResponse,
} from "@sudobility/testomniac_types";
import type {
  RunCheckpoint,
  RunConfig,
  ScanEventHandler,
  ScanResult,
} from "./types";
import type { Expertise } from "../expertise/types";
import { PageAnalyzer } from "../analyzer";
import { executeTestInteraction } from "./test-interaction-executor";

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
  const completedTestInteractionRunIds = new Set<number>();
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
    onTestInteractionRunCompleted(run) {
      completedTestInteractionRunIds.add(run.testInteractionRunId);
      events.onTestInteractionRunCompleted(run);
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
    const testRunsCompleted = completedTestInteractionRunIds.size;

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

      const testSurfaces = await api.getTestSurfacesByRunner(config.runnerId);
      const currentSurfaceRun = selectNextOpenTestSurfaceRun(
        openSurfaceRuns,
        testSurfaces
      );
      activeDependencyBranch = [];

      // Iterate open element runs in this surface
      let hasOpenCases = true;
      while (hasOpenCases) {
        await waitForCheckpoint("before_test_interaction");

        const openCaseRuns = await api.getOpenTestInteractionRuns(
          currentSurfaceRun.id
        );
        if (openCaseRuns.length === 0) {
          hasOpenCases = false;
          break;
        }

        const testInteractions = await api.getTestInteractionsByRunner(
          config.runnerId
        );
        const currentCaseRun = selectNextOpenTestInteractionRun(
          openCaseRuns,
          testInteractions,
          activeDependencyBranch
        );

        // Execute the test element
        await executeTestInteraction(
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
          currentCaseRun.testInteractionId,
          testInteractions
        );

        await waitForCheckpoint("after_test_interaction");
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
    const testRunsCompleted = completedTestInteractionRunIds.size;
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

function selectNextOpenTestInteractionRun(
  openRuns: TestInteractionRunResponse[],
  testInteractions: TestInteractionResponse[],
  activeDependencyBranch: number[]
): TestInteractionRunResponse {
  if (openRuns.length <= 1 || activeDependencyBranch.length === 0) {
    return openRuns[0]!;
  }

  const testInteractionById = new Map(
    testInteractions.map(testInteraction => [
      testInteraction.id,
      testInteraction,
    ])
  );
  const runsByDependency = new Map<
    number | null,
    TestInteractionRunResponse[]
  >();

  for (const openRun of openRuns) {
    const dependencyTestInteractionId =
      testInteractionById.get(openRun.testInteractionId)
        ?.dependencyTestInteractionId ?? null;
    const bucket = runsByDependency.get(dependencyTestInteractionId) ?? [];
    bucket.push(openRun);
    runsByDependency.set(dependencyTestInteractionId, bucket);
  }

  for (let index = activeDependencyBranch.length - 1; index >= 0; index -= 1) {
    const parentTestInteractionId = activeDependencyBranch[index]!;
    const branchChildren = runsByDependency.get(parentTestInteractionId) ?? [];
    if (branchChildren.length > 0) {
      return branchChildren[0]!;
    }
  }

  return openRuns[0]!;
}

function selectNextOpenTestSurfaceRun(
  openSurfaceRuns: TestSurfaceRunResponse[],
  testSurfaces: TestSurfaceResponse[]
): TestSurfaceRunResponse {
  if (openSurfaceRuns.length <= 1) {
    return openSurfaceRuns[0]!;
  }

  const testSurfaceById = new Map(
    testSurfaces.map(testSurface => [testSurface.id, testSurface])
  );

  return [...openSurfaceRuns].sort((left, right) => {
    const leftSurface = testSurfaceById.get(left.testSurfaceId);
    const rightSurface = testSurfaceById.get(right.testSurfaceId);

    const groupDiff =
      getSurfaceExecutionGroup(leftSurface) -
      getSurfaceExecutionGroup(rightSurface);
    if (groupDiff !== 0) {
      return groupDiff;
    }

    const priorityDiff =
      (leftSurface?.priority ?? 999) - (rightSurface?.priority ?? 999);
    if (priorityDiff !== 0) {
      return priorityDiff;
    }

    return left.id - right.id;
  })[0]!;
}

function getSurfaceExecutionGroup(
  surface: TestSurfaceResponse | undefined
): number {
  const title = surface?.title ?? "";

  if (title.startsWith("Page: ")) return 0;
  if (title.startsWith("Variants: ")) return 1;
  if (title.startsWith("Keyboard: ")) return 2;
  if (title.startsWith("Dialogs: ")) return 3;
  if (title.startsWith("Render: ")) return 4;
  if (title.startsWith("Journeys: ")) return 5;
  if (title === "Direct Navigations") return 6;
  return 7;
}

function buildDependencyChainIds(
  testInteractionId: number,
  testInteractions: TestInteractionResponse[]
): number[] {
  const testInteractionById = new Map(
    testInteractions.map(testInteraction => [
      testInteraction.id,
      testInteraction,
    ])
  );
  const chain: number[] = [];
  const seen = new Set<number>();
  let current = testInteractionById.get(testInteractionId);

  while (current) {
    if (seen.has(current.id)) {
      break;
    }
    seen.add(current.id);
    chain.unshift(current.id);
    current = current.dependencyTestInteractionId
      ? testInteractionById.get(current.dependencyTestInteractionId)
      : undefined;
  }

  return chain;
}

function createAbortError(): Error {
  const error = new Error("Run aborted");
  error.name = "AbortError";
  return error;
}
