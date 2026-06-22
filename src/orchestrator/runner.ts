import type { BrowserAdapter } from "../adapter";
import type { ApiClient } from "../api/client";
import type { DedupStore } from "../storage/dedup-store";
import type {
  TestInteractionResponse,
  TestInteractionRunResponse,
  TestSurfaceResponse,
  TestSurfaceRunResponse,
  ScanNextResponse,
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

function describeInteractionStatus(
  testInteraction: TestInteractionResponse,
  baseUrl: string
): string {
  if (
    testInteraction.testType === "navigation" &&
    testInteraction.startingPath
  ) {
    const origin = baseUrl.startsWith("http")
      ? new URL(baseUrl).origin
      : "http://localhost";
    const url = testInteraction.startingPath.startsWith("http")
      ? testInteraction.startingPath
      : new URL(testInteraction.startingPath, origin).toString();
    return `Navigate to ${url}`;
  }

  return `Running interaction: ${testInteraction.title}`;
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
  let latestStatusUpdate: string | undefined;
  let closeoutProductId = config.productId;
  let closeoutBundleRunId: number | undefined;

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
      status_update: latestStatusUpdate,
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
        ...(latestStatusUpdate ? { status_update: latestStatusUpdate } : {}),
      });
    } catch (err) {
      logRunner("stats-update:failed", {
        testRunId: config.testRunId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  function publishStatusUpdate(message: string): void {
    latestStatusUpdate = message;
    events.onStatusUpdate?.({ testRunId: config.testRunId, message });
    emitStatsLocal();
    // Status updates are cosmetic — they get picked up by the next
    // natural stats flush. Don't schedule a flush just for a status change.
  }

  function scheduleStatsFlush() {
    statsDirty = true;
    if (statsFlushTimer != null) return;
    statsFlushTimer = setTimeout(() => {
      statsFlushTimer = null;
      if (statsDirty) {
        void flushStatsToApi();
      }
    }, 10000);
  }

  // Wrap event handler to track stats
  const wrappedEvents: ScanEventHandler = {
    ...events,
    onPageFound(page) {
      pageIdsFound.add(page.pageId);
      events.onPageFound(page);
      emitStatsLocal();
      // Don't flush here — onPageStateCreated fires right after and will flush
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
      // Don't schedule flush for findings — they're batched and the count
      // gets reported on the next natural stats flush from page/interaction events
    },
  };

  async function waitForCheckpoint(
    checkpoint: RunCheckpoint
  ): Promise<boolean> {
    if (config.signal?.aborted) {
      return false;
    }
    const checkpointStart = Date.now();
    await config.waitForCheckpoint?.(checkpoint);
    totalPausedMs += Date.now() - checkpointStart;
    if (config.signal?.aborted) {
      return false;
    }
    return true;
  }

  try {
    const shouldContinue = await waitForCheckpoint("before_claim");
    if (!shouldContinue) {
      await api.scanEnd({
        productId: closeoutProductId,
        testRunId: config.testRunId,
        status: "stopped",
        totalDurationMs: Date.now() - startTime,
        status_update: "Scan stopped by user",
        runDetection: false,
      });
      return {
        testRunId: config.testRunId,
        pagesFound: 0,
        pageStatesFound: 0,
        testRunsCompleted: 0,
        findingsFound: 0,
        durationMs: Date.now() - startTime,
      };
    }
    publishStatusUpdate(`Claiming scan ${config.testRunId}`);
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
    closeoutProductId = productId;

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
    closeoutBundleRunId = testRun.testSurfaceBundleRunId;

    logRunner("test-run:loaded", {
      testRunId: testRun.id,
      discovery: testRun.discovery,
      runnerId: testRun.runnerId,
      bundleRunId: testRun.testSurfaceBundleRunId,
      testEnvironmentId: testRun.testEnvironmentId ?? null,
      sizeClass: testRun.sizeClass,
      scanUrl: testRun.scanUrl ?? null,
    });
    publishStatusUpdate(
      `Preparing scan for ${testRun.scanUrl ?? config.baseUrl}`
    );

    // Load the per-environment userData blob (single source for credentials +
    // {path} variable interpolation). Prefer an explicit override on the
    // config; otherwise fetch by the run's testEnvironmentId. Non-fatal.
    let userData = config.userData;
    if (!userData && testRun.testEnvironmentId != null) {
      try {
        userData =
          (await api.getUserData(testRun.testEnvironmentId)) ?? undefined;
      } catch (err) {
        logRunner("user-data:fetch-failed", {
          testEnvironmentId: testRun.testEnvironmentId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Set up login manager if a credential is configured in userData.
    // (config.credentials / entityCredentialId are deprecated and unread.)
    let loginManager: LoginManager | null = null;
    const credential = userData?.credential;
    if (credential || config.loginUrl) {
      const loginConfig: LoginConfig = {
        loginUrl: config.loginUrl,
        email: credential?.email,
        username: credential?.username,
        password: credential?.password,
        twoFactorCode: credential?.twoFactorCode,
      };
      loginManager = new LoginManager(adapter, loginConfig, config.baseUrl);
      logRunner("login-manager:created", {
        hasLoginUrl: !!loginConfig.loginUrl,
        hasCredential: !!credential,
      });
    }

    // Perform initial login if configured
    if (loginManager && (config.loginUrl || credential)) {
      const loginSuccess = await loginManager.performInitialLogin();
      logRunner("initial-login:result", { success: loginSuccess });
    }

    // Set up analyzer for discovery mode
    const analyzer = testRun.discovery
      ? new PageAnalyzer(options?.dedupStore)
      : null;

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

    // Scan-scoped record of page-state signatures whose body the server already
    // has (created + decomposed this bundle run). Lets the executor send a
    // hashes-only /scan/next on revisits AND skip the extra round-trip on first
    // visits by attaching the body pre-emptively. Lives for this scan only, so
    // it never goes stale across runs; the server's `needHtml` reply is the
    // fallback if a guess is wrong (e.g. server restart).
    const sentPageBodies = new Set<string>();

    const INTERACTION_TIMEOUT_MS = 60_000; // 60 seconds max per interaction

    // Execute one interaction with a hard timeout. On timeout/uncaught error the
    // run is marked skipped and null is returned. `prefetched` (from /scan/next)
    // lets the executor skip re-fetching the interaction set.
    const executeOne = (
      run: TestInteractionRunResponse,
      prefetched:
        | {
            interaction: TestInteractionResponse;
            chain: TestInteractionResponse[];
          }
        | undefined,
      cached: TestInteractionResponse[] | undefined
    ): Promise<ScanNextResponse | null> =>
      Promise.race([
        executeTestInteraction(
          adapter,
          run,
          testRun,
          expertises,
          analyzer,
          api,
          wrappedEvents,
          navigationSurface && bundleRun
            ? { navigationSurface, bundleRun, sentPageBodies }
            : undefined,
          config.scanScopePath,
          loginManager ?? undefined,
          cached,
          userData,
          prefetched
        ),
        new Promise<never>((_, reject) =>
          setTimeout(
            () =>
              reject(
                new Error(
                  `Test interaction ${run.id} timed out after ${INTERACTION_TIMEOUT_MS}ms`
                )
              ),
            INTERACTION_TIMEOUT_MS
          )
        ),
      ]).catch(async timeoutErr => {
        const msg =
          timeoutErr instanceof Error ? timeoutErr.message : String(timeoutErr);
        logRunner("interaction-runs:timeout", { runId: run.id, message: msg });
        try {
          await api.completeTestInteractionRun(run.id, {
            status: "skipped",
            errorMessage: msg,
          });
        } catch {
          // already completed by the executor's own error handler
        }
        wrappedEvents.onTestInteractionRunCompleted({
          testInteractionRunId: run.id,
          passed: true,
        });
        return null;
      });

    // When /scan/next returns the next interaction, execute it directly without
    // re-reading bundle state. Falls back to the full slow path when null.
    let pendingNext: ScanNextResponse["next"] | null = null;

    if (testRun.discovery && bundleRun) {
      try {
        const beginResult = await api.scanBegin({
          runnerId: config.runnerId,
          testRunId: testRun.id,
          bundleRunId: testRun.testSurfaceBundleRunId,
          testSurfaceBundleId: bundleRun.testSurfaceBundleId,
          sizeClass: testRun.sizeClass as any,
          testEnvironmentId: testRun.testEnvironmentId ?? undefined,
          url: testRun.scanUrl ?? config.baseUrl,
        });
        pendingNext = beginResult.next;
        logRunner("scan-begin:result", {
          hasNext: pendingNext != null,
          synthetic: pendingNext?.interactionRunId === 0,
        });
      } catch (err) {
        logRunner("scan-begin:failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Execution loop: select the next executable interaction across the bundle.
    while (true) {
      if (!(await waitForCheckpoint("before_surface"))) break;

      if (pendingNext) {
        if (!(await waitForCheckpoint("before_test_interaction"))) break;
        // Keep the session fresh during long next-driven stretches.
        if (loginManager?.isLoggedIn()) {
          const expired = await loginManager.detectSessionExpiry();
          if (expired) {
            logRunner("session:expired, re-logging in");
            await loginManager.reLogin();
          }
        }
        const next = pendingNext;
        pendingNext = null;
        logRunner("interaction-runs:next-driven", {
          runId: next.interactionRunId,
          surfaceRunId: next.surfaceRunId,
          testInteractionId: next.testInteraction.id,
        });
        const result = await executeOne(
          buildRunFromNext(next),
          {
            interaction: next.testInteraction,
            chain: next.dependencyChain ?? [next.testInteraction],
          },
          undefined
        );
        pendingNext = result?.next ?? null;
        if (!(await waitForCheckpoint("after_test_interaction"))) break;
        continue;
      }

      // Single consolidated call replaces getOpenTestSurfaceRuns + loadPendingInteractionRuns
      const runnerState = await api.getRunnerState(
        testRun.testSurfaceBundleRunId
      );
      const openSurfaceRuns = runnerState.openSurfaceRuns;
      logRunner("surface-runs:open", {
        bundleRunId: testRun.testSurfaceBundleRunId,
        count: openSurfaceRuns.length,
        openSurfaceRunIds: openSurfaceRuns.map(surfaceRun => surfaceRun.id),
      });
      if (openSurfaceRuns.length === 0) {
        break;
      }

      const testSurfaces = await api.getTestSurfacesByRunner(config.runnerId);
      // Scoped to this bundle run: the API returns only the scan's working set
      // (+ dependency closure + navigation interactions), not the runner's
      // entire interaction history.
      const testInteractions = await api.getTestInteractionsByRunner(
        config.runnerId,
        testRun.testSurfaceBundleRunId ?? undefined
      );

      const pendingInteractionRunsBySurface: PendingInteractionRunsBySurface[] =
        openSurfaceRuns.map(surfaceRun => {
          const allPendingRuns =
            runnerState.pendingInteractionRuns[String(surfaceRun.id)] ?? [];
          return {
            surfaceRun,
            eligibleRuns: allPendingRuns.filter(r => !r.blocked),
            allPendingRuns,
          };
        });

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
        // No runnable and no blocked work: the bundle is drained. /scan/next
        // now completes emptied surface runs server-side (and /scan/end closeout
        // finalizes any stragglers), so there is nothing for the runner to do
        // here — the scan is done.
        break;
      }

      // (Scan-mode skip cancellation now happens server-side in /scan/next's
      // selection, so the runner no longer batch-cancels skippables here. The
      // selection below is reached only on the bootstrap/safety path where
      // /scan/next has not already drained the bundle.)

      if (!(await waitForCheckpoint("before_test_interaction"))) break;

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
      publishStatusUpdate(
        describeInteractionStatus(
          selectedInteraction,
          testRun.scanUrl ?? config.baseUrl
        )
      );

      const slowResult = await executeOne(
        selected.testInteractionRun,
        undefined,
        testInteractions
      );
      pendingNext = slowResult?.next ?? null;
      activeDependencyBranch = buildDependencyChainIds(
        selected.testInteractionRun.testInteractionId,
        testInteractions
      );
      logRunner("interaction-runs:completed", {
        completedRunId: selected.testInteractionRun.id,
        completedSurfaceRunId: selected.surfaceRun.id,
        nextActiveDependencyBranch: activeDependencyBranch,
      });

      if (!(await waitForCheckpoint("after_test_interaction"))) break;
    }

    const stopped = config.signal?.aborted === true;

    logRunner("loop:exited", {
      testRunId: config.testRunId,
      bundleRunId: testRun.testSurfaceBundleRunId,
      completedInteractionRunCount: completedTestInteractionRunIds.size,
      stopped,
    });

    if (stopped) {
      publishStatusUpdate("Scan stopped by user — cancelling remaining work");

      const durationMs = Date.now() - startTime;
      try {
        await api.scanEnd({
          productId,
          testRunId: config.testRunId,
          bundleRunId: testRun.testSurfaceBundleRunId,
          status: "stopped",
          totalDurationMs: durationMs,
          pagesFound: pageIdsFound.size,
          pageStatesFound: pageStateIdsFound.size,
          testRunsCompleted: completedTestInteractionRunIds.size,
          status_update: "Scan stopped by user",
          runDetection: false,
        });
      } catch (err) {
        wrappedEvents.onError({
          message: `Scan end cleanup failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }

      const result: ScanResult = {
        testRunId: config.testRunId,
        pagesFound: pageIdsFound.size,
        pageStatesFound: pageStateIdsFound.size,
        testRunsCompleted: completedTestInteractionRunIds.size,
        findingsFound,
        durationMs,
      };

      wrappedEvents.onScanComplete({
        totalPages: pageIdsFound.size,
        totalFindings: findingsFound,
        durationMs,
      });

      wrappedEvents.onTestRunCompleted({
        testRunId: config.testRunId,
        passed: findingsFound === 0,
      });

      return result;
    }

    publishStatusUpdate("Finalizing scan results");

    await waitForCheckpoint("before_completion"); // ignore result — already finalizing

    // Final closeout writes the authoritative counts through /scan/end.
    if (statsFlushTimer != null) {
      clearTimeout(statsFlushTimer);
      statsFlushTimer = null;
    }
    statsDirty = false;

    const durationMs = Date.now() - startTime;
    const pagesFound = pageIdsFound.size;
    const pageStatesFound = pageStateIdsFound.size;
    const testRunsCompleted = completedTestInteractionRunIds.size;

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

    try {
      if (productId) {
        publishStatusUpdate("Detecting personas and scenarios");
      }
      const endResult = await api.scanEnd({
        productId,
        testRunId: config.testRunId,
        bundleRunId: testRun.testSurfaceBundleRunId,
        status: "completed",
        totalDurationMs: durationMs,
        pagesFound,
        pageStatesFound,
        testRunsCompleted,
        status_update: "Scan completed",
        runDetection: productId != null,
      });
      if (productId) {
        result.personas = endResult.personas.map((p: any) => ({
          id: p.id,
          title: p.title,
          description: p.description ?? "",
        }));
        if (endResult.personasDetected > 0 || endResult.scenariosDetected > 0) {
          wrappedEvents.onPersonasDetected?.(result.personas);
          publishStatusUpdate(
            `Detected ${endResult.personasDetected} persona(s) and ${endResult.scenariosDetected} scenario(s)`
          );
        } else {
          publishStatusUpdate("Detection completed with no results");
        }
      }
    } catch (err) {
      wrappedEvents.onError({
        message: `Post-scan detection failed: ${err instanceof Error ? err.message : String(err)}`,
      });
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
      await api.scanEnd({
        productId: closeoutProductId,
        testRunId: config.testRunId,
        bundleRunId: closeoutBundleRunId,
        status: "failed",
        totalDurationMs: Date.now() - startTime,
        status_update: `Scan failed: ${message}`,
        runDetection: false,
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

/**
 * Build a minimal TestInteractionRunResponse from a /scan/next `next` payload,
 * enough for executeTestInteraction (which only reads id, testInteractionId,
 * and testSurfaceRunId off the run).
 */
function buildRunFromNext(
  next: NonNullable<ScanNextResponse["next"]>
): TestInteractionRunResponse {
  return {
    id: next.interactionRunId,
    testInteractionId: next.testInteraction.id,
    testSurfaceRunId: next.surfaceRunId,
    status: "pending",
    durationMs: null,
    errorMessage: null,
    screenshotPath: null,
    consoleLog: null,
    networkLog: null,
    startedAt: null,
    completedAt: null,
    createdAt: null,
    expectedOutcome: null,
    observedOutcome: null,
    testEnvironmentId: null,
  } as TestInteractionRunResponse;
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
