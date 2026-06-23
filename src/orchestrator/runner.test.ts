import { describe, expect, it } from "vitest";
import { runTestRun } from "./runner";
import type { RunConfig, ScanEventHandler } from "./types";
import type { ApiClient } from "../api/client";
import type { BrowserAdapter } from "../adapter";

function makeStubAdapter(): BrowserAdapter {
  return {
    goto: async () => ({ status: 200 }),
    currentUrl: () => "http://test.local",
    getPageHtml: async () => "<html></html>",
    getInnerText: async () => "",
    evaluate: async () => null,
    screenshot: async () => "",
    scrollToBottom: async () => {},
    close: async () => {},
    getConsoleLogs: () => [],
    getNetworkLogs: () => [],
    clearLogs: () => {},
    click: async () => {},
    type: async () => {},
    hover: async () => {},
    waitForSelector: async () => true,
    selectOption: async () => {},
    waitForNavigation: async () => {},
    getViewportSize: () => ({ width: 1280, height: 720 }),
  } as unknown as BrowserAdapter;
}

function makeStubEvents(): ScanEventHandler {
  return {
    onPageFound: () => {},
    onPageStateCreated: () => {},
    onTestSurfaceCreated: () => {},
    onTestInteractionRunCompleted: () => {},
    onTestRunCompleted: () => {},
    onFindingCreated: () => {},
    onStatsUpdated: () => {},
    onScreenshotCaptured: () => {},
    onScanComplete: () => {},
    onError: () => {},
  };
}

describe("runTestRun graceful abort", () => {
  it("returns early with stopped status when signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort(); // pre-abort

    let completedStatus: string | undefined;
    const api = {
      scanEnd: async (payload: { status: string }) => {
        completedStatus = payload.status;
        return {
          personas: [],
          scenarios: [],
          personasDetected: 0,
          scenariosDetected: 0,
        };
      },
    } as unknown as ApiClient;

    const config: RunConfig = {
      testRunId: 999,
      runnerId: 1,
      baseUrl: "http://test.local",
      sizeClass: "desktop",
      runnerInstanceId: "test-instance",
      runnerInstanceName: "Test",
      signal: controller.signal,
    };

    const result = await runTestRun(
      makeStubAdapter(),
      config,
      api,
      [],
      makeStubEvents()
    );

    expect(result.testRunId).toBe(999);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(completedStatus).toBe("stopped");
  });
});
