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
import { LoginManager, type LoginConfig } from "./login-manager";

function logRunner(step: string, details?: Record<string, unknown>): void {
  console.info("[Runner]", step, details ?? {});
}

function summarizeInteraction(
  testInteraction: TestInteractionResponse | undefined
): Record<string, unknown> | null {
  if (!testInteraction) {
    return null;
  }

  return {
    id: testInteraction.id,
    title: testInteraction.title,
    priority: testInteraction.priority,
    dependencyTestInteractionId:
      testInteraction.dependencyTestInteractionId ?? null,
    surfaceTags: testInteraction.surfaceTags,
    startingPath: testInteraction.startingPath ?? null,
  };
}

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

    logRunner("test-run:loaded", {
      testRunId: testRun.id,
      discovery: testRun.discovery,
      runnerId: testRun.runnerId,
      bundleRunId: testRun.testSurfaceBundleRunId,
      testEnvironmentId: testRun.testEnvironmentId ?? null,
      sizeClass: testRun.sizeClass,
      scanUrl: testRun.scanUrl ?? null,
    });

    // Set up login manager if credentials are configured
    let loginManager: LoginManager | null = null;
    if (config.credentials || config.entityCredentialId) {
      let loginConfig: LoginConfig;
      if (config.credentials) {
        loginConfig = {
          loginUrl: config.loginUrl,
          email: config.credentials.email,
          username: config.credentials.username,
          password: config.credentials.password,
          twoFactorCode: config.credentials.twoFactorCode,
          authProvider: config.credentials.authProvider,
        };
      } else if (config.entityCredentialId) {
        const cred = await api.getEntityCredential(config.entityCredentialId);
        loginConfig = {
          loginUrl: config.loginUrl ?? cred.loginUrl ?? undefined,
          email: cred.email ?? undefined,
          username: cred.username ?? undefined,
          password: cred.password ?? undefined,
          twoFactorCode: cred.twoFactorCode ?? undefined,
          authProvider: cred.authProvider,
        };
      } else {
        loginConfig = {};
      }
      loginManager = new LoginManager(adapter, loginConfig, config.baseUrl);
      logRunner("login-manager:created", {
        hasLoginUrl: !!loginConfig.loginUrl,
        authProvider: loginConfig.authProvider,
      });
    }

    // Perform initial login if configured
    if (loginManager && (config.loginUrl || config.credentials?.authProvider)) {
      const loginSuccess = await loginManager.performInitialLogin();
      logRunner("initial-login:result", { success: loginSuccess });
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

    // Execution loop: select the next executable interaction across the bundle.
    while (true) {
      await waitForCheckpoint("before_surface");

      const openSurfaceRuns = await api.getOpenTestSurfaceRuns(
        testRun.testSurfaceBundleRunId
      );
      logRunner("surface-runs:open", {
        bundleRunId: testRun.testSurfaceBundleRunId,
        count: openSurfaceRuns.length,
        openSurfaceRunIds: openSurfaceRuns.map(surfaceRun => surfaceRun.id),
      });
      if (openSurfaceRuns.length === 0) {
        break;
      }

      const testSurfaces = await api.getTestSurfacesByRunner(config.runnerId);
      const testInteractions = await api.getTestInteractionsByRunner(
        config.runnerId
      );

      const pendingInteractionRunsBySurface = await loadPendingInteractionRuns(
        api,
        openSurfaceRuns
      );

      const runnableSurfaceEntries = pendingInteractionRunsBySurface.filter(
        entry => entry.eligibleRuns.length > 0
      );
      const blockedSurfaceEntries = pendingInteractionRunsBySurface.filter(
        entry =>
          entry.allPendingRuns.length > 0 && entry.eligibleRuns.length === 0
      );

      logRunner("interaction-runs:bundle-state", {
        activeDependencyBranch,
        runnableSurfaceRuns: runnableSurfaceEntries.map(entry => ({
          surfaceRunId: entry.surfaceRun.id,
          eligibleRunIds: entry.eligibleRuns.map(run => run.id),
          allPendingRunIds: entry.allPendingRuns.map(run => run.id),
        })),
        blockedSurfaceRuns: blockedSurfaceEntries.map(entry => ({
          surfaceRunId: entry.surfaceRun.id,
          allPendingRunIds: entry.allPendingRuns.map(run => run.id),
        })),
      });

      if (runnableSurfaceEntries.length === 0) {
        if (blockedSurfaceEntries.length > 0) {
          throw new Error(
            `Blocked interaction tree detected for bundle run ${testRun.testSurfaceBundleRunId}`
          );
        }
        // All open surface runs have zero pending interactions — complete them
        for (const surfaceRun of openSurfaceRuns) {
          const hasPending = pendingInteractionRunsBySurface.some(
            entry =>
              entry.surfaceRun.id === surfaceRun.id &&
              entry.allPendingRuns.length > 0
          );
          if (!hasPending) {
            logRunner("surface-runs:auto-completing", {
              surfaceRunId: surfaceRun.id,
              reason: "no pending interaction runs",
            });
            await api.completeTestSurfaceRun(surfaceRun.id, {
              status: "completed",
            });
          }
        }
        continue;
      }

      await waitForCheckpoint("before_test_interaction");

      // Check for session expiry and re-login if needed
      if (loginManager?.isLoggedIn()) {
        const expired = await loginManager.detectSessionExpiry();
        if (expired) {
          logRunner("session:expired, re-logging in");
          await loginManager.reLogin();
        }
      }

      const selected = selectNextInteractionAcrossBundle(
        runnableSurfaceEntries,
        testSurfaces,
        testInteractions,
        activeDependencyBranch
      );
      const selectedInteraction = testInteractions.find(
        testInteraction =>
          testInteraction.id === selected.testInteractionRun.testInteractionId
      );
      if (!selectedInteraction) {
        logRunner("interaction-runs:missing-interaction", {
          selectedRunId: selected.testInteractionRun.id,
          selectedSurfaceRunId: selected.surfaceRun.id,
          testInteractionId: selected.testInteractionRun.testInteractionId,
          activeDependencyBranch,
        });
        await api.completeTestInteractionRun(selected.testInteractionRun.id, {
          status: "cancelled",
          errorMessage: "Interaction not active or missing from runner",
        });
        continue;
      }
      logRunner("interaction-runs:selected", {
        selectedRunId: selected.testInteractionRun.id,
        selectedSurfaceRunId: selected.surfaceRun.id,
        activeDependencyBranch,
        selectedInteraction: summarizeInteraction(selectedInteraction),
      });

      await executeTestInteraction(
        adapter,
        selected.testInteractionRun,
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
          : undefined,
        config.scanScopePath,
        loginManager ?? undefined
      );
      activeDependencyBranch = buildDependencyChainIds(
        selected.testInteractionRun.testInteractionId,
        testInteractions
      );
      logRunner("interaction-runs:completed", {
        completedRunId: selected.testInteractionRun.id,
        completedSurfaceRunId: selected.surfaceRun.id,
        nextActiveDependencyBranch: activeDependencyBranch,
      });

      await waitForCheckpoint("after_test_interaction");
    }

    await waitForCheckpoint("before_completion");

    const remainingSurfaceRuns = await api.getOpenTestSurfaceRuns(
      testRun.testSurfaceBundleRunId
    );
    for (const surfaceRun of remainingSurfaceRuns) {
      await api.completeTestSurfaceRun(surfaceRun.id, {
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

export function selectNextOpenTestInteractionRun(
  openRuns: TestInteractionRunResponse[],
  testInteractions: TestInteractionResponse[],
  activeDependencyBranch: number[]
): TestInteractionRunResponse {
  if (openRuns.length <= 1) {
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
      const sortedBranchChildren = sortOpenTestInteractionRuns(
        branchChildren,
        testInteractionById
      );
      logRunner("interaction-runs:branch-candidates", {
        parentTestInteractionId,
        activeDependencyBranch,
        candidates: sortedBranchChildren.map(run => ({
          runId: run.id,
          interaction: summarizeInteraction(
            testInteractionById.get(run.testInteractionId)
          ),
        })),
      });
      return sortedBranchChildren[0]!;
    }
  }

  const sortedOpenRuns = sortOpenTestInteractionRuns(
    openRuns,
    testInteractionById
  );
  logRunner("interaction-runs:global-candidates", {
    activeDependencyBranch,
    candidates: sortedOpenRuns.map(run => ({
      runId: run.id,
      interaction: summarizeInteraction(
        testInteractionById.get(run.testInteractionId)
      ),
    })),
  });
  return sortedOpenRuns[0]!;
}

function sortOpenTestInteractionRuns(
  openRuns: TestInteractionRunResponse[],
  testInteractionById: Map<number, TestInteractionResponse>
): TestInteractionRunResponse[] {
  return [...openRuns].sort((left, right) => {
    const leftInteraction = testInteractionById.get(left.testInteractionId);
    const rightInteraction = testInteractionById.get(right.testInteractionId);

    const hoverDiff =
      Number(isHoverInteraction(rightInteraction)) -
      Number(isHoverInteraction(leftInteraction));
    if (hoverDiff !== 0) {
      return hoverDiff;
    }

    const priorityDiff =
      (leftInteraction?.priority ?? 999) - (rightInteraction?.priority ?? 999);
    if (priorityDiff !== 0) {
      return priorityDiff;
    }

    return left.id - right.id;
  });
}

function isHoverInteraction(
  testInteraction: TestInteractionResponse | undefined
): boolean {
  if (!testInteraction) {
    return false;
  }

  return (
    testInteraction.surfaceTags.includes("hover") ||
    testInteraction.title.startsWith("Hover over ")
  );
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

function _summarizeSurface(
  testSurface: TestSurfaceResponse | undefined
): Record<string, unknown> | null {
  if (!testSurface) {
    return null;
  }

  return {
    id: testSurface.id,
    title: testSurface.title,
    priority: testSurface.priority,
    startingPath: testSurface.startingPath,
    dependencyTestInteractionId:
      testSurface.dependencyTestInteractionId ?? null,
    surfaceTags: testSurface.surfaceTags,
  };
}

type PendingInteractionRunsBySurface = {
  surfaceRun: TestSurfaceRunResponse;
  eligibleRuns: TestInteractionRunResponse[];
  allPendingRuns: TestInteractionRunResponse[];
};

async function loadPendingInteractionRuns(
  api: ApiClient,
  openSurfaceRuns: TestSurfaceRunResponse[]
): Promise<PendingInteractionRunsBySurface[]> {
  return Promise.all(
    openSurfaceRuns.map(async surfaceRun => ({
      surfaceRun,
      eligibleRuns: await api.getOpenTestInteractionRuns(surfaceRun.id),
      allPendingRuns: await api.getOpenTestInteractionRuns(surfaceRun.id, true),
    }))
  );
}

function selectNextInteractionAcrossBundle(
  runnableSurfaceEntries: PendingInteractionRunsBySurface[],
  testSurfaces: TestSurfaceResponse[],
  testInteractions: TestInteractionResponse[],
  activeDependencyBranch: number[]
): {
  surfaceRun: TestSurfaceRunResponse;
  testInteractionRun: TestInteractionRunResponse;
} {
  if (activeDependencyBranch.length > 0) {
    const branchCandidates = runnableSurfaceEntries.flatMap(
      entry => entry.eligibleRuns
    );
    const selectedRun = selectNextOpenTestInteractionRun(
      branchCandidates,
      testInteractions,
      activeDependencyBranch
    );
    const selectedSurfaceEntry = runnableSurfaceEntries.find(entry =>
      entry.eligibleRuns.some(run => run.id === selectedRun.id)
    );
    if (!selectedSurfaceEntry) {
      throw new Error(
        `Selected interaction run ${selectedRun.id} is not attached to a runnable surface`
      );
    }
    return {
      surfaceRun: selectedSurfaceEntry.surfaceRun,
      testInteractionRun: selectedRun,
    };
  }

  const selectedSurfaceRun = selectNextOpenTestSurfaceRun(
    runnableSurfaceEntries.map(entry => entry.surfaceRun),
    testSurfaces
  );
  const selectedSurfaceEntry = runnableSurfaceEntries.find(
    entry => entry.surfaceRun.id === selectedSurfaceRun.id
  );
  if (!selectedSurfaceEntry) {
    throw new Error(
      `Selected surface run ${selectedSurfaceRun.id} has no runnable interactions`
    );
  }

  return {
    surfaceRun: selectedSurfaceRun,
    testInteractionRun: selectNextOpenTestInteractionRun(
      selectedSurfaceEntry.eligibleRuns,
      testInteractions,
      []
    ),
  };
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
