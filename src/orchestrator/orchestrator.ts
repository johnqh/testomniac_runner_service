import type { BrowserAdapter } from "../adapter";
import type { ApiClient } from "../api/client";
import type { ScanConfig, ScanEventHandler, ScanResult } from "./types";
import { processDecompositionJob } from "./decomposition";
import { executeTestCases } from "./test-execution";

export async function runScan(
  adapter: BrowserAdapter,
  config: ScanConfig,
  api: ApiClient,
  eventHandler: ScanEventHandler
): Promise<ScanResult> {
  const startTime = Date.now();

  let pagesFound = 0;
  let pageStatesFound = 0;
  let testRunsCompleted = 0;
  let findingsFound = 0;

  const wrappedHandler: ScanEventHandler = {
    ...eventHandler,
    onPageFound(page) {
      pagesFound++;
      eventHandler.onPageFound(page);
      emitStats();
    },
    onPageStateCreated(state) {
      pageStatesFound++;
      eventHandler.onPageStateCreated(state);
      emitStats();
    },
    onTestRunCompleted(run) {
      testRunsCompleted++;
      eventHandler.onTestRunCompleted(run);
      emitStats();
    },
    onFindingCreated(finding) {
      findingsFound++;
      eventHandler.onFindingCreated(finding);
      emitStats();
    },
  };

  function emitStats() {
    eventHandler.onStatsUpdated({
      pagesFound,
      pageStatesFound,
      testRunsCompleted,
      findingsFound,
    });
  }

  try {
    // 1. Navigate to scan URL, capture initial page state
    await adapter.goto(config.scanUrl, { waitUntil: "networkidle0" });
    const initialHtml = await adapter.content();

    // Compute relative path from scanUrl and baseUrl
    const scanUrlObj = new URL(config.scanUrl);
    const relativePath = scanUrlObj.pathname;

    const page = await api.findOrCreatePage(config.appId, relativePath);
    wrappedHandler.onPageFound({ relativePath, pageId: page.id });

    // Import page-utils for hash computation
    const { computeHashes } = await import("../browser/page-utils");
    const { extractActionableItems } = await import("../extractors");
    const items = await extractActionableItems(adapter);
    const hashes = await computeHashes(initialHtml, items);

    const initialPageState = await api.createPageState({
      pageId: page.id,
      sizeClass: config.sizeClass,
      hashes,
      screenshotPath: undefined,
      contentText: initialHtml.slice(0, 5000),
    });
    wrappedHandler.onPageStateCreated({
      pageStateId: initialPageState.id,
      pageId: page.id,
    });

    // 2. Create initial AI Decomposition Job
    const initialJob = await api.createDecompositionJob(
      config.scanId,
      initialPageState.id
    );
    wrappedHandler.onDecompositionJobCreated({
      jobId: initialJob.id,
      pageStateId: initialPageState.id,
    });

    // 3. Generate/Run loop
    let iteration = 0;
    const MAX_ITERATIONS = 50;

    while (iteration < MAX_ITERATIONS) {
      if (config.signal?.aborted) break;
      iteration++;

      // Phase 1: GENERATE — process all pending decomposition jobs
      const pendingJobs = await api.getPendingDecompositionJobs(config.scanId);
      for (const job of pendingJobs) {
        if (config.signal?.aborted) break;
        await processDecompositionJob(
          job,
          adapter,
          config,
          api,
          wrappedHandler
        );
        await api.completeDecompositionJob(job.id);
        wrappedHandler.onDecompositionJobCompleted({ jobId: job.id });
      }

      // Phase 2: RUN — execute test cases, check for new page states
      const newJobsCreated = await executeTestCases(
        config,
        adapter,
        api,
        wrappedHandler
      );

      // If no new decomposition jobs were created, we're done
      if (!newJobsCreated) break;
    }

    // 4. Complete test run
    const durationMs = Date.now() - startTime;
    await api.completeTestRun(config.scanId, {
      status: "completed",
      totalDurationMs: durationMs,
      pagesFound,
      pageStatesFound,
      testRunsCompleted,
    });

    const result: ScanResult = {
      scanId: config.scanId,
      pagesFound,
      pageStatesFound,
      testRunsCompleted,
      findingsFound,
      durationMs,
    };

    wrappedHandler.onScanComplete({
      totalPages: pagesFound,
      totalFindings: findingsFound,
      durationMs,
    });

    return result;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown scan error";
    wrappedHandler.onError({ message });
    throw error;
  }
}
