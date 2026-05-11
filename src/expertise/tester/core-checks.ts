import type { ExpertiseContext, Outcome } from "../types";

export function checkPageLoaded(
  context: ExpertiseContext,
  description: string
): Outcome {
  const hasHtml = context.html.length > 0 && context.html.includes("<");

  if (!hasHtml) {
    return {
      expected: description,
      observed: "Page returned empty or non-HTML response",
      result: "error",
    };
  }

  return {
    expected: description,
    observed: "Page loaded successfully with HTML content",
    result: "pass",
  };
}

export function checkNoConsoleErrors(
  context: ExpertiseContext,
  description: string
): Outcome {
  const errors = context.consoleLogs.filter(
    log => log.toLowerCase().startsWith("error") || log.includes("[ERROR]")
  );

  if (errors.length > 0) {
    return {
      expected: description,
      observed: `${errors.length} console error(s): ${errors[0]}`,
      result: "error",
    };
  }

  return {
    expected: description,
    observed: "No console errors detected",
    result: "pass",
  };
}

export function checkNoNetworkErrors(
  context: ExpertiseContext,
  description: string
): Outcome {
  const errors = context.networkLogs.filter(log => log.status >= 400);

  if (errors.length > 0) {
    return {
      expected: description,
      observed: `${errors.length} network error(s): ${errors[0].url} (${errors[0].status})`,
      result: "error",
    };
  }

  return {
    expected: description,
    observed: "No network errors detected",
    result: "pass",
  };
}
