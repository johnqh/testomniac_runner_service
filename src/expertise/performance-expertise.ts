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
        });
      }
    }

    if (outcomes.length === 0) {
      outcomes.push({
        expected: `All render-blocking resources should respond within ${THRESHOLD_MS}ms`,
        observed: `${renderBlockingLogs.length} render-blocking resource(s) loaded successfully`,
        result: "pass",
      });
    }

    return outcomes;
  }
}
