import type { ExpertiseContext, Outcome } from "../types";
import type { NetworkLogEntry } from "@sudobility/testomniac_types";

export function checkPageLoaded(
  context: ExpertiseContext,
  description: string
): Outcome {
  const html = typeof context.html === "string" ? context.html : "";
  const hasHtml = html.length > 0 && html.includes("<");
  const documentFailure = findCurrentDocumentFailure(context);

  if (documentFailure) {
    return {
      expected: description,
      observed: `Page returned HTTP ${documentFailure.status} for ${documentFailure.url}`,
      result: "error",
    };
  }

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

  // Also flag significant warnings (deprecated APIs, missing config, failed resources)
  const significantWarningPatterns =
    /\b(deprecated|does not exist|not found|failed to load|ERR_NAME_NOT_RESOLVED)\b/i;
  const significantWarnings = context.consoleLogs.filter(
    log =>
      (log.toLowerCase().startsWith("warn") || log.includes("[WARNING]")) &&
      significantWarningPatterns.test(log)
  );

  if (significantWarnings.length > 0) {
    return {
      expected: description,
      observed: `${significantWarnings.length} significant console warning(s): ${significantWarnings[0]}`,
      result: "warning",
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
  // Status 0 typically indicates DNS failure, CORS block, or aborted request
  const errors = context.networkLogs.filter(
    log => log.status >= 400 || log.status === 0
  );

  if (errors.length === 0) {
    return {
      expected: description,
      observed: "No network errors detected",
      result: "pass",
    };
  }

  const pageOrigin = getPageOrigin(context);
  const criticalErrors = errors.filter(error =>
    isCriticalNetworkError(error, pageOrigin)
  );

  if (criticalErrors.length > 0) {
    return {
      expected: description,
      observed: `${criticalErrors.length} critical network error(s): ${criticalErrors[0]!.url} (${criticalErrors[0]!.status})`,
      result: "error",
    };
  }

  const sameOriginErrors = pageOrigin
    ? errors.filter(error => isSameOrigin(error.url, pageOrigin))
    : [];
  if (sameOriginErrors.length > 0) {
    return {
      expected: description,
      observed: `${sameOriginErrors.length} non-critical same-origin network error(s): ${sameOriginErrors[0]!.url} (${sameOriginErrors[0]!.status})`,
      result: "warning",
    };
  }

  if (errors.length > 0) {
    return {
      expected: description,
      observed: `${errors.length} third-party or non-critical network error(s) ignored`,
      result: "pass",
    };
  }

  return {
    expected: description,
    observed: "No network errors detected",
    result: "pass",
  };
}

function getPageOrigin(context: ExpertiseContext): string | null {
  const candidateUrl = context.currentUrl || context.initialUrl || "";
  try {
    return candidateUrl ? new URL(candidateUrl).origin : null;
  } catch {
    return null;
  }
}

function isCriticalNetworkError(
  entry: NetworkLogEntry,
  pageOrigin: string | null
): boolean {
  if (!pageOrigin || !isSameOrigin(entry.url, pageOrigin)) {
    return false;
  }

  const url = entry.url.toLowerCase();
  const contentType = (entry.contentType || "").toLowerCase();

  if (entry.status >= 500) {
    return true;
  }

  if (looksDocumentLike(url, contentType)) {
    return true;
  }

  if (looksApiLike(url, contentType)) {
    return true;
  }

  if (looksScriptOrStyleLike(url, contentType)) {
    return true;
  }

  return false;
}

function isSameOrigin(url: string, origin: string): boolean {
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
}

function normalizeComparableUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname.replace(/\/+$/, "") || "/";
    return `${parsed.origin}${pathname}${parsed.search}`;
  } catch {
    return null;
  }
}

function findCurrentDocumentFailure(
  context: ExpertiseContext
): NetworkLogEntry | null {
  const pageOrigin = getPageOrigin(context);
  const currentUrl = normalizeComparableUrl(
    context.currentUrl || context.initialUrl || ""
  );

  if (!pageOrigin || !currentUrl) {
    return null;
  }

  return (
    context.networkLogs.find(entry => {
      if (entry.status < 400) return false;
      if (!isSameOrigin(entry.url, pageOrigin)) return false;
      if (
        !looksDocumentLike(entry.url, (entry.contentType || "").toLowerCase())
      )
        return false;

      const entryUrl = normalizeComparableUrl(entry.url);
      return entryUrl === currentUrl;
    }) ?? null
  );
}

function looksDocumentLike(url: string, contentType: string): boolean {
  return (
    contentType.includes("text/html") ||
    contentType.includes("application/xhtml") ||
    !/\.(js|mjs|css|png|jpe?g|gif|webp|svg|ico|woff2?|ttf|otf|map|mp4|mp3|webm)(?:\?|$)/i.test(
      url
    )
  );
}

function looksApiLike(url: string, contentType: string): boolean {
  return (
    contentType.includes("application/json") ||
    contentType.includes("application/problem+json") ||
    /\/(api|graphql)(?:\/|$)/i.test(url) ||
    /[?&](query|search|term|q|page|size|sort|filter)=/i.test(url)
  );
}

function looksScriptOrStyleLike(url: string, contentType: string): boolean {
  return (
    contentType.includes("javascript") ||
    contentType.includes("ecmascript") ||
    contentType.includes("text/css") ||
    /\.(js|mjs|css)(?:\?|$)/i.test(url)
  );
}
