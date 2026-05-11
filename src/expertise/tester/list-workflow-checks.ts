import type { ExpertiseContext, Outcome } from "../types";

export function checkRowCountChanged(
  expectation: {
    description: string;
    expectedCountDelta?: number;
  },
  context: ExpertiseContext
): Outcome {
  const initialCount = countListRows(context.initialHtml);
  const finalCount = countListRows(context.html, initialCount);

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

function countListRows(
  html: string,
  priorKnownCount?: number | null
): number | null {
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

  if (
    (priorKnownCount ?? 0) > 0 &&
    (hasCollectionContainer(html) || hasEmptyStateLikeText(html))
  ) {
    return 0;
  }

  return null;
}

function hasCollectionContainer(html: string): boolean {
  return /<(?:table|ul|ol)\b|role=["'](?:list|grid|table)["']/i.test(html);
}

function hasEmptyStateLikeText(html: string): boolean {
  return /\b(no results|0 results|no matches|nothing found|no items|no products|empty|no records)\b/i.test(
    html
  );
}
