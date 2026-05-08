import type { BrowserAdapter } from "../adapter";
import type { ApiClient } from "../api/client";
import type { ScanConfig, ScanEventHandler } from "./types";
import { computeHashes } from "../browser/page-utils";
import { toRelativePath } from "../crawler/url-normalizer";
import { extractActionableItems } from "../extractors";
import { executePageExpertises } from "./expertise";

export interface CapturePageOptions {
  testRunId?: number;
  markDiscovered?: boolean;
  captureState?: boolean;
  createDecompositionJob?: boolean;
}

export interface CapturePageResult {
  pageId: number;
  relativePath: string;
  pageStateId?: number;
  decompositionJobId?: number;
  createdNewState: boolean;
  matchedExistingState: boolean;
}

const capturedPagePaths = new Set<string>();

export function resetCapturedPagePaths(): void {
  capturedPagePaths.clear();
}

export function seedCapturedPagePath(relativePath: string): void {
  capturedPagePaths.add(relativePath);
}

export function hasCapturedPagePath(relativePath: string): boolean {
  return capturedPagePaths.has(relativePath);
}

export async function captureCurrentPage(
  adapter: BrowserAdapter,
  config: ScanConfig,
  api: ApiClient,
  events: ScanEventHandler,
  options: CapturePageOptions = {}
): Promise<CapturePageResult | null> {
  const currentUrl = await adapter.getUrl();
  const current = new URL(currentUrl);
  const base = new URL(config.baseUrl);

  if (current.origin !== base.origin) {
    return null;
  }

  const relativePath = toRelativePath(currentUrl);
  const page = await api.findOrCreatePage(config.runnerId, relativePath);

  if (options.markDiscovered) {
    events.onPageFound({ relativePath, pageId: page.id });

    if (config.testEnvironmentId) {
      await api.createDiscoveredPages({
        testEnvironmentId: config.testEnvironmentId,
        pages: [{ relativePath, isPublic: true }],
      });
    }

    if (config.testEnvironmentId && options.testRunId) {
      await api.createPageVisit({
        testRunId: options.testRunId,
        testEnvironmentId: config.testEnvironmentId,
        relativePath,
        status: "visited",
      });
    }
  }

  if (hasCapturedPagePath(relativePath)) {
    return {
      pageId: page.id,
      relativePath,
      createdNewState: false,
      matchedExistingState: false,
    };
  }

  if (options.captureState === false) {
    return {
      pageId: page.id,
      relativePath,
      createdNewState: false,
      matchedExistingState: false,
    };
  }

  const html = await adapter.content();
  const items = await extractActionableItems(adapter);
  const hashes = await computeHashes(html, items);
  const existingState = await api.findMatchingPageState(
    page.id,
    hashes,
    config.sizeClass
  );

  if (existingState) {
    seedCapturedPagePath(relativePath);
    return {
      pageId: page.id,
      relativePath,
      pageStateId: existingState.id,
      createdNewState: false,
      matchedExistingState: true,
    };
  }

  const pageState = await api.createPageState({
    pageId: page.id,
    sizeClass: config.sizeClass,
    hashes,
    contentText: html.slice(0, 5000),
    createdByTestRunId: options.testRunId,
  });
  seedCapturedPagePath(relativePath);

  events.onPageStateCreated({
    pageStateId: pageState.id,
    pageId: page.id,
  });

  await executePageExpertises(
    adapter,
    config,
    api,
    events,
    pageState.id,
    page.id,
    relativePath
  );

  let decompositionJobId: number | undefined;
  if (options.createDecompositionJob) {
    const job = await api.createDecompositionJob(config.scanId, pageState.id);
    decompositionJobId = job.id;
    events.onDecompositionJobCreated({
      jobId: job.id,
      pageStateId: pageState.id,
    });
  }

  return {
    pageId: page.id,
    relativePath,
    pageStateId: pageState.id,
    decompositionJobId,
    createdNewState: true,
    matchedExistingState: false,
  };
}
