import type { TestAction, Screen } from "../domain/types";

export type ScanPhase =
  | "mouse_scanning"
  | "ai_analysis"
  | "input_scanning"
  | "test_generation"
  | "test_execution";

export interface ScanConfig {
  runId: number;
  appId: number;
  baseUrl: string;
  phases: ScanPhase[];
  sizeClass?: string;
  openaiApiKey?: string;
  openaiModel?: string;
  testWorkerCount?: number;
  /** AbortSignal to cancel the scan. When aborted, the scan loop exits gracefully. */
  signal?: AbortSignal;
}

export interface ScanEventHandler {
  onPageFound(page: { url: string; pageId: number }): void;
  onPageStateCreated(state: {
    pageStateId: number;
    pageId: number;
    screenshotPath?: string;
  }): void;
  onActionCompleted(action: {
    type: string;
    selector?: string;
    pageUrl: string;
  }): void;
  onIssueDetected(issue: { type: string; description: string }): void;
  onPhaseChanged(phase: string): void;
  onStatsUpdated(stats: {
    pagesFound: number;
    pageStatesFound: number;
    actionsCompleted: number;
    issuesFound: number;
  }): void;
  onScreenshotCaptured(data: { dataUrl: string; pageUrl: string }): void;
  onScanComplete(summary: {
    totalPages: number;
    totalIssues: number;
    durationMs: number;
  }): void;
  onError(error: { message: string; phase?: string }): void;
}

export interface TestExecutor {
  executeTestCase(
    actions: TestAction[],
    screen: Screen
  ): Promise<{ passed: boolean; error?: string; durationMs: number }>;
}

export interface ScanResult {
  runId: number;
  pagesFound: number;
  pageStatesFound: number;
  actionsCompleted: number;
  issuesFound: number;
  durationMs: number;
}
