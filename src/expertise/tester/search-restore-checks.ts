import type { ExpertiseContext, Outcome } from "../types";

export function checkResultsRestored(
  expectation: {
    description: string;
    targetPath?: string;
  },
  context: ExpertiseContext
): Outcome {
  const initialSummary = extractResultsSummary(context.initialHtml);
  const finalSummary = extractResultsSummary(context.html);
  const initialSignature = extractCollectionSignature(context.initialHtml);
  const finalSignature = extractCollectionSignature(context.html);

  const summaryMatches =
    initialSummary &&
    finalSummary &&
    normalizeText(initialSummary) === normalizeText(finalSummary);
  const signatureMatches =
    initialSignature &&
    finalSignature &&
    normalizeText(initialSignature) === normalizeText(finalSignature);
  const urlRestored =
    context.initialUrl &&
    context.currentUrl &&
    context.initialUrl === context.currentUrl;

  if (summaryMatches || signatureMatches || urlRestored) {
    return {
      expected: expectation.description,
      observed: "Search/list state returned to its baseline after clear/reset",
      result: "pass",
    };
  }

  return {
    expected: expectation.description,
    observed:
      "Result state did not return close to the initial baseline after clear/reset",
    result: "warning",
  };
}

function extractResultsSummary(html: string): string | null {
  const text = stripHtml(html);
  const lower = text.toLowerCase();
  const tokens = [
    "results",
    "products",
    "items",
    "matches",
    "showing",
    "search",
  ];

  for (const token of tokens) {
    const index = lower.indexOf(token);
    if (index < 0) continue;
    return text.slice(
      Math.max(0, index - 40),
      Math.min(text.length, index + 120)
    );
  }

  return null;
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
