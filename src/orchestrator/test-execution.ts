import type { BrowserAdapter } from "../adapter";
import type { ApiClient } from "../api/client";
import type { ScanConfig, ScanEventHandler } from "./types";
import { extractActionableItems } from "../extractors";
import { computeHashes } from "../browser/page-utils";

const LOG = (...args: unknown[]) => console.warn("[test-execution]", ...args);

/** Delay after each browser action to let the page settle. */
const POST_ACTION_DELAY_MS = 2000;

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error("Scan aborted");
}

/** Pages already discovered — only create decomposition jobs for NEW pages. */
const discoveredPagePaths = new Set<string>();

/**
 * After each action, check if we navigated to a new page (different path).
 * Only new pages trigger decomposition jobs. Same-page DOM changes from
 * clicks/hovers are ignored — they don't generate new test work.
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

  const relativePath = current.pathname;

  // Already seen this page path — no new work
  if (discoveredPagePaths.has(relativePath)) {
    return false;
  }
  discoveredPagePaths.add(relativePath);

  // New page discovered — create page, state, and decomposition job
  const page = await api.findOrCreatePage(config.runnerId, relativePath);
  events.onPageFound({ relativePath, pageId: page.id });

  const html = await adapter.content();
  const items = await extractActionableItems(adapter);
  const hashes = await computeHashes(html, items);

  const newState = await api.createPageState({
    pageId: page.id,
    sizeClass: config.sizeClass,
    hashes,
    contentText: html.slice(0, 5000),
    createdByTestRunId: testRunId,
  });
  events.onPageStateCreated({
    pageStateId: newState.id,
    pageId: page.id,
  });

  const job = await api.createDecompositionJob(config.scanId, newState.id);
  events.onDecompositionJobCreated({
    jobId: job.id,
    pageStateId: newState.id,
  });

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
  const scanPath = new URL(config.scanUrl).pathname;
  discoveredPagePaths.add(scanPath);

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
        if (new URL(currentUrl).pathname !== new URL(targetUrl).pathname) {
          LOG(`Navigating from ${currentUrl} to ${targetUrl}`);
          await adapter.goto(targetUrl, { waitUntil: "networkidle0" });
          await sleep(POST_ACTION_DELAY_MS);
        } else {
          LOG(
            `Already on ${new URL(currentUrl).pathname} — skipping navigation`
          );
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
            if (new URL(nowUrl).pathname !== new URL(gotoUrl).pathname) {
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
