import type { BrowserAdapter } from "../adapter";
import type { ApiClient } from "../api/client";
import type { ScanConfig, ScanEventHandler } from "./types";
import { extractActionableItems } from "../extractors";
import { computeHashes } from "../browser/page-utils";

async function captureCurrentPageState(
  config: ScanConfig,
  adapter: BrowserAdapter,
  api: ApiClient,
  testRunId: number
): Promise<{
  isNew: boolean;
  pageStateId: number;
  pageId: number;
  jobId?: number;
} | null> {
  const currentUrl = await adapter.getUrl();
  const current = new URL(currentUrl);
  const base = new URL(config.baseUrl);

  if (current.origin !== base.origin) {
    return null;
  }

  const relativePath = `${current.pathname}${current.search}${current.hash}`;
  const page = await api.findOrCreatePage(config.appId, relativePath);
  const html = await adapter.content();
  const items = await extractActionableItems(adapter);
  const hashes = await computeHashes(html, items);
  const existingState = await api.findMatchingPageState(
    page.id,
    hashes,
    config.sizeClass
  );

  if (existingState) {
    return { isNew: false, pageStateId: existingState.id, pageId: page.id };
  }

  const newState = await api.createPageState({
    pageId: page.id,
    sizeClass: config.sizeClass,
    hashes,
    contentText: html.slice(0, 5000),
    createdByTestRunId: testRunId,
  });

  const job = await api.createDecompositionJob(config.scanId, newState.id);
  return {
    isNew: true,
    pageStateId: newState.id,
    pageId: page.id,
    jobId: job.id,
  };
}

async function executeStoredAction(
  adapter: BrowserAdapter,
  config: ScanConfig,
  playwrightCode: string,
  fallbackPath?: string
): Promise<void> {
  const trimmedCode = playwrightCode.trim();

  if (
    trimmedCode.startsWith("await page.goto(") ||
    trimmedCode.startsWith("page.goto(")
  ) {
    const gotoPath = fallbackPath ?? config.scanUrl;
    const absoluteUrl = gotoPath.startsWith("http")
      ? gotoPath
      : new URL(gotoPath, config.baseUrl).toString();
    await adapter.goto(absoluteUrl, { waitUntil: "networkidle0" });
    return;
  }

  if (
    trimmedCode.startsWith("await page.waitForLoadState(") ||
    trimmedCode.startsWith("page.waitForLoadState(")
  ) {
    try {
      await adapter.waitForNavigation({
        waitUntil: "networkidle0",
        timeout: 5000,
      });
    } catch {
      // Treat "no navigation pending" as settled enough for scan orchestration.
    }
    return;
  }

  if (
    trimmedCode.startsWith("await page.click(") ||
    trimmedCode.startsWith("page.click(")
  ) {
    const selector = fallbackPath;
    if (!selector) throw new Error("Missing selector for click action");
    await adapter.click(selector);
    return;
  }

  if (
    trimmedCode.startsWith("await page.hover(") ||
    trimmedCode.startsWith("page.hover(")
  ) {
    const selector = fallbackPath;
    if (!selector) throw new Error("Missing selector for hover action");
    await adapter.hover(selector);
    return;
  }

  if (
    trimmedCode.startsWith("await page.screenshot(") ||
    trimmedCode.startsWith("page.screenshot(")
  ) {
    await adapter.screenshot({ type: "png" });
    return;
  }
}

