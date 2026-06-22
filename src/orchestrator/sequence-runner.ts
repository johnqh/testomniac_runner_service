/**
 * Executes an ordered list of test interactions for a test scenario sequence run.
 * Reuses executeTestInteraction() for each step.
 */

import type { BrowserAdapter } from "../adapter";
import type { ApiClient } from "../api/client";
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

  // Create a test run to track this sequence execution
  const testRun = await api.createTestRun({
    runnerId: config.runnerId,
    sizeClass: config.sizeClass ?? SizeClass.Desktop,
    discovery: false,
  });
  await api.claimTestRun(
    testRun.id,
    config.runnerInstanceId,
    config.runnerInstanceName
  );

  // Pre-fetch all test interactions for the runner (used by executor)
  const allTestInteractions = await api.getTestInteractionsByRunner(
    config.runnerId
  );

  for (const link of orderedLinks) {
    if (config.signal?.aborted) break;

    const testInteraction = allTestInteractions.find(
      ti => ti.id === link.testInteractionId
    );
    if (!testInteraction) {
      logSequence("interaction-not-found", {
        testInteractionId: link.testInteractionId,
      });
      failed++;
      continue;
    }

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
        allTestInteractions // cached — avoids re-fetch per interaction
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
