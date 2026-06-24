import type { BrowserAdapter } from "../adapter";
import type { ApiClient } from "../api/client";
import type { DedupStore } from "../storage/dedup-store";
import type {
  TestInteractionResponse,
  TestInteractionRunResponse,
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

      // /scan/next drives the entire execution loop now: it selects the next
      // runnable interaction server-side and performs the mid-loop transitions
      // (cancel scan-mode skips, complete drained surfaces) with cascade
      // re-evaluation. So a null `pendingNext` means /scan/next found no runnable
      // work — a terminal state. Classify it via runner state and exit; the
      // legacy client-side fallback scheduler has been removed.
      const runnerState = await api.getRunnerState(
        testRun.testSurfaceBundleRunId
      );
      const openSurfaceRuns = runnerState.openSurfaceRuns;
      logRunner("surface-runs:open", {
        bundleRunId: testRun.testSurfaceBundleRunId,
        count: openSurfaceRuns.length,
        openSurfaceRunIds: openSurfaceRuns.map(surfaceRun => surfaceRun.id),
      });
      if (openSurfaceRuns.length === 0) break; // scan complete

      const pendingRuns = openSurfaceRuns.flatMap(
        surfaceRun =>
          runnerState.pendingInteractionRuns[String(surfaceRun.id)] ?? []
      );
      // Open surface runs but zero pending interaction runs: drained but not yet
      // marked completed — /scan/end closeout finalizes them. Nothing to do.
      if (pendingRuns.length === 0) break;

      const runnableRuns = pendingRuns.filter(run => !run.blocked);
      if (runnableRuns.length > 0) {
        // /scan/next returns a runnable `next` whenever one exists, so reaching
        // here with runnable work means the scan was never next-driven (e.g.
        // scanBegin failed to produce the initial interaction). Fail loudly
        // rather than silently leaving work unexecuted.
        logRunner("interaction-runs:no-next-with-runnable", {
          bundleRunId: testRun.testSurfaceBundleRunId,
          runnableRunIds: runnableRuns.map(run => run.id),
        });
        throw new Error(
          `Scan produced no next interaction but ${runnableRuns.length} runnable run(s) remain for bundle run ${testRun.testSurfaceBundleRunId}`
        );
      }

      // All remaining pending runs are blocked -> deadlocked dependency tree.
      logRunner("interaction-runs:blocked-tree", {
        bundleRunId: testRun.testSurfaceBundleRunId,
        blockedRunIds: pendingRuns.map(run => run.id),
      });
      throw new Error(
        `Blocked interaction tree detected for bundle run ${testRun.testSurfaceBundleRunId}`
      );
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
