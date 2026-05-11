import type { ExpertiseContext, Outcome } from "../types";

export function checkRowCountChanged(
  expectation: {
    description: string;
    expectedCountDelta?: number;
  },
  context: ExpertiseContext
): Outcome {
  const initialCount = countListRows(context.initialHtml);
  const finalCount = countListRows(context.html);

  if (initialCount == null || finalCount == null) {
    return {
      expected: expectation.description,
      observed: "Could not extract a reliable list/table row count",
      result: "warning",
    };
  }

  const delta = finalCount - initialCount;
  if (
    expectation.expectedCountDelta != null &&
    delta !== expectation.expectedCountDelta
  ) {
    return {
      expected: expectation.description,
      observed: `Expected row delta ${expectation.expectedCountDelta}, observed ${delta}`,
      result: "error",
    };
  }

  if (delta === 0) {
    return {
      expected: expectation.description,
      observed: `Row count did not change (${initialCount} -> ${finalCount})`,
      result: "error",
    };
  }

  return {
    expected: expectation.description,
    observed: `Row count changed from ${initialCount} to ${finalCount}`,
    result: "pass",
  };
}

function countListRows(html: string): number | null {
  const tableRows = (html.match(/<tr\b/gi) ?? []).length;
  if (tableRows > 0) return tableRows;

  const listItems = (html.match(/<li\b/gi) ?? []).length;
  if (listItems > 0) return listItems;

  const cards = (
    html.match(
      /<(?:article|section|div)\b[^>]*(?:product|card|result|item)[^>]*>/gi
    ) ?? []
  ).length;
  if (cards > 0) return cards;

  return null;
}
