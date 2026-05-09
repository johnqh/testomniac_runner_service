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

const discoveredPagePaths = new Set<string>();
const capturedStateKeys = new Set<string>();

function toStateKey(
  relativePath: string,
  hashes: {
    normalizedHtmlHash: string;
    actionableHash: string;
  }
): string {
  return `${relativePath}:${hashes.normalizedHtmlHash}:${hashes.actionableHash}`;
}

export function resetCapturedPagePaths(): void {
  discoveredPagePaths.clear();
  capturedStateKeys.clear();
}

export function seedCapturedPagePath(relativePath: string): void {
  discoveredPagePaths.add(relativePath);
}

export function hasCapturedPagePath(relativePath: string): boolean {
  return discoveredPagePaths.has(relativePath);
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
    const firstTimeDiscovered = !hasCapturedPagePath(relativePath);
    if (firstTimeDiscovered) {
      events.onPageFound({ relativePath, pageId: page.id });

      if (config.testEnvironmentId) {
        await api.createDiscoveredPages({
          testEnvironmentId: config.testEnvironmentId,
          pages: [{ relativePath, isPublic: true }],
        });
      }

      seedCapturedPagePath(relativePath);
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
  const stateKey = toStateKey(relativePath, hashes);

  if (capturedStateKeys.has(stateKey)) {
    return {
      pageId: page.id,
      relativePath,
      createdNewState: false,
      matchedExistingState: false,
    };
  }

  const existingState = await api.findMatchingPageState(
    page.id,
    hashes,
    config.sizeClass
  );

  if (existingState) {
    capturedStateKeys.add(stateKey);
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
  capturedStateKeys.add(stateKey);

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
