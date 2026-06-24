import type { BrowserAdapter } from "../adapter";

export interface PerformanceResourceSummary {
  name: string;
  initiatorType: string;
  durationMs: number;
  transferSizeBytes: number;
  renderBlockingStatus?: string;
}

export interface PerformanceSnapshot {
  ttfbMs: number | null;
  domContentLoadedMs: number | null;
  loadEventMs: number | null;
  resourceCount: number;
  totalTransferSizeBytes: number;
  scriptTransferSizeBytes: number;
  stylesheetTransferSizeBytes: number;
  imageTransferSizeBytes: number;
  slowResources: PerformanceResourceSummary[];
  largestResources: PerformanceResourceSummary[];
  duplicateResourceUrls: Array<{ url: string; count: number }>;
  renderBlockingResourceCount: number;
}

export async function capturePerformanceSnapshot(
  adapter: BrowserAdapter
): Promise<PerformanceSnapshot> {
  return adapter.evaluate(() => {
    type ResourceSummary = {
      name: string;
      initiatorType: string;
      durationMs: number;
      transferSizeBytes: number;
      renderBlockingStatus?: string;
    };

    const round = (value: number) => Math.round(value);
    const navigation = performance.getEntriesByType("navigation")[0] as
      | PerformanceNavigationTiming
      | undefined;
    const resources = performance.getEntriesByType(
      "resource"
    ) as PerformanceResourceTiming[];

    const summarize = (entry: PerformanceResourceTiming): ResourceSummary => ({
      name: entry.name,
      initiatorType: entry.initiatorType || "other",
      durationMs: round(entry.duration),
      transferSizeBytes: entry.transferSize || 0,
      renderBlockingStatus:
        "renderBlockingStatus" in entry
          ? String(
              (
                entry as PerformanceResourceTiming & {
                  renderBlockingStatus?: string;
                }
              ).renderBlockingStatus ?? ""
            )
          : undefined,
    });

    const byUrl = new Map<string, number>();
    let totalTransferSizeBytes = 0;
    let scriptTransferSizeBytes = 0;
    let stylesheetTransferSizeBytes = 0;
    let imageTransferSizeBytes = 0;
    let renderBlockingResourceCount = 0;

    for (const entry of resources) {
      byUrl.set(entry.name, (byUrl.get(entry.name) ?? 0) + 1);
      totalTransferSizeBytes += entry.transferSize || 0;
      if (entry.initiatorType === "script") {
        scriptTransferSizeBytes += entry.transferSize || 0;
      }
      if (entry.initiatorType === "link" || entry.initiatorType === "css") {
        stylesheetTransferSizeBytes += entry.transferSize || 0;
      }
      if (entry.initiatorType === "img" || entry.initiatorType === "image") {
        imageTransferSizeBytes += entry.transferSize || 0;
      }
      const maybeBlocking = entry as PerformanceResourceTiming & {
        renderBlockingStatus?: string;
      };
      if (maybeBlocking.renderBlockingStatus === "blocking") {
        renderBlockingResourceCount += 1;
      }
    }

    const slowResources = resources
      .filter(entry => entry.duration > 1500)
      .sort((a, b) => b.duration - a.duration)
      .slice(0, 5)
      .map(summarize);
    const largestResources = resources
      .filter(entry => (entry.transferSize || 0) > 0)
      .sort((a, b) => (b.transferSize || 0) - (a.transferSize || 0))
      .slice(0, 5)
      .map(summarize);
    const duplicateResourceUrls = Array.from(byUrl.entries())
      .filter(([, count]) => count > 1)
      .sort(([, left], [, right]) => right - left)
      .slice(0, 5)
      .map(([url, count]) => ({ url, count }));

    return {
      ttfbMs: navigation
        ? round(navigation.responseStart - navigation.requestStart)
        : null,
      domContentLoadedMs: navigation
        ? round(navigation.domContentLoadedEventEnd - navigation.startTime)
        : null,
      loadEventMs: navigation
        ? round(navigation.loadEventEnd - navigation.startTime)
        : null,
      resourceCount: resources.length,
      totalTransferSizeBytes,
      scriptTransferSizeBytes,
      stylesheetTransferSizeBytes,
      imageTransferSizeBytes,
      slowResources,
      largestResources,
      duplicateResourceUrls,
      renderBlockingResourceCount,
    };
  });
}
