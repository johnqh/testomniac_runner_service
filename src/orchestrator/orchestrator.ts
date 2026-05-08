import type { BrowserAdapter } from "../adapter";
import type { ApiClient } from "../api/client";
import type { ScanConfig, ScanEventHandler, ScanResult } from "./types";
import { discoverPublicPages } from "./discovery";
import { processDecompositionJob } from "./decomposition";
import { executeTestCases } from "./test-execution";
import { captureCurrentPage, resetCapturedPagePaths } from "./page-capture";

const LOG = (...args: unknown[]) => console.warn("[orchestrator]", ...args);

function buildAiSummary(
  pagesFound: number,
  pageStatesFound: number,
  testRunsCompleted: number,
  findingsFound: number,
  expertiseSummary: Record<string, { warnings: number; errors: number }>
): string {
  const expertiseLines = Object.entries(expertiseSummary)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, counts]) => {
      const parts: string[] = [];
      if (counts.errors > 0)
        parts.push(`${counts.errors} error${counts.errors === 1 ? "" : "s"}`);
      if (counts.warnings > 0) {
        parts.push(
          `${counts.warnings} warning${counts.warnings === 1 ? "" : "s"}`
        );
      }
      return parts.length > 0
        ? `${name}: ${parts.join(", ")}`
        : `${name}: no findings`;
    });

  const headline =
    findingsFound === 0
      ? `Scan completed with no findings across ${pagesFound} page${pagesFound === 1 ? "" : "s"}.`
      : `Scan completed with ${findingsFound} finding${findingsFound === 1 ? "" : "s"} across ${pagesFound} page${pagesFound === 1 ? "" : "s"}.`;

  const detail = `Captured ${pageStatesFound} page state${pageStatesFound === 1 ? "" : "s"} and completed ${testRunsCompleted} test run${testRunsCompleted === 1 ? "" : "s"}.`;

  if (expertiseLines.length === 0) {
    return `${headline} ${detail}`;
  }

  return `${headline} ${detail} Findings by expertise: ${expertiseLines.join("; ")}.`;
}

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
  const expertiseSummary: Record<string, { warnings: number; errors: number }> =
    {};

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
      const match = /^\[([^\]]+)\]/.exec(finding.title);
      if (match?.[1]) {
        const expertiseName = match[1];
        const counts = expertiseSummary[expertiseName] ?? {
          warnings: 0,
          errors: 0,
        };
        if (finding.type === "error") {
          counts.errors += 1;
        } else if (finding.type === "warning") {
          counts.warnings += 1;
        }
        expertiseSummary[expertiseName] = counts;
      }
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
    resetCapturedPagePaths();

    // 1. Crawl the site from the scan URL to inventory public pages
    LOG(`Step 1: Discovering pages from ${config.scanUrl}`);
    await discoverPublicPages(adapter, config, api, wrappedHandler);

    // 2. Navigate back to scan URL and capture initial page state
    LOG(`Step 2: Navigating to ${config.scanUrl}`);
    await adapter.goto(config.scanUrl, { waitUntil: "networkidle0" });
    const initialCapture = await captureCurrentPage(
      adapter,
      config,
      api,
      wrappedHandler,
      {
        testRunId: config.scanId,
        markDiscovered: false,
        createDecompositionJob: true,
      }
    );
    if (!initialCapture?.pageStateId) {
      throw new Error("Failed to capture initial page state");
    }
    LOG(
      `Captured initial page state ${initialCapture.pageStateId} for ${initialCapture.relativePath}`
    );

    // 4. Generate/Run loop
    let iteration = 0;
    const MAX_ITERATIONS = 50;

    while (iteration < MAX_ITERATIONS) {
      if (config.signal?.aborted) {
        LOG("Aborted by signal");
        break;
      }
      iteration++;
      LOG(`=== Iteration ${iteration} ===`);

      // Phase 1: GENERATE — process all pending decomposition jobs
      const pendingJobs = await api.getPendingDecompositionJobs(config.scanId);
      LOG(`Pending decomposition jobs: ${pendingJobs.length}`);
      const testCaseIds: number[] = [];
      for (const job of pendingJobs) {
        if (config.signal?.aborted) break;
        const ids = await processDecompositionJob(
          job,
          adapter,
          config,
          api,
          wrappedHandler
        );
        LOG(
          `Job ${job.id} produced ${ids.length} test case IDs: [${ids.join(", ")}]`
        );
        testCaseIds.push(...ids);
        await api.completeDecompositionJob(job.id);
        wrappedHandler.onDecompositionJobCompleted({ jobId: job.id });
      }

      if (testCaseIds.length === 0) {
        LOG("No test cases generated — done");
        break;
      }

      // Phase 2: RUN — execute only the test cases just created
      LOG(
        `Executing ${testCaseIds.length} test cases: [${testCaseIds.join(", ")}]`
      );
      const newJobsCreated = await executeTestCases(
        config,
        adapter,
        api,
        wrappedHandler,
        testCaseIds
      );

      // If no new pages were discovered, we're done
      if (!newJobsCreated) {
        LOG("No new pages discovered — done");
        break;
      }
      LOG("New pages discovered — continuing to next iteration");
    }

    // 5. Complete test run
    const durationMs = Date.now() - startTime;
    const aiSummary = buildAiSummary(
      pagesFound,
      pageStatesFound,
      testRunsCompleted,
      findingsFound,
      expertiseSummary
    );
    await api.completeTestRun(config.scanId, {
      status: "completed",
      aiSummary,
      totalDurationMs: durationMs,
      pagesFound,
      pageStatesFound,
      testRunsCompleted,
    });

    const result: ScanResult = {
      testRunId: config.scanId,
      pagesFound,
      pageStatesFound,
      testRunsCompleted,
      findingsFound,
      durationMs,
      aiSummary,
      expertiseSummary,
    };

    wrappedHandler.onScanComplete({
      totalPages: pagesFound,
      totalFindings: findingsFound,
      durationMs,
      aiSummary,
      expertiseSummary,
    });

    return result;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown scan error";
    wrappedHandler.onError({ message });
    throw error;
  }
}
