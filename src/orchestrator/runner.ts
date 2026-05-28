import type { BrowserAdapter } from "../adapter";
import type { ApiClient } from "../api/client";
import type { DedupStore } from "../storage/dedup-store";
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
  events: ScanEventHandler,
  options?: { dedupStore?: DedupStore }
): Promise<ScanResult> {
  const startTime = Date.now();
  const pageIdsFound = new Set<number>();
  const pageStateIdsFound = new Set<number>();
  const completedTestInteractionRunIds = new Set<number>();
  let findingsFound = 0;
  let totalPausedMs = 0;
  let activeDependencyBranch: number[] = [];

  // ---------------------------------------------------------------------------
  // Debounced stats emission — emits local event immediately but batches the
  // API call to at most once per 2 seconds to avoid flooding the server.
  // ---------------------------------------------------------------------------
  let statsFlushTimer: ReturnType<typeof setTimeout> | null = null;
  let statsDirty = false;

  function emitStatsLocal() {
    const pagesFound = pageIdsFound.size;
    const pageStatesFound = pageStateIdsFound.size;
    const testRunsCompleted = completedTestInteractionRunIds.size;
    const elapsedMs = Date.now() - startTime - totalPausedMs;

    events.onStatsUpdated({
      pagesFound,
      pageStatesFound,
      testRunsCompleted,
      findingsFound,
      elapsedMs,
    });
  }

  async function flushStatsToApi() {
    statsDirty = false;
    const pagesFound = pageIdsFound.size;
    const pageStatesFound = pageStateIdsFound.size;
    const testRunsCompleted = completedTestInteractionRunIds.size;

    try {
      await api.updateTestRunStats(config.testRunId, {
        pagesFound,
        pageStatesFound,
        testRunsCompleted,
      });
    } catch (err) {
      logRunner("stats-update:failed", {
        testRunId: config.testRunId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  function scheduleStatsFlush() {
    statsDirty = true;
    if (statsFlushTimer != null) return;
    statsFlushTimer = setTimeout(() => {
      statsFlushTimer = null;
      if (statsDirty) {
        void flushStatsToApi();
      }
    }, 2000);
  }

  // Wrap event handler to track stats
  const wrappedEvents: ScanEventHandler = {
    ...events,
    onPageFound(page) {
      pageIdsFound.add(page.pageId);
      events.onPageFound(page);
      emitStatsLocal();
      scheduleStatsFlush();
    },
    onPageStateCreated(state) {
      pageStateIdsFound.add(state.pageStateId);
      events.onPageStateCreated(state);
      emitStatsLocal();
      scheduleStatsFlush();
    },
    onTestInteractionRunCompleted(run) {
      completedTestInteractionRunIds.add(run.testInteractionRunId);
      events.onTestInteractionRunCompleted(run);
      emitStatsLocal();
      scheduleStatsFlush();
    },
    onTestRunCompleted(run) {
      events.onTestRunCompleted(run);
    },
    onFindingCreated(finding) {
      findingsFound++;
      events.onFindingCreated(finding);
      emitStatsLocal();
      scheduleStatsFlush();
    },
  };

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
    const checkpointStart = Date.now();
    await config.waitForCheckpoint?.(checkpoint);
    totalPausedMs += Date.now() - checkpointStart;
    if (config.signal?.aborted) {
      throw createAbortError();
    }
  }

  try {
    await waitForCheckpoint("before_claim");
    logRunner("claim:attempting", {
      testRunId: config.testRunId,
      runnerInstanceId: config.runnerInstanceId,
      runnerInstanceName: config.runnerInstanceName,
    });
    const claimed = await api.claimTestRun(
      config.testRunId,
      config.runnerInstanceId,
      config.runnerInstanceName
    );
    logRunner("claim:result", { testRunId: config.testRunId, claimed });
    if (!claimed) {
      throw new Error(
        `Test run ${config.testRunId} already claimed by another runner`
      );
    }

    // Resolve productId for post-scan persona detection
    let productId = config.productId;
    if (!productId) {
      const runner = await api.getRunner(config.runnerId);
      productId = runner?.productId;
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
    const analyzer = testRun.discovery
      ? new PageAnalyzer(options?.dedupStore)
      : null;

    if (testRun.discovery) {
      try {
        await hydratePersistedDiscoveryStats(
          config.runnerId,
          testRun.testEnvironmentId
        );
        emitStatsLocal();
        await flushStatsToApi();
      } catch (err) {
        logRunner("hydration:failed", {
          runnerId: config.runnerId,
          testEnvironmentId: testRun.testEnvironmentId,
          error: err instanceof Error ? err.message : String(err),
        });
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
          logRunner("interaction-runs:blocked-tree", {
            bundleRunId: testRun.testSurfaceBundleRunId,
            blockedSurfaceRunCount: blockedSurfaceEntries.length,
            blockedDetails: blockedSurfaceEntries.map(entry => ({
              surfaceRunId: entry.surfaceRun.id,
              surfaceId: entry.surfaceRun.testSurfaceId,
              allPendingRunIds: entry.allPendingRuns.map(run => run.id),
              allPendingInteractionIds: entry.allPendingRuns.map(
                run => run.testInteractionId
              ),
            })),
          });
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

      // Batch-cancel interactions that the scan mode will skip so we don't
      // spin through them one-by-one in the main loop (each iteration makes
      // multiple API round-trips).
      const effectiveScanMode =
        config.scanMode ?? (config.quickScan ? "partial" : "full");

      if (effectiveScanMode === "minimum" || effectiveScanMode === "partial") {
        const skippableRuns: Array<{
          run: { id: number };
          reason: string;
        }> = [];

        for (const entry of runnableSurfaceEntries) {
          for (const run of entry.eligibleRuns) {
            const interaction = testInteractions.find(
              ti => ti.id === run.testInteractionId
            );
            if (!interaction) continue;

            if (
              effectiveScanMode === "minimum" &&
              interaction.testType !== "navigation"
            ) {
              skippableRuns.push({
                run,
                reason: "Skipped: minimum scan mode",
              });
            } else if (
              effectiveScanMode === "partial" &&
              isHoverInteraction(interaction) &&
              hasNavigationInteractionForSameElement(
                interaction,
                testInteractions
              )
            ) {
              skippableRuns.push({
                run,
                reason: "Skipped: partial scan mode",
              });
            }
          }
        }

        if (skippableRuns.length > 0) {
          logRunner("batch-skip:cancelling", {
            scanMode: effectiveScanMode,
            count: skippableRuns.length,
          });
          await Promise.all(
            skippableRuns.map(({ run, reason }) =>
              api.completeTestInteractionRun(run.id, {
                status: "cancelled",
                errorMessage: reason,
              })
            )
          );
          // Re-fetch after batch cancel to get updated state
          continue;
        }
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

      const interactionTimeout = 60_000; // 60 seconds max per interaction
      try {
        await Promise.race([
          executeTestInteraction(
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
            loginManager ?? undefined,
            testInteractions
          ),
          new Promise<never>((_, reject) =>
            setTimeout(
              () =>
                reject(
                  new Error(
                    `Test interaction ${selected.testInteractionRun.id} timed out after ${interactionTimeout}ms`
                  )
                ),
              interactionTimeout
            )
          ),
        ]);
      } catch (timeoutErr) {
        const msg =
          timeoutErr instanceof Error ? timeoutErr.message : String(timeoutErr);
        logRunner("interaction-runs:timeout", {
          runId: selected.testInteractionRun.id,
          surfaceRunId: selected.surfaceRun.id,
          message: msg,
        });
        // Mark as skipped so the runner moves on
        try {
          await api.completeTestInteractionRun(selected.testInteractionRun.id, {
            status: "skipped",
            errorMessage: msg,
          });
        } catch {
          // already completed by the executor's own error handler
        }
        wrappedEvents.onTestInteractionRunCompleted({
          testInteractionRunId: selected.testInteractionRun.id,
          passed: true,
        });
      }
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

    logRunner("loop:exited", {
      testRunId: config.testRunId,
      bundleRunId: testRun.testSurfaceBundleRunId,
      completedInteractionRunCount: completedTestInteractionRunIds.size,
    });

    await waitForCheckpoint("before_completion");

    // Flush any pending debounced stats before completing
    if (statsFlushTimer != null) {
      clearTimeout(statsFlushTimer);
      statsFlushTimer = null;
    }
    await flushStatsToApi();

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

    // Post-scan: detect personas
    if (productId) {
      try {
        const detectedPersonas = await api.detectPersonas(productId);
        result.personas = detectedPersonas.map(p => ({
          id: p.id,
          title: p.title,
          description: p.description ?? "",
        }));
        if (result.personas.length > 0) {
          wrappedEvents.onPersonasDetected?.(result.personas);
        }
      } catch (err) {
        wrappedEvents.onError({
          message: `Persona detection failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }

    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const stack = error instanceof Error ? error.stack : undefined;
    logRunner("runTestRun:error", {
      testRunId: config.testRunId,
      message,
      stack,
      errorType: error instanceof Error ? error.constructor.name : typeof error,
    });
    wrappedEvents.onError({ message });

    // Try to mark the run as failed
    try {
      await api.completeTestRun(config.testRunId, {
        status: "failed",
        totalDurationMs: Date.now() - startTime,
      });
    } catch (completionErr) {
      logRunner("complete-failed-run:error", {
        testRunId: config.testRunId,
        error:
          completionErr instanceof Error
            ? completionErr.message
            : String(completionErr),
      });
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

function hasNavigationInteractionForSameElement(
  hoverInteraction: TestInteractionResponse,
  allInteractions: TestInteractionResponse[]
): boolean {
  return allInteractions.some(
    other =>
      other.id !== hoverInteraction.id &&
      other.testType === "navigation" &&
      other.testSurfaceId === hoverInteraction.testSurfaceId &&
      other.pageId === hoverInteraction.pageId
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

  // Direct Navigations run first so that follow-up interactions on
  // discovered pages depend on a simple navigate interaction instead of
  // a long hover+click chain.
  if (title === "Direct Navigations") return 0;
  if (title.startsWith("Page: ")) return 1;
  if (title.startsWith("Variants: ")) return 2;
  if (title.startsWith("Keyboard: ")) return 3;
  if (title.startsWith("Dialogs: ")) return 4;
  if (title.startsWith("Render: ")) return 5;
  if (title.startsWith("Journeys: ")) return 6;
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
  if (openSurfaceRuns.length === 0) return [];
  const ids = openSurfaceRuns.map(sr => sr.id);
  const batchResult = await api.getOpenTestInteractionRunsBatch(ids);
  return openSurfaceRuns.map(surfaceRun => {
    const allPendingRuns = batchResult[String(surfaceRun.id)] ?? [];
    return {
      surfaceRun,
      eligibleRuns: allPendingRuns.filter(r => !r.blocked),
      allPendingRuns,
    };
  });
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
    // Respect surface execution group ordering even within the dependency
    // branch.  This ensures Direct Navigations run before hover/content
    // interactions, so discovered pages get short dependency chains.
    const testSurfaceById = new Map(testSurfaces.map(s => [s.id, s]));
    const sortedEntries = [...runnableSurfaceEntries].sort((a, b) => {
      const aGroup = getSurfaceExecutionGroup(
        testSurfaceById.get(a.surfaceRun.testSurfaceId)
      );
      const bGroup = getSurfaceExecutionGroup(
        testSurfaceById.get(b.surfaceRun.testSurfaceId)
      );
      return aGroup - bGroup;
    });

    // Try each surface group in order — pick the first one that has
    // branch candidates.
    for (const entry of sortedEntries) {
      if (entry.eligibleRuns.length === 0) continue;
      const selectedRun = selectNextOpenTestInteractionRun(
        entry.eligibleRuns,
        testInteractions,
        activeDependencyBranch
      );
      return {
        surfaceRun: entry.surfaceRun,
        testInteractionRun: selectedRun,
      };
    }

    // Fallback: no branch candidates found in any surface (shouldn't happen
    // since runnableSurfaceEntries is pre-filtered, but be safe)
    const allCandidates = runnableSurfaceEntries.flatMap(
      entry => entry.eligibleRuns
    );
    const selectedRun = selectNextOpenTestInteractionRun(
      allCandidates,
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
