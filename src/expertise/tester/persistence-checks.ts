import type { ExpertiseContext, Outcome } from "../types";

export function checkStatePersistsAfterReload(
  expectation: {
    description: string;
    expectedTextTokens?: string[];
  },
  context: ExpertiseContext
): Outcome {
  const tokens = expectation.expectedTextTokens?.length
    ? expectation.expectedTextTokens
    : ["cart", "bag", "basket", "filter", "sort", "qty", "quantity"];

  const initialSignals = extractTokenSignals(context.initialHtml, tokens);
  const finalSignals = extractTokenSignals(context.html, tokens);

  if (initialSignals.length === 0 || finalSignals.length === 0) {
    return {
      expected: expectation.description,
      observed:
        "Could not extract comparable persisted-state signals from page content",
      result: "warning",
    };
  }

  const missing = initialSignals.filter(
    signal => !finalSignals.includes(signal)
  );
  if (missing.length > 0) {
    return {
      expected: expectation.description,
      observed: `Expected persisted signals were missing after reload: ${missing.join(", ")}`,
      result: "error",
    };
  }

  return {
    expected: expectation.description,
    observed: "Key visible state signals persisted after reload",
    result: "pass",
  };
}

export function checkBackNavigationRestoresState(
  expectation: { description: string },
  context: ExpertiseContext
): Outcome {
  if (!context.initialUrl || !context.currentUrl) {
    return {
      expected: expectation.description,
      observed: "Navigation context was unavailable",
      result: "warning",
    };
  }

  if (context.initialUrl === context.currentUrl) {
    return {
      expected: expectation.description,
      observed: `Back navigation returned to ${context.currentUrl}`,
      result: "pass",
    };
  }

  if (normalizeHtml(context.initialHtml) === normalizeHtml(context.html)) {
    return {
      expected: expectation.description,
      observed: "Back navigation restored the prior DOM state",
      result: "pass",
    };
  }

  return {
    expected: expectation.description,
    observed: `Back navigation did not restore the prior state (${context.initialUrl} -> ${context.currentUrl})`,
    result: "error",
  };
}

export function checkForwardNavigationReappliesState(
  expectation: { description: string },
  context: ExpertiseContext
): Outcome {
  if (!context.initialUrl || !context.currentUrl) {
    return {
      expected: expectation.description,
      observed: "Navigation context was unavailable",
      result: "warning",
    };
  }

  if (context.initialUrl !== context.currentUrl) {
    return {
      expected: expectation.description,
      observed: `Forward navigation reapplied a different state (${context.initialUrl} -> ${context.currentUrl})`,
      result: "pass",
    };
  }

  if (normalizeHtml(context.initialHtml) !== normalizeHtml(context.html)) {
    return {
      expected: expectation.description,
      observed: "Forward navigation changed the DOM state",
      result: "pass",
    };
  }

  return {
    expected: expectation.description,
    observed: "Forward navigation did not reapply a distinct state",
    result: "error",
  };
}

function extractTokenSignals(html: string, tokens: string[]): string[] {
  const text = stripHtml(html).toLowerCase();
  const matches: string[] = [];

  for (const token of tokens) {
    const regex = new RegExp(
      `(?:${escapeRegex(token)})\\D{0,18}(\\d{1,4}|[a-z0-9_-]{2,30})`,
      "gi"
    );
    for (const match of text.matchAll(regex)) {
      matches.push(`${token}:${match[1]}`);
    }
  }

  return Array.from(new Set(matches));
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeHtml(html: string): string {
  return html.replace(/\s+/g, " ").trim();
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
