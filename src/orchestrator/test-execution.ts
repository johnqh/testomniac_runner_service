import type { BrowserAdapter } from "../adapter";
import type { ApiClient } from "../api/client";
import type { ScanConfig, ScanEventHandler } from "./types";
import { extractActionableItems } from "../extractors";
import { toRelativePath } from "../crawler/url-normalizer";
import {
  captureCurrentPage,
  hasCapturedPagePath,
  seedCapturedPagePath,
} from "./page-capture";

const LOG = (...args: unknown[]) => console.warn("[test-execution]", ...args);

/** Delay after each browser action to let the page settle. */
const POST_ACTION_DELAY_MS = 2000;

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error("Scan aborted");
}

/**
 * After each action, capture the current same-origin state. New paths are
 * discovered once, but same-path DOM transitions can still generate new page
 * states and decomposition work when their structural hashes change.
 */
async function captureCurrentPageState(
  config: ScanConfig,
  adapter: BrowserAdapter,
  api: ApiClient,
  testRunId: number,
  events: ScanEventHandler
): Promise<boolean> {
  const currentUrl = await adapter.getUrl();
  const current = new URL(currentUrl);
  const base = new URL(config.baseUrl);

  // Off-site navigation — skip
  if (current.origin !== base.origin) {
    return false;
  }

  const relativePath = toRelativePath(currentUrl);
  const captureResult = await captureCurrentPage(adapter, config, api, events, {
    testRunId,
    markDiscovered: !hasCapturedPagePath(relativePath),
    createDecompositionJob: true,
  });
  if (!captureResult?.createdNewState) {
    return false;
  }

  return true;
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
    await sleep(POST_ACTION_DELAY_MS);
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
    await sleep(POST_ACTION_DELAY_MS);
    return;
  }

  if (
    trimmedCode.startsWith("await page.click(") ||
    trimmedCode.startsWith("page.click(")
  ) {
    const selector = fallbackPath;
    if (!selector) throw new Error("Missing selector for click action");
    await adapter.click(selector);
    await sleep(POST_ACTION_DELAY_MS);
    return;
  }

  if (
    trimmedCode.startsWith("await page.hover(") ||
    trimmedCode.startsWith("page.hover(")
  ) {
    const selector = fallbackPath;
    if (!selector) throw new Error("Missing selector for hover action");
    await adapter.hover(selector);
    await sleep(POST_ACTION_DELAY_MS);
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
  events: ScanEventHandler,
  testCaseIds: number[]
): Promise<boolean> {
  // Seed the initial scan URL path so we don't re-discover it
  const scanPath = toRelativePath(config.scanUrl);
  seedCapturedPagePath(scanPath);

  // Only fetch and execute the specific test cases from this scan's decomposition
  LOG(`Fetching test cases for runner ${config.runnerId}`);
  const allTestCases = await api.getTestCasesByRunner(config.runnerId);
  LOG(
    `Total test cases for runner: ${allTestCases.length}, target IDs: [${testCaseIds.join(", ")}]`
  );
  const targetIds = new Set(testCaseIds);
  const testCases = allTestCases.filter(tc => targetIds.has(tc.id));
  LOG(`Matched ${testCases.length} test cases to execute`);
  let newJobsCreated = false;
  const completedCaseIds = new Set<number>();

  for (const tc of testCases) {
    checkAbort(config.signal);
    LOG(
      `--- Executing test case ${tc.id}: "${tc.title}" startingPath=${tc.startingPath}`
    );

    // Check dependency
    if (tc.dependencyTestCaseId) {
      if (!completedCaseIds.has(tc.dependencyTestCaseId)) {
        LOG(
          `Skipping — dependency ${tc.dependencyTestCaseId} not completed yet`
        );
        continue;
      }
    }

    // Create test case run + child test run
    const testCaseRun = await api.createTestCaseRun({ testCaseId: tc.id });
    const testRun = await api.createTestRun({
      runnerId: config.runnerId,
      testCaseRunId: testCaseRun.id,
      parentTestRunId: config.scanId,
      rootTestRunId: config.scanId,
      sizeClass: config.sizeClass,
    });

    const startTime = Date.now();

    try {
      if (tc.startingPath) {
        const targetUrl = new URL(tc.startingPath, config.baseUrl).toString();
        const currentUrl = await adapter.getUrl();
        if (toRelativePath(currentUrl) !== toRelativePath(targetUrl)) {
          LOG(`Navigating from ${currentUrl} to ${targetUrl}`);
          await adapter.goto(targetUrl, { waitUntil: "networkidle0" });
          await sleep(POST_ACTION_DELAY_MS);
        } else {
          LOG(`Already on ${toRelativePath(currentUrl)} — skipping navigation`);
        }
      }

      // Re-inject data-tmnc-id attributes into the DOM (they are transient
      // and lost when the page re-renders, e.g. React SPA)
      await extractActionableItems(adapter);

      const actions = await api.getTestActionsByCase(tc.id);
      LOG(`Test case has ${actions.length} actions`);
      for (const action of actions) {
        checkAbort(config.signal);
        LOG(
          `Action: ${action.actionType} path=${action.path?.slice(0, 60)} value=${action.value?.slice(0, 30)}`
        );

        switch (action.actionType) {
          case "goto": {
            if (!action.path) {
              throw new Error("Goto test action missing path");
            }
            const gotoUrl = new URL(action.path, config.baseUrl).toString();
            const nowUrl = await adapter.getUrl();
            if (toRelativePath(nowUrl) !== toRelativePath(gotoUrl)) {
              await adapter.goto(gotoUrl, { waitUntil: "networkidle0" });
              await sleep(POST_ACTION_DELAY_MS);
            }
            break;
          }
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
            await sleep(POST_ACTION_DELAY_MS);
            break;
          case "select":
          case "selectOption":
            if (!action.path || action.value == null) {
              throw new Error(
                "Select test action requires selector path and value"
              );
            }
            await adapter.select(action.path, action.value);
            await sleep(POST_ACTION_DELAY_MS);
            break;
          case "radio_select":
            if (!action.path) {
              throw new Error(
                "Radio select test action requires selector path"
              );
            }
            await adapter.click(action.path);
            await sleep(POST_ACTION_DELAY_MS);
            break;
          case "hover":
            if (!action.path) {
              throw new Error("Hover test action requires selector path");
            }
            await adapter.hover(action.path);
            await sleep(POST_ACTION_DELAY_MS);
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

        const isNewPage = await captureCurrentPageState(
          config,
          adapter,
          api,
          testRun.id,
          events
        );
        if (isNewPage) {
          newJobsCreated = true;
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
      LOG(`ERROR in test case ${tc.id} "${tc.title}":`, errorMessage);
      if (error instanceof Error && error.stack) {
        LOG(`Stack:`, error.stack);
      }

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
    } finally {
      // Close any tabs/windows opened during this test case
      if (adapter.closeOtherTabs) {
        try {
          await adapter.closeOtherTabs();
        } catch {
          // Ignore cleanup errors
        }
      }
    }
  }

  return newJobsCreated;
}
