/**
 * Executes an ordered list of test interactions for a test scenario sequence run.
 * Reuses executeTestInteraction() for each step.
 */

import type { BrowserAdapter } from "../adapter";
import type { ApiClient } from "../api/client";
import type { TestInteractionResponse } from "@sudobility/testomniac_types";
import type { Expertise } from "../expertise";
import { executeTestInteraction } from "./test-interaction-executor";
import type { ScanEventHandler } from "./types";
import { SizeClass } from "../domain/types";

function logSequence(step: string, details?: Record<string, unknown>): void {
  console.info("[SequenceRunner]", step, details ?? {});
}

export interface SequenceRunConfig {
  sequenceRunId: number;
  runnerId: number;
  runnerInstanceId: string;
  runnerInstanceName: string;
  sizeClass?: SizeClass;
  signal?: AbortSignal;
}

export interface SequenceRunResult {
  sequenceRunId: number;
  interactionsCompleted: number;
  interactionsFailed: number;
  durationMs: number;
}

/**
 * Load one interaction and its dependency chain by id.
 *
 * Returns the chain ROOT-FIRST with the requested interaction last, matching
 * what /scan/next hands the executor for discovery runs. Cycle-guarded.
 *
 * By id rather than from the runner-wide list because
 * GET /runners/:id/test-interactions strips stepsJson and
 * globalExpectationsJson, which left every sequence step with nothing to
 * execute and nothing to assert.
 */
async function loadInteractionWithChain(
  api: ApiClient,
  testInteractionId: number
): Promise<{
  interaction: TestInteractionResponse;
  chain: TestInteractionResponse[];
} | null> {
  const interaction = await api.getTestInteraction(testInteractionId);
  if (!interaction) return null;

  const chain: TestInteractionResponse[] = [interaction];
  const seen = new Set<number>([interaction.id]);
  let cursor = interaction.dependencyTestInteractionId ?? null;
  while (cursor != null && !seen.has(cursor)) {
    const parent = await api.getTestInteraction(cursor);
    if (!parent) break;
    seen.add(parent.id);
    chain.unshift(parent);
    cursor = parent.dependencyTestInteractionId ?? null;
  }
  return { interaction, chain };
}

export async function runSequenceRun(
  adapter: BrowserAdapter,
  config: SequenceRunConfig,
  api: ApiClient,
  expertises: Expertise[],
  events: ScanEventHandler
): Promise<SequenceRunResult> {
  const startTime = Date.now();
  let completed = 0;
  let failed = 0;

  // Get the sequence run and its ordered interactions
  const sequenceRun = await api.getSequenceRun(config.sequenceRunId);
  if (!sequenceRun) {
    throw new Error(`Sequence run ${config.sequenceRunId} not found`);
  }

  const links = await api.getSequenceTestInteractions(
    sequenceRun.testScenarioSequenceId
  );
  const orderedLinks = links.sort((a, b) => a.stepOrder - b.stepOrder);

  logSequence("starting", {
    sequenceRunId: config.sequenceRunId,
    interactionCount: orderedLinks.length,
  });
  events.onStatusUpdate?.({
    message: `Starting sequence run ${config.sequenceRunId}`,
  });

  // Resolve the environment's base URL. Without a scanUrl on the test run,
  // executeTestInteraction resolves a relative startingPath against bare
  // "http://localhost" (no port), which fails with ERR_CONNECTION_REFUSED for
  // anything not served on port 80. Non-fatal: an absent baseUrl just restores
  // the previous behaviour.
  let scanUrl: string | undefined;
  try {
    const sequence = await api.getTestScenarioSequence(
      sequenceRun.testScenarioSequenceId
    );
    if (sequence?.testEnvironmentId) {
      const environment = await api.getTestEnvironment(
        sequence.testEnvironmentId
      );
      scanUrl = environment?.baseUrl ?? undefined;
    }
  } catch (err) {
    logSequence("environment-lookup:failed", {
      sequenceRunId: config.sequenceRunId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Create a test run to track this sequence execution
  const testRun = await api.createTestRun({
    runnerId: config.runnerId,
    sizeClass: config.sizeClass ?? SizeClass.Desktop,
    discovery: false,
    scanUrl,
  });
  await api.claimTestRun(
    testRun.id,
    config.runnerInstanceId,
    config.runnerInstanceName
  );

  // NOTE: deliberately NOT using getTestInteractionsByRunner here.
  // GET /runners/:id/test-interactions excludes stepsJson and
  // globalExpectationsJson ("heavy JSON columns the list views never use"), so
  // every interaction arrived with null steps and null expectations: no step
  // ever ran and no expectation was ever evaluated. Fetch each interaction the
  // sequence will execute by id instead, which returns the full row.

  for (const link of orderedLinks) {
    if (config.signal?.aborted) break;

    const prefetched = await loadInteractionWithChain(
      api,
      link.testInteractionId
    );
    if (!prefetched) {
      logSequence("interaction-not-found", {
        testInteractionId: link.testInteractionId,
      });
      failed++;
      continue;
    }
    const testInteraction = prefetched.interaction;

    events.onStatusUpdate?.({
      testRunId: testRun.id,
      message: `Running sequence step ${link.stepOrder}: ${testInteraction.title}`,
    });

    // Create a test interaction run for this step
    const testInteractionRun = await api.createTestInteractionRun({
      testInteractionId: link.testInteractionId,
    });

    try {
      await executeTestInteraction(
        adapter,
        testInteractionRun,
        testRun,
        expertises,
        null, // no page analyzer for sequence runs
        api,
        events,
        undefined, // no discovery context
        undefined, // no scan scope path
        undefined, // no login manager
        undefined, // no cached set — prefetched supplies interaction + chain
        undefined, // no userData
        prefetched
      );
      completed++;
    } catch (err) {
      failed++;
      events.onError?.({
        message: `Sequence step ${link.stepOrder} failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  // Handle graceful stop
  const stopped = config.signal?.aborted === true;

  if (stopped) {
    await api.scanEnd({
      testRunId: testRun.id,
      status: "stopped",
      status_update: "Sequence stopped by user",
      runDetection: false,
    });
    await api.completeSequenceRun(config.sequenceRunId, { status: "stopped" });
    events.onStatusUpdate?.({
      testRunId: testRun.id,
      message: `Sequence run ${config.sequenceRunId} stopped by user`,
    });

    return {
      sequenceRunId: config.sequenceRunId,
      interactionsCompleted: completed,
      interactionsFailed: failed,
      durationMs: Date.now() - startTime,
    };
  }

  // Complete the test run and sequence run
  const status = failed > 0 ? "failed" : "completed";
  const statusMessage =
    status === "completed"
      ? `Sequence run ${config.sequenceRunId} completed`
      : `Sequence run ${config.sequenceRunId} failed`;
  await api.scanEnd({
    testRunId: testRun.id,
    status,
    status_update: statusMessage,
    runDetection: false,
  });
  await api.completeSequenceRun(config.sequenceRunId, { status });
  events.onStatusUpdate?.({ testRunId: testRun.id, message: statusMessage });

  const result: SequenceRunResult = {
    sequenceRunId: config.sequenceRunId,
    interactionsCompleted: completed,
    interactionsFailed: failed,
    durationMs: Date.now() - startTime,
  };

  logSequence("completed", { ...result });
  return result;
}
