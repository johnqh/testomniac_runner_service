import type { BrowserAdapter } from "../adapter";
import type { ApiClient } from "../api/client";
import type { ScanConfig, ScanEventHandler } from "./types";
import { ensureDirectNavigationCase } from "./direct-navigation";
import { extractSameOriginLinks } from "../crawler/link-extractor";
import { toRelativePath } from "../crawler/url-normalizer";
import { captureCurrentPage } from "./page-capture";

const LOG = (...args: unknown[]) => console.warn("[discovery]", ...args);

const MAX_DISCOVERY_PAGES = 25;

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error("Scan aborted");
}

export interface DiscoveryResult {
  pageIdsByPath: Map<string, number>;
  visitedPaths: Set<string>;
  capturedPaths: Set<string>;
}

export async function discoverPublicPages(
  adapter: BrowserAdapter,
  config: ScanConfig,
  api: ApiClient,
  events: ScanEventHandler
): Promise<DiscoveryResult> {
  const queue: string[] = [config.scanUrl];
  const visitedPaths = new Set<string>();
  const pageIdsByPath = new Map<string, number>();
  const capturedPaths = new Set<string>();

  while (queue.length > 0 && visitedPaths.size < MAX_DISCOVERY_PAGES) {
    checkAbort(config.signal);
    const nextUrl = queue.shift();
    if (!nextUrl) break;

    LOG(`Visiting ${nextUrl}`);
    try {
      await adapter.goto(nextUrl, { waitUntil: "networkidle0" });
    } catch (error) {
      const relativePath = toRelativePath(nextUrl);
      if (config.testEnvironmentId) {
        await api.createPageVisit({
          testRunId: config.scanId,
          testEnvironmentId: config.testEnvironmentId,
          relativePath,
          status: "failed",
          errorMessage:
            error instanceof Error ? error.message : "Navigation failed",
        });
      }
      continue;
    }

    const currentUrl = await adapter.getUrl();
    const relativePath = toRelativePath(currentUrl);
    if (visitedPaths.has(relativePath)) {
      continue;
    }
    visitedPaths.add(relativePath);

    const page = await api.findOrCreatePage(config.runnerId, relativePath);
    pageIdsByPath.set(relativePath, page.id);
    await ensureDirectNavigationCase(api, config, events, relativePath);

    const captureResult = await captureCurrentPage(
      adapter,
      config,
      api,
      events,
      {
        testRunId: config.scanId,
        markDiscovered: true,
        captureState: relativePath !== toRelativePath(config.scanUrl),
        createDecompositionJob: relativePath !== toRelativePath(config.scanUrl),
      }
    );
    if (captureResult?.createdNewState) {
      capturedPaths.add(relativePath);
    }

    const discoveredLinks = await extractSameOriginLinks(
      adapter,
      config.baseUrl
    );
    LOG(`Discovered ${discoveredLinks.length} links on ${relativePath}`);

    if (config.testEnvironmentId && discoveredLinks.length > 0) {
      await api.createDiscoveredPages({
        testEnvironmentId: config.testEnvironmentId,
        pages: discoveredLinks.map(link => ({
          relativePath: link.relativePath,
          sourcePagePath: relativePath,
          sourceLabel: link.label,
          isPublic: true,
        })),
      });
    }

    for (const link of discoveredLinks) {
      if (!visitedPaths.has(link.relativePath)) {
        queue.push(link.url);
      }
    }
  }

  return { pageIdsByPath, visitedPaths, capturedPaths };
}
