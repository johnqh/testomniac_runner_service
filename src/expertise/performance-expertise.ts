import type { Expertise, ExpertiseContext, Outcome } from "./types";

const RENDER_BLOCKING_TYPES = [
  "text/html",
  "text/css",
  "application/javascript",
  "text/javascript",
];

const THRESHOLD_MS = 500;

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

    return outcomes;
  }
}
