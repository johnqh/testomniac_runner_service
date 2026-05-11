import type { ExpertiseContext, Outcome } from "../types";

export function checkVariantStateChanged(
  expectation: {
    description: string;
    targetPath?: string;
    expectedValue?: string;
  },
  context: ExpertiseContext
): Outcome {
  const reasons: string[] = [];

  if (
    context.initialUrl &&
    context.currentUrl &&
    context.initialUrl !== context.currentUrl
  ) {
    reasons.push("URL changed");
  }

  const priceBefore = extractPriceSignal(context.initialHtml);
  const priceAfter = extractPriceSignal(context.html);
  if (priceBefore && priceAfter && priceBefore !== priceAfter) {
    reasons.push(`price changed from ${priceBefore} to ${priceAfter}`);
  }

  const imageBefore = extractImageSignature(context.initialHtml);
  const imageAfter = extractImageSignature(context.html);
  if (imageBefore && imageAfter && imageBefore !== imageAfter) {
    reasons.push("image selection changed");
  }

  const stockBefore = extractAvailabilitySignal(context.initialHtml);
  const stockAfter = extractAvailabilitySignal(context.html);
  if (stockBefore && stockAfter && stockBefore !== stockAfter) {
    reasons.push(`availability changed from ${stockBefore} to ${stockAfter}`);
  }

  if (reasons.length > 0) {
    return {
      expected: expectation.description,
      observed: `Variant selection changed product state: ${reasons.join("; ")}`,
      result: "pass",
    };
  }

  return {
    expected: expectation.description,
    observed:
      "Variant selection changed the control value but no product-state signal changed (price, image, availability, or URL)",
    result: "warning",
  };
}

function extractPriceSignal(html: string): string | null {
  const text = stripHtml(html);
  const match = text.match(
    /(?:[$€£]\s?\d[\d,.]*|\d[\d,.]*\s?(?:usd|eur|gbp|cad|aud))/i
  );
  return match?.[0]?.trim() ?? null;
}

function extractImageSignature(html: string): string | null {
  const matches = Array.from(
    html.matchAll(/<img\b[^>]*src=["']([^"']+)["'][^>]*>/gi)
  )
    .map(match => match[1].trim())
    .filter(Boolean);
  if (matches.length === 0) return null;
  return matches.slice(0, 3).join("|");
}

function extractAvailabilitySignal(html: string): string | null {
  const text = stripHtml(html).toLowerCase();
  const signals = [
    "in stock",
    "out of stock",
    "sold out",
    "unavailable",
    "available",
    "only",
    "backorder",
    "preorder",
  ];

  return signals.find(signal => text.includes(signal)) ?? null;
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
