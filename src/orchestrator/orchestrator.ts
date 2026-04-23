import type { BrowserAdapter } from "../adapter";
import type { ApiClient } from "../api/client";
import { PhaseTimer } from "../scanner/phase-timer";
import type {
  ScanConfig,
  ScanEventHandler,
  ScanResult,
  TestExecutor,
} from "./types";
import { runMouseScanning } from "./mouse-scanning";
import { runAiAnalysisPhase } from "./ai-analysis";
import { runInputScanningPhase } from "./input-scanning";
import { runTestGenerationPhase } from "./test-generation";
import { runTestExecutionPhase } from "./test-execution";

export async function runScan(
  adapter: BrowserAdapter,
  config: ScanConfig,
  api: ApiClient,
  eventHandler: ScanEventHandler,
  testExecutor?: TestExecutor
): Promise<ScanResult> {
  const timer = new PhaseTimer();

  let pagesFound = 0;
  let pageStatesFound = 0;
  let actionsCompleted = 0;
  let issuesFound = 0;

  const wrappedHandler: ScanEventHandler = {
    ...eventHandler,
    onPageFound(page) {
      pagesFound++;
      eventHandler.onPageFound(page);
      eventHandler.onStatsUpdated({
        pagesFound,
        pageStatesFound,
        actionsCompleted,
        issuesFound,
      });
    },
    onPageStateCreated(state) {
      pageStatesFound++;
      eventHandler.onPageStateCreated(state);
      eventHandler.onStatsUpdated({
        pagesFound,
        pageStatesFound,
        actionsCompleted,
        issuesFound,
      });
    },
    onActionCompleted(action) {
      actionsCompleted++;
      eventHandler.onActionCompleted(action);
      eventHandler.onStatsUpdated({
        pagesFound,
        pageStatesFound,
        actionsCompleted,
        issuesFound,
      });
    },
    onIssueDetected(issue) {
      issuesFound++;
      eventHandler.onIssueDetected(issue);
      eventHandler.onStatsUpdated({
        pagesFound,
        pageStatesFound,
        actionsCompleted,
        issuesFound,
      });
    },
  };

  try {
    await api.updateRunPhase(config.runId, "mouse_scanning");

    for (const phase of config.phases) {
      if (config.signal?.aborted) break;
      wrappedHandler.onPhaseChanged(phase);
      timer.startPhase(phase);

      try {
        switch (phase) {
          case "mouse_scanning":
            await runMouseScanning(adapter, config, api, wrappedHandler);
            break;
          case "ai_analysis":
            await runAiAnalysisPhase(config, api, wrappedHandler);
            break;
          case "input_scanning":
            await runInputScanningPhase(adapter, config, api, wrappedHandler);
            break;
          case "test_generation":
            await runTestGenerationPhase(config, api);
            break;
          case "test_execution":
            if (testExecutor) {
              await runTestExecutionPhase(
                config,
                api,
                wrappedHandler,
                testExecutor
              );
            }
            break;
        }
      } finally {
        timer.endPhase(phase);
        const durationMs = timer.getAllDurations()[phase] || 0;
        await api
          .updatePhaseDuration(config.runId, `${phase}_duration_ms`, durationMs)
          .catch(() => {});
      }
    }

    const totalDuration = timer.totalElapsed();
    await api.completeRun(config.runId, undefined, totalDuration);

    const result: ScanResult = {
      runId: config.runId,
      pagesFound,
      pageStatesFound,
      actionsCompleted,
      issuesFound,
      durationMs: totalDuration,
    };

    wrappedHandler.onScanComplete({
      totalPages: pagesFound,
      totalIssues: issuesFound,
      durationMs: totalDuration,
    });

    return result;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown scan error";
    wrappedHandler.onError({ message });
    throw error;
  }
}
