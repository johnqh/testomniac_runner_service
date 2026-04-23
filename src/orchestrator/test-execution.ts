import type { ApiClient } from "../api/client";
import type { ScanConfig, ScanEventHandler, TestExecutor } from "./types";
import { DESKTOP_SCREENS } from "../domain/types";

export async function runTestExecutionPhase(
  config: ScanConfig,
  api: ApiClient,
  events: ScanEventHandler,
  executor: TestExecutor
): Promise<void> {
  const testCases = await api.getTestCasesByApp(config.appId);
  const screen = DESKTOP_SCREENS[0];

  for (const tc of testCases) {
    const testRun = await api.createTestRun({
      testCaseId: tc.id,
      scanId: config.runId,
      screen: config.sizeClass || "desktop",
    });

    try {
      // Parse actions from the test case (stored as JSON)
      const actions = (tc as any).actionsJson || [];
      const result = await executor.executeTestCase(actions, screen);

      await api.completeTestRun(testRun.id, {
        status: result.passed ? "passed" : "failed",
        durationMs: result.durationMs,
        errorMessage: result.error,
      });

      if (!result.passed && result.error) {
        await api.createIssue({
          scanId: config.runId,
          testCaseId: tc.id,
          testRunId: testRun.id,
          type: "test_failure",
          description: result.error,
          reproductionSteps: [],
        });
        events.onIssueDetected({
          type: "test_failure",
          description: `${tc.name}: ${result.error}`,
        });
      }
    } catch (error) {
      await api.completeTestRun(testRun.id, {
        status: "failed",
        durationMs: 0,
        errorMessage: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }
}
