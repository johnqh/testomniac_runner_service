import type { ExpertiseContext, Outcome } from "../types";

export function checkResultsChanged(
  expectation: {
    description: string;
    expectedTextTokens?: string[];
  },
  context: ExpertiseContext
): Outcome {
  const tokens = expectation.expectedTextTokens?.length
    ? expectation.expectedTextTokens
    : ["results", "products", "items", "matches", "showing", "search"];
  const initialSummary = extractRelevantSummary(context.initialHtml, tokens);
  const finalSummary = extractRelevantSummary(context.html, tokens);

  if (initialSummary && finalSummary) {
    if (normalizeText(initialSummary) === normalizeText(finalSummary)) {
      return {
        expected: expectation.description,
        observed: "Results-like summary text did not change after the action",
        result: "error",
      };
    }

    return {
      expected: expectation.description,
      observed: "Results-like summary text changed after the action",
      result: "pass",
    };
  }

  const initialSignature = extractCollectionSignature(context.initialHtml);
  const finalSignature = extractCollectionSignature(context.html);
  if (
    initialSignature &&
    finalSignature &&
    initialSignature !== finalSignature
  ) {
    return {
      expected: expectation.description,
      observed:
        "Visible result ordering or composition changed after the action",
      result: "pass",
    };
  }

  if (
    context.initialUrl &&
    context.currentUrl &&
    context.initialUrl !== context.currentUrl
  ) {
    return {
      expected: expectation.description,
      observed: `URL changed from ${context.initialUrl} to ${context.currentUrl}`,
      result: "pass",
    };
  }

  return {
    expected: expectation.description,
    observed: "Could not detect a meaningful result-state change",
    result: "error",
  };
}

export function checkEmptyStateVisible(
  expectation: {
    description: string;
    expectedTextTokens?: string[];
  },
  context: ExpertiseContext
): Outcome {
  const text = stripHtml(context.html).toLowerCase();
  const tokens = expectation.expectedTextTokens?.length
    ? expectation.expectedTextTokens.map(token => token.toLowerCase())
    : [
        "no results",
        "0 results",
        "no matches",
        "nothing found",
        "did not match",
        "try a different search",
        "search returned no",
        "no products found",
        "no items found",
      ];

  const matched = tokens.find(token => text.includes(token));
  if (matched) {
    return {
      expected: expectation.description,
      observed: `Visible empty-state text detected: ${matched}`,
      result: "pass",
    };
  }

  return {
    expected: expectation.description,
    observed: "No visible empty-state text was detected after the search",
    result: "error",
  };
}

function extractRelevantSummary(html: string, tokens: string[]): string | null {
  const text = stripHtml(html);
  const lower = text.toLowerCase();
  for (const token of tokens) {
    const index = lower.indexOf(token.toLowerCase());
    if (index < 0) continue;
    return text.slice(
      Math.max(0, index - 40),
      Math.min(text.length, index + 120)
    );
  }

  return null;
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function extractCollectionSignature(html: string): string | null {
  const normalized = html.replace(/\s+/g, " ");
  const matches = Array.from(
    normalized.matchAll(
      /<(?:h[1-6]|a|button|li|option)\b[^>]*>(.*?)<\/(?:h[1-6]|a|button|li|option)>/gi
    )
  )
    .map(match =>
      match[1]
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
    )
    .filter(text => text.length >= 3 && text.length <= 80);

  const unique = Array.from(new Set(matches));
  if (unique.length < 3) return null;
  return unique.slice(0, 8).join(" | ").toLowerCase();
}