export async function executeTestCases(
  config: ScanConfig,
  adapter: BrowserAdapter,
  api: ApiClient,
  events: ScanEventHandler
): Promise<boolean> {
  const testCases = await api.getTestCasesByApp(config.appId);
  let newJobsCreated = false;
  const completedCaseIds = new Set<number>();

  for (const tc of testCases) {
    if (config.signal?.aborted) break;

    // Check dependency
    if (tc.dependencyTestCaseId) {
      if (!completedCaseIds.has(tc.dependencyTestCaseId)) {
        continue;
      }
    }

    // Create test case run + child test run
    const testCaseRun = await api.createTestCaseRun({ testCaseId: tc.id });
    const testRun = await api.createTestRun({
      appId: config.appId,
      testCaseRunId: testCaseRun.id,
      parentTestRunId: config.scanId,
      rootTestRunId: config.scanId,
      sizeClass: config.sizeClass,
    });

    const startTime = Date.now();

    try {
      if (tc.startingPath) {
        await adapter.goto(
          new URL(tc.startingPath, config.baseUrl).toString(),
          {
            waitUntil: "networkidle0",
          }
        );
      }

      const actions = await api.getTestActionsByCase(tc.id);
      for (const action of actions) {
        switch (action.actionType) {
          case "goto":
            if (!action.path) {
              throw new Error("Goto test action missing path");
            }
            await adapter.goto(
              new URL(action.path, config.baseUrl).toString(),
              {
                waitUntil: "networkidle0",
              }
            );
            break;
          case "waitForLoadState":
            await executeStoredAction(
              adapter,
              config,
              action.playwrightCode,
              action.path ?? undefined
            );
            break;
          case "click":
            if (
              !action.path &&
              !action.playwrightCode.includes("page.click(")
            ) {
              throw new Error(
                `Unsupported click action without selector for test case ${tc.id}`
              );
            }
            await executeStoredAction(
              adapter,
              config,
              action.playwrightCode,
              action.path ?? undefined
            );
            break;
          case "fill":
            if (!action.path || action.value == null) {
              throw new Error(
                "Fill test action requires selector path and value"
              );
            }
            await adapter.type(action.path, action.value);
            break;
          case "select":
            if (!action.path || action.value == null) {
              throw new Error(
                "Select test action requires selector path and value"
              );
            }
            await adapter.select(action.path, action.value);
            break;
          case "radio_select":
            if (!action.path) {
              throw new Error(
                "Radio select test action requires selector path"
              );
            }
            await adapter.click(action.path);
            break;
          case "hover":
            if (!action.path) {
              throw new Error("Hover test action requires selector path");
            }
            await adapter.hover(action.path);
            break;
          case "screenshot":
            await executeStoredAction(
              adapter,
              config,
              action.playwrightCode,
              action.path ?? undefined
            );
            break;
          default:
            break;
        }

        const capturedState = await captureCurrentPageState(
          config,
          adapter,
          api,
          testRun.id
        );
        if (capturedState?.isNew) {
          if (capturedState.jobId == null) {
            throw new Error(
              "New page state was captured without a decomposition job"
            );
          }
          newJobsCreated = true;
          events.onPageStateCreated({
            pageStateId: capturedState.pageStateId,
            pageId: capturedState.pageId,
          });
          events.onDecompositionJobCreated({
            jobId: capturedState.jobId,
            pageStateId: capturedState.pageStateId,
          });
        }
      }

      const durationMs = Date.now() - startTime;
      await api.completeTestCaseRun(testCaseRun.id, {
        status: "completed",
        durationMs,
      });
      await api.completeTestRun(testRun.id, { status: "completed" });

      completedCaseIds.add(tc.id);
      events.onTestRunCompleted({ testRunId: testRun.id, passed: true });
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";

      await api.completeTestCaseRun(testCaseRun.id, {
        status: "failed",
        durationMs,
        errorMessage,
      });
      await api.completeTestRun(testRun.id, { status: "failed" });

      // Create finding for the error
      await api.createTestRunFinding({
        testCaseRunId: testCaseRun.id,
        type: "error",
        title: `Test failure: ${tc.title}`,
        description: errorMessage,
      });

      events.onFindingCreated({
        type: "error",
        title: `Test failure: ${tc.title}`,
      });

      events.onTestRunCompleted({ testRunId: testRun.id, passed: false });
    }
  }

  return newJobsCreated;
}
