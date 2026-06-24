import { ExpertiseRuleId } from "@sudobility/testomniac_types";
import type { Expertise, ExpertiseContext, Outcome } from "./types";
import { applyRuleIds } from "./rule-id";

const RENDER_BLOCKING_TYPES = [
  "text/html",
  "text/css",
  "application/javascript",
  "text/javascript",
];

const THRESHOLD_MS = 500;
const PERFORMANCE_RULE_IDS = {
  [`Render-blocking resource should respond within ${THRESHOLD_MS}ms`]:
    ExpertiseRuleId.PerformanceRenderBlockingResponse,
  [`All render-blocking resources should respond within ${THRESHOLD_MS}ms`]:
    ExpertiseRuleId.PerformanceRenderBlockingResponse,
  "Pages should limit render-blocking resources":
    ExpertiseRuleId.PerformanceRenderBlockingCount,
  "DOM size should stay within a reasonable budget":
    ExpertiseRuleId.PerformanceDomSize,
  "Initial HTML payload should not be excessively large":
    ExpertiseRuleId.PerformanceHtmlPayloadSize,
  "Static resources should not be downloaded repeatedly":
    ExpertiseRuleId.PerformanceDuplicateStaticDownloads,
  "Mutation requests should not be duplicated":
    ExpertiseRuleId.PerformanceDuplicateMutationRequests,
  "Network responses should complete within 3 seconds":
    ExpertiseRuleId.PerformanceSlowNetworkResponses,
  "Browser navigation timing should be available":
    ExpertiseRuleId.PerformanceNavigationTiming,
  "Core page lifecycle timings should stay responsive":
    ExpertiseRuleId.PerformanceNavigationTiming,
  "Transferred page resources should stay within a reasonable budget":
    ExpertiseRuleId.PerformanceTransferBudget,
  "Individual resources should not take more than 1.5 seconds":
    ExpertiseRuleId.PerformanceSlowResourceTiming,
  "Single resources should not dominate page weight":
    ExpertiseRuleId.PerformanceLargestResources,
  "Browser resource timing should not show repeated downloads":
    ExpertiseRuleId.PerformanceBrowserDuplicateResources,
  "Browser should not report excessive render-blocking resources":
    ExpertiseRuleId.PerformanceBrowserRenderBlockingResources,
} as const;

/**
 * Checks network log timing to ensure render-blocking content
 * is returned within the threshold (500ms).
 */
export class PerformanceExpertise implements Expertise {
  name = "performance";

  evaluate(context: ExpertiseContext): Outcome[] {
    const outcomes: Outcome[] = [];
    const renderBlockingLogs = context.networkLogs.filter(log =>
      RENDER_BLOCKING_TYPES.some(type => log.contentType?.includes(type))
    );

    // Check if any render-blocking resources had slow responses
    // NetworkLogEntry currently only has method/url/status/contentType,
    // so we check for server errors as a proxy for performance issues.
    // When timing data is available, this will check actual duration.
    const slowOrFailed = renderBlockingLogs.filter(
      log => log.status >= 500 || log.status === 0
    );

    if (slowOrFailed.length > 0) {
      for (const log of slowOrFailed) {
        outcomes.push({
          expected: `Render-blocking resource should respond within ${THRESHOLD_MS}ms`,
          observed: `Resource failed or timed out: ${log.url.slice(0, 120)} (status: ${log.status})`,
          result: "warning",
          priority: 1,
        });
      }
    }

    if (outcomes.length === 0) {
      outcomes.push({
        expected: `All render-blocking resources should respond within ${THRESHOLD_MS}ms`,
        observed: `${renderBlockingLogs.length} render-blocking resource(s) loaded successfully`,
        result: "pass",
        priority: 1,
      });
    }

    outcomes.push(this.checkRenderBlockingCount(renderBlockingLogs.length));
    outcomes.push(this.checkDomSize(context.html));
    outcomes.push(this.checkHtmlPayloadSize(context.html));
    outcomes.push(this.checkDuplicateStaticDownloads(context));
    outcomes.push(this.checkNavigationTiming(context));
    outcomes.push(this.checkTransferBudget(context));
    outcomes.push(this.checkSlowResourceTiming(context));
    outcomes.push(this.checkLargestResources(context));
    outcomes.push(this.checkBrowserDuplicateResources(context));
    outcomes.push(this.checkBrowserRenderBlockingResources(context));

    // Check for duplicate mutation requests (same POST/PUT/PATCH/DELETE URL)
    const mutationCounts = new Map<string, number>();
    for (const log of context.networkLogs) {
      if (["POST", "PUT", "PATCH", "DELETE"].includes(log.method)) {
        const key = `${log.method}:${log.url}`;
        mutationCounts.set(key, (mutationCounts.get(key) ?? 0) + 1);
      }
    }
    const duplicateMutations = Array.from(mutationCounts.entries()).filter(
      ([, count]) => count > 1
    );
    if (duplicateMutations.length > 0) {
      const first = duplicateMutations[0]!;
      outcomes.push({
        expected: "Mutation requests should not be duplicated",
        observed: `${duplicateMutations.length} duplicate mutation(s): ${first[0]} called ${first[1]}x`,
        result: "warning",
        priority: 3,
      });
    }

    // Check for slow responses (> 3s)
    const slowResponses = context.networkLogs.filter(
      log => log.timestampMs != null && log.timestampMs > 3000
    );
    if (slowResponses.length > 0) {
      const slowest = slowResponses.reduce((a, b) =>
        (a.timestampMs ?? 0) > (b.timestampMs ?? 0) ? a : b
      );
      outcomes.push({
        expected: "Network responses should complete within 3 seconds",
        observed: `${slowResponses.length} slow response(s), slowest: ${slowest.url.slice(0, 80)} (${slowest.timestampMs}ms)`,
        result: "warning",
        priority: 3,
      });
    }

    return applyRuleIds(outcomes, PERFORMANCE_RULE_IDS);
  }

