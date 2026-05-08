import type { SizeClass } from "../domain/types";

export interface RunConfig {
  testRunId: number;
  runnerId: number;
  baseUrl: string;
  sizeClass: SizeClass;
  testEnvironmentId?: number;
  uid?: string;
  runnerInstanceId: string;
  runnerInstanceName: string;
  signal?: AbortSignal;
}

/** @deprecated Use RunConfig */
export type ScanConfig = RunConfig & {
  scanId: number;
  scanUrl: string;
  openaiApiKey?: string;
  openaiModel?: string;
  testWorkerCount?: number;
};

export interface ScanEventHandler {
  onPageFound(page: { relativePath: string; pageId: number }): void;
  onPageStateCreated(state: {
    pageStateId: number;
    pageId: number;
    screenshotPath?: string;
  }): void;
  onDecompositionJobCreated(job: { jobId: number; pageStateId: number }): void;
  onDecompositionJobCompleted(job: { jobId: number }): void;
  onTestSuiteCreated(suite: { suiteId: number; title: string }): void;
  onTestCaseRunCompleted(run: { testCaseRunId: number; passed: boolean }): void;
  onTestRunCompleted(run: { testRunId: number; passed: boolean }): void;
  onFindingCreated(finding: { type: string; title: string }): void;
  onStatsUpdated(stats: {
    pagesFound: number;
    pageStatesFound: number;
    testRunsCompleted: number;
    findingsFound: number;
  }): void;
  onScreenshotCaptured(data: { dataUrl: string; pageUrl: string }): void;
  onScanComplete(summary: {
    totalPages: number;
    totalFindings: number;
    durationMs: number;
    aiSummary?: string;
    expertiseSummary?: Record<
      string,
      {
        warnings: number;
        errors: number;
      }
    >;
  }): void;
  onError(error: { message: string }): void;
}

export interface ScanResult {
  testRunId: number;
  pagesFound: number;
  pageStatesFound: number;
  testRunsCompleted: number;
  findingsFound: number;
  durationMs: number;
  aiSummary?: string;
  expertiseSummary?: Record<
    string,
    {
      warnings: number;
      errors: number;
    }
  >;
}
