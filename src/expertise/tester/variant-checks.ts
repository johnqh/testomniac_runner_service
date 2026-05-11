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

  const ctaBefore = extractPurchaseCtaSignal(context.initialHtml);
  const ctaAfter = extractPurchaseCtaSignal(context.html);
  if (ctaBefore && ctaAfter) {
    if (ctaBefore.disabled !== ctaAfter.disabled) {
      reasons.push(
        `purchase control changed from ${ctaBefore.disabled ? "disabled" : "enabled"} to ${ctaAfter.disabled ? "disabled" : "enabled"}`
      );
    }

    if (ctaBefore.text && ctaAfter.text && ctaBefore.text !== ctaAfter.text) {
      reasons.push(
        `purchase control label changed from "${ctaBefore.text}" to "${ctaAfter.text}"`
      );
    }
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

function extractPurchaseCtaSignal(
  html: string
): { text: string; disabled: boolean } | null {
  const normalized = html.replace(/\s+/g, " ");
  const buttonMatch = normalized.match(/<(button|a)\b([^>]*)>(.*?)<\/\1>/i);
  const inputMatch = normalized.match(
    /<input\b([^>]*)type=["'](?:submit|button)["']([^>]*)>/i
  );

  const candidate = [buttonMatch, inputMatch]
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .map(match => {
      const attrs = match[2] ?? match[1] ?? "";
      const text =
        match[3] ?? attrs.match(/\bvalue=["']([^"']+)["']/i)?.[1] ?? "";
      return {
        attrs,
        text: text
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .toLowerCase(),
      };
    })
    .find(match =>
      /\b(add to cart|add to bag|buy now|checkout|place order|select options|choose option|choose size|choose color)\b/.test(
        match.text
      )
    );

  if (!candidate) return null;

  return {
    text: candidate.text,
    disabled: /\bdisabled\b|aria-disabled=["']true["']/i.test(candidate.attrs),
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