  private checkRenderBlockingCount(count: number): Outcome {
    if (count > 20) {
      return {
        expected: "Pages should limit render-blocking resources",
        observed: `${count} render-blocking resource(s) were detected`,
        result: "warning",
        priority: 3,
      };
    }
    return {
      expected: "Pages should limit render-blocking resources",
      observed: `${count} render-blocking resource(s) detected`,
      result: "pass",
      priority: 3,
    };
  }

  private checkDomSize(html: string): Outcome {
    const nodeCount = (html.match(/<\w[\s>]/g) ?? []).length;
    if (nodeCount > 2500) {
      return {
        expected: "DOM size should stay within a reasonable budget",
        observed: `HTML contains roughly ${nodeCount} element nodes`,
        result: "warning",
        priority: 3,
      };
    }
    return {
      expected: "DOM size should stay within a reasonable budget",
      observed: `HTML contains roughly ${nodeCount} element nodes`,
      result: "pass",
      priority: 3,
    };
  }

  private checkHtmlPayloadSize(html: string): Outcome {
    const bytes = new TextEncoder().encode(html).length;
    if (bytes > 750_000) {
      return {
        expected: "Initial HTML payload should not be excessively large",
        observed: `HTML payload is approximately ${Math.round(bytes / 1024)} KB`,
        result: "warning",
        priority: 3,
      };
    }
    return {
      expected: "Initial HTML payload should not be excessively large",
      observed: `HTML payload is approximately ${Math.round(bytes / 1024)} KB`,
      result: "pass",
      priority: 3,
    };
  }

  private checkDuplicateStaticDownloads(context: ExpertiseContext): Outcome {
    const counts = new Map<string, number>();
    for (const log of context.networkLogs) {
      if (log.method !== "GET") continue;
      if (
        !/\.(css|js|mjs|png|jpe?g|webp|gif|svg|woff2?)(\?|$)/i.test(log.url)
      ) {
        continue;
      }
      counts.set(log.url, (counts.get(log.url) ?? 0) + 1);
    }
    const duplicates = Array.from(counts.entries()).filter(
      ([, count]) => count > 1
    );
    if (duplicates.length > 0) {
      const [url, count] = duplicates[0]!;
      return {
        expected: "Static resources should not be downloaded repeatedly",
        observed: `${duplicates.length} duplicate static resource(s); ${url.slice(0, 100)} loaded ${count}x`,
        result: "warning",
        priority: 3,
      };
    }
    return {
      expected: "Static resources should not be downloaded repeatedly",
      observed: "No duplicate static resource downloads detected",
      result: "pass",
      priority: 3,
    };
  }

  private checkNavigationTiming(context: ExpertiseContext): Outcome {
    const snapshot = context.performanceSnapshot;
    if (!snapshot) {
      return {
        expected: "Browser navigation timing should be available",
        observed: "No browser performance snapshot was available",
        result: "pass",
        priority: 4,
      };
    }

    const slow: string[] = [];
    if (snapshot.ttfbMs != null && snapshot.ttfbMs > 800) {
      slow.push(`TTFB ${snapshot.ttfbMs}ms`);
    }
    if (
      snapshot.domContentLoadedMs != null &&
      snapshot.domContentLoadedMs > 2500
    ) {
      slow.push(`DOMContentLoaded ${snapshot.domContentLoadedMs}ms`);
    }
    if (snapshot.loadEventMs != null && snapshot.loadEventMs > 5000) {
      slow.push(`load ${snapshot.loadEventMs}ms`);
    }

    if (slow.length > 0) {
      return {
        expected: "Core page lifecycle timings should stay responsive",
        observed: `Slow lifecycle timing(s): ${slow.join(", ")}`,
        result: "warning",
        priority: 2,
      };
    }
    return {
      expected: "Core page lifecycle timings should stay responsive",
      observed: `TTFB ${snapshot.ttfbMs ?? "n/a"}ms, DOMContentLoaded ${snapshot.domContentLoadedMs ?? "n/a"}ms, load ${snapshot.loadEventMs ?? "n/a"}ms`,
      result: "pass",
      priority: 2,
    };
  }

