import type { ExpertiseContext, Outcome } from "../types";

export function checkCountChanged(
  expectation: {
    description: string;
    expectedCountDelta?: number;
    expectedTextTokens?: string[];
  },
  context: ExpertiseContext
): Outcome {
  const tokens = expectation.expectedTextTokens?.length
    ? expectation.expectedTextTokens
    : ["cart", "bag", "basket", "item", "items", "qty", "quantity"];
  const initialCount = extractRelevantNumber(context.initialHtml, tokens);
  const finalCount = extractRelevantNumber(context.html, tokens);
  const fallbackControlDelta = extractQuantityControlDelta(context);

  if (initialCount == null || finalCount == null) {
    if (fallbackControlDelta != null) {
      if (
        expectation.expectedCountDelta != null &&
        fallbackControlDelta !== expectation.expectedCountDelta
      ) {
        return {
          expected: expectation.description,
          observed: `Expected count delta ${expectation.expectedCountDelta}, observed quantity-control delta ${fallbackControlDelta}`,
          result: "error",
        };
      }

      if (fallbackControlDelta === 0) {
        return {
          expected: expectation.description,
          observed: "Quantity-like control value did not change",
          result: "error",
        };
      }

      return {
        expected: expectation.description,
        observed: `Quantity-like control changed by ${fallbackControlDelta}`,
        result: "pass",
      };
    }

    return {
      expected: expectation.description,
      observed: "Could not extract comparable count values from page text",
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
      observed: `Expected count delta ${expectation.expectedCountDelta}, observed ${delta}`,
      result: "error",
    };
  }

  if (delta === 0) {
    return {
      expected: expectation.description,
      observed: `Count value did not change (${initialCount} -> ${finalCount})`,
      result: "error",
    };
  }

  return {
    expected: expectation.description,
    observed: `Count changed from ${initialCount} to ${finalCount}`,
    result: "pass",
  };
}

export function checkCartSummaryChanged(
  expectation: {
    description: string;
    expectedTextTokens?: string[];
  },
  context: ExpertiseContext
): Outcome {
  const tokens = expectation.expectedTextTokens?.length
    ? expectation.expectedTextTokens
    : ["subtotal", "total", "cart", "bag", "basket", "checkout"];
  const initialSummary = extractRelevantSummary(context.initialHtml, tokens);
  const finalSummary = extractRelevantSummary(context.html, tokens);

  if (!initialSummary || !finalSummary) {
    const priceDiff = extractSummaryPriceChange(
      context.initialHtml,
      context.html
    );
    if (priceDiff) {
      return {
        expected: expectation.description,
        observed: priceDiff,
        result: "pass",
      };
    }

    return {
      expected: expectation.description,
      observed: "Could not find a cart-like summary region in page text",
      result: "warning",
    };
  }

  if (normalizeText(initialSummary) === normalizeText(finalSummary)) {
    const priceDiff = extractSummaryPriceChange(
      context.initialHtml,
      context.html
    );
    if (priceDiff) {
      return {
        expected: expectation.description,
        observed: priceDiff,
        result: "pass",
      };
    }

    return {
      expected: expectation.description,
      observed: "Cart-like summary text did not change after the action",
      result: "error",
    };
  }

  return {
    expected: expectation.description,
    observed: "Cart-like summary text changed after the action",
    result: "pass",
  };
}

export function checkCollectionOrderChanged(
  expectation: { description: string },
  context: ExpertiseContext
): Outcome {
  const initialSignature = extractCollectionSignature(context.initialHtml);
  const finalSignature = extractCollectionSignature(context.html);

  if (!initialSignature || !finalSignature) {
    return {
      expected: expectation.description,
      observed:
        "Could not extract collection ordering signals from page content",
      result: "warning",
    };
  }

  if (initialSignature === finalSignature) {
    return {
      expected: expectation.description,
      observed: "Collection ordering signal did not change after the action",
      result: "error",
    };
  }

  return {
    expected: expectation.description,
    observed: "Collection ordering signal changed after the action",
    result: "pass",
  };
}

function extractRelevantNumber(html: string, tokens: string[]): number | null {
  const text = stripHtml(html).toLowerCase();
  for (const token of tokens) {
    const match = text.match(
      new RegExp(`(?:${escapeRegex(token)})\\D{0,12}(\\d{1,4})`, "i")
    );
    if (match) return Number.parseInt(match[1], 10);
  }

  return null;
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

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

function extractQuantityControlDelta(context: ExpertiseContext): number | null {
  const initial = findQuantityControlValue(context.initialControlStates);
  const final = findQuantityControlValue(context.finalControlStates);
  if (initial == null || final == null) return null;
  return final - initial;
}

function findQuantityControlValue(
  states: ExpertiseContext["initialControlStates"]
): number | null {
  const candidate = states.find(state => {
    const text = [
      state.label ?? "",
      state.name ?? "",
      state.selector,
      state.role ?? "",
      state.inputType ?? "",
    ]
      .join(" ")
      .toLowerCase();
    return /\b(qty|quantity|items?)\b/.test(text) && /^\d+$/.test(state.value);
  });

  if (!candidate) return null;
  return Number.parseInt(candidate.value, 10);
}

function extractSummaryPriceChange(
  initialHtml: string,
  html: string
): string | null {
  const initialPrices = extractPriceSignals(initialHtml);
  const finalPrices = extractPriceSignals(html);
  if (initialPrices.length === 0 || finalPrices.length === 0) return null;

  const initialJoined = initialPrices.slice(0, 4).join(" | ");
  const finalJoined = finalPrices.slice(0, 4).join(" | ");
  if (initialJoined === finalJoined) return null;

  return `Cart-like price signals changed from [${initialJoined}] to [${finalJoined}]`;
}

function extractPriceSignals(html: string): string[] {
  return Array.from(
    stripHtml(html).matchAll(
      /(?:[$€£]\s?\d[\d,.]*|\d[\d,.]*\s?(?:usd|eur|gbp|cad|aud))/gi
    )
  )
    .map(match => match[0].trim().toLowerCase())
    .filter(Boolean);
}
