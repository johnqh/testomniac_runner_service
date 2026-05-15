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
      priority: 0,
    };
  }

  if (!hasHtml) {
    return {
      expected: description,
      observed: "Page returned empty or non-HTML response",
      result: "error",
      priority: 0,
    };
  }

  return {
    expected: description,
    observed: "Page loaded successfully with HTML content",
    result: "pass",
    priority: 3,
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
      priority: 3,
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
      priority: 3,
    };
  }

  return {
    expected: description,
    observed: "No console errors detected",
    result: "pass",
    priority: 3,
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
      priority: 3,
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
      priority: 1,
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
      priority: 3,
    };
  }

  if (errors.length > 0) {
    return {
      expected: description,
      observed: `${errors.length} third-party or non-critical network error(s) ignored`,
      result: "pass",
      priority: 3,
    };
  }

  return {
    expected: description,
    observed: "No network errors detected",
    result: "pass",
    priority: 3,
  };
}

export function checkDuplicateRequests(
  context: ExpertiseContext,
  description: string
): Outcome {
  const urlCounts = new Map<string, number>();
  for (const log of context.networkLogs) {
    if (log.method === "GET") continue; // GET duplicates are common (polling)
    const key = `${log.method}:${log.url}`;
    urlCounts.set(key, (urlCounts.get(key) ?? 0) + 1);
  }

  const duplicates = Array.from(urlCounts.entries()).filter(
    ([, count]) => count > 1
  );

  if (duplicates.length > 0) {
    const first = duplicates[0]!;
    return {
      expected: description,
      observed: `${duplicates.length} duplicate mutation request(s): ${first[0].split(":").slice(0, 2).join(":")} called ${first[1]} times`,
      result: "warning",
      priority: 3,
    };
  }

  return {
    expected: description,
    observed: "No duplicate mutation requests detected",
    result: "pass",
    priority: 3,
  };
}

export function checkSlowResponses(
  context: ExpertiseContext,
  description: string
): Outcome {
  const slow = context.networkLogs.filter(
    log => log.timestampMs != null && log.timestampMs > 3000
  );

  if (slow.length > 0) {
    const slowest = slow.reduce((a, b) =>
      (a.timestampMs ?? 0) > (b.timestampMs ?? 0) ? a : b
    );
    return {
      expected: description,
      observed: `${slow.length} slow response(s): ${slowest.url.slice(0, 80)} took ${slowest.timestampMs}ms`,
      result: "warning",
      priority: 3,
    };
  }

  return {
    expected: description,
    observed: "No slow responses detected (all < 3s)",
    result: "pass",
    priority: 3,
  };
}

export function checkMixedContent(
  context: ExpertiseContext,
  description: string
): Outcome {
  const pageUrl = context.currentUrl || context.initialUrl || "";
  const isHttps = pageUrl.startsWith("https://");

  if (!isHttps) {
    return {
      expected: description,
      observed: "Page is not served over HTTPS",
      result: "pass",
      priority: 3,
    };
  }

  const httpResources = context.networkLogs.filter(
    log =>
      log.url.startsWith("http://") &&
      !log.url.startsWith("http://localhost") &&
      !log.url.startsWith("http://127.0.0.1")
  );

  if (httpResources.length > 0) {
    return {
      expected: description,
      observed: `${httpResources.length} HTTP resource(s) loaded on HTTPS page: ${httpResources[0]!.url.slice(0, 80)}`,
      result: "warning",
      priority: 3,
    };
  }

  return {
    expected: description,
    observed: "No mixed content detected",
    result: "pass",
    priority: 3,
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