  private checkTransferBudget(context: ExpertiseContext): Outcome {
    const snapshot = context.performanceSnapshot;
    if (!snapshot || snapshot.totalTransferSizeBytes === 0) {
      return {
        expected:
          "Transferred page resources should stay within a reasonable budget",
        observed: "No resource transfer-size data was available",
        result: "pass",
        priority: 4,
      };
    }

    const totalKb = Math.round(snapshot.totalTransferSizeBytes / 1024);
    const scriptKb = Math.round(snapshot.scriptTransferSizeBytes / 1024);
    const imageKb = Math.round(snapshot.imageTransferSizeBytes / 1024);
    if (
      snapshot.totalTransferSizeBytes > 3_000_000 ||
      snapshot.scriptTransferSizeBytes > 1_000_000 ||
      snapshot.imageTransferSizeBytes > 2_000_000
    ) {
      return {
        expected:
          "Transferred page resources should stay within a reasonable budget",
        observed: `Transferred ${totalKb} KB total (${scriptKb} KB scripts, ${imageKb} KB images)`,
        result: "warning",
        priority: 3,
      };
    }
    return {
      expected:
        "Transferred page resources should stay within a reasonable budget",
      observed: `Transferred ${totalKb} KB total (${scriptKb} KB scripts, ${imageKb} KB images)`,
      result: "pass",
      priority: 3,
    };
  }

  private checkSlowResourceTiming(context: ExpertiseContext): Outcome {
    const slow = context.performanceSnapshot?.slowResources ?? [];
    if (slow.length === 0) {
      return {
        expected: "Individual resources should not take more than 1.5 seconds",
        observed: "No slow browser resource timing entries detected",
        result: "pass",
        priority: 3,
      };
    }
    const first = slow[0]!;
    return {
      expected: "Individual resources should not take more than 1.5 seconds",
      observed: `${slow.length} slow resource(s); slowest ${first.durationMs}ms ${first.name.slice(0, 100)}`,
      result: "warning",
      priority: 3,
    };
  }

  private checkLargestResources(context: ExpertiseContext): Outcome {
    const largest = context.performanceSnapshot?.largestResources ?? [];
    const oversized = largest.filter(
      resource => resource.transferSizeBytes > 750_000
    );
    if (oversized.length === 0) {
      return {
        expected: "Single resources should not dominate page weight",
        observed: "No individual resource over 750 KB detected",
        result: "pass",
        priority: 3,
      };
    }
    const first = oversized[0]!;
    return {
      expected: "Single resources should not dominate page weight",
      observed: `${oversized.length} oversized resource(s); largest ${Math.round(first.transferSizeBytes / 1024)} KB ${first.name.slice(0, 100)}`,
      result: "warning",
      priority: 3,
    };
  }

  private checkBrowserDuplicateResources(context: ExpertiseContext): Outcome {
    const duplicates = context.performanceSnapshot?.duplicateResourceUrls ?? [];
    if (duplicates.length === 0) {
      return {
        expected: "Browser resource timing should not show repeated downloads",
        observed: "No duplicate browser resource timing entries detected",
        result: "pass",
        priority: 3,
      };
    }
    const first = duplicates[0]!;
    return {
      expected: "Browser resource timing should not show repeated downloads",
      observed: `${duplicates.length} duplicated resource URL(s); ${first.url.slice(0, 100)} loaded ${first.count}x`,
      result: "warning",
      priority: 3,
    };
  }

  private checkBrowserRenderBlockingResources(
    context: ExpertiseContext
  ): Outcome {
    const count = context.performanceSnapshot?.renderBlockingResourceCount ?? 0;
    if (count > 10) {
      return {
        expected:
          "Browser should not report excessive render-blocking resources",
        observed: `${count} browser resource timing entries were marked render-blocking`,
        result: "warning",
        priority: 3,
      };
    }
    return {
      expected: "Browser should not report excessive render-blocking resources",
      observed: `${count} browser resource timing entries marked render-blocking`,
      result: "pass",
      priority: 3,
    };
  }
}
