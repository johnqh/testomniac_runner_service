import type {
  ActionableItem,
  PageHashes,
  DecomposedPageHashes,
} from "../domain/types";
import type { DetectedScaffoldRegion } from "../scanner/component-detector";
import type { DetectedPatternWithInstances } from "../scanner/pattern-detector";
import { createHash } from "node:crypto";

export async function sha256(input: string): Promise<string> {
  // Use Node.js crypto when available, fall back to Web SubtleCrypto
  if (
    typeof globalThis.process !== "undefined" &&
    typeof globalThis.process.versions?.node === "string"
  ) {
    return createHash("sha256").update(input).digest("hex");
  }
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

export function normalizeHtml(html: string): string {
  return html
    .replace(/\s+/g, " ")
    .replace(/\s*=\s*/g, "=")
    .replace(/<(\w+)\s+([^>]*)>/g, (_, tag, attrs) => {
      const sorted = attrs.trim().split(/\s+/).sort().join(" ");
      return `<${tag} ${sorted}>`;
    })
    .replace(/>\s+/g, ">")
    .replace(/\s+</g, "<")
    .trim();
}

export function extractVisibleText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Convert HTML to a lightweight markdown representation.
 *
 * The output preserves semantic structure (headings, links, lists, emphasis)
 * while stripping all attributes, classes, inline styles, and transient state
 * like hover/focus CSS classes.  This makes the text far more stable across
 * interactions on the same page and is used both as the `contentText` stored
 * on page states and as the basis of the `textHash` used for deduplication.
 */
export function htmlToMarkdown(html: string): string {
  let md = html;

  // 1. Remove non-visible blocks entirely
  md = md.replace(/<script[\s\S]*?<\/script>/gi, "");
  md = md.replace(/<style[\s\S]*?<\/style>/gi, "");
  md = md.replace(/<noscript[\s\S]*?<\/noscript>/gi, "");
  md = md.replace(/<svg[\s\S]*?<\/svg>/gi, "");
  md = md.replace(/<!--[\s\S]*?-->/g, "");

  // 2. Block-level line breaks (before stripping tags)
  md = md.replace(/<br\s*\/?>/gi, "\n");
  md = md.replace(/<\/p>/gi, "\n\n");
  md = md.replace(/<\/div>/gi, "\n");
  md = md.replace(/<\/li>/gi, "\n");
  md = md.replace(/<\/tr>/gi, "\n");
  md = md.replace(/<\/blockquote>/gi, "\n");
  md = md.replace(/<hr\s*\/?>/gi, "\n---\n");

  // 3. Headings → markdown #
  md = md.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, level, text) => {
    const prefix = "#".repeat(Number(level));
    const clean = text.replace(/<[^>]+>/g, "").trim();
    return `\n${prefix} ${clean}\n`;
  });

  // 4. Links → [text](href)
  md = md.replace(
    /<a\s[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
    (_, href, text) => {
      const clean = text.replace(/<[^>]+>/g, "").trim();
      return `[${clean}](${href})`;
    }
  );

  // 5. Images → ![alt](src)
  md = md.replace(
    /<img\s[^>]*src=["']([^"']+)["'][^>]*\/?>/gi,
    (match, src) => {
      const altMatch = match.match(/alt=["']([^"']*?)["']/i);
      const alt = altMatch?.[1] ?? "";
      return `![${alt}](${src})`;
    }
  );

  // 6. Emphasis
  md = md.replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, (_, _tag, text) => {
    const clean = text.replace(/<[^>]+>/g, "").trim();
    return `**${clean}**`;
  });
  md = md.replace(/<(em|i)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi, (_, _tag, text) => {
    const clean = text.replace(/<[^>]+>/g, "").trim();
    return `*${clean}*`;
  });

  // 7. List items → "- "
  md = md.replace(/<li[^>]*>/gi, "- ");

  // 8. Strip all remaining HTML tags
  md = md.replace(/<[^>]+>/g, " ");

  // 9. Decode common HTML entities
  md = md
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");

  // 10. Normalize whitespace — collapse runs within lines, preserve paragraph breaks
  md = md
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return md;
}

/**
 * Compute a hash of visible actionable-item stable keys.  Used both inside
 * `computeHashes` and by the PageAnalyzer to deduplicate test generation
 * across pages that share the same set of interactive elements.
 */
export async function computeActionableHash(
  actionableItems: Pick<ActionableItem, "visible" | "stableKey">[]
): Promise<string> {
  const visibleKeys = actionableItems
    .filter(i => i.visible)
    .map(i => i.stableKey)
    .sort()
    .join("|");
  return sha256(visibleKeys);
}

export async function computeHashes(
  html: string,
  actionableItems: ActionableItem[]
): Promise<PageHashes> {
  const normalized = normalizeHtml(html);
  const markdown = htmlToMarkdown(html);

  return {
    htmlHash: await sha256(html),
    normalizedHtmlHash: await sha256(normalized),
    textHash: await sha256(markdown),
    actionableHash: await computeActionableHash(actionableItems),
  };
}

export async function computeDecomposedHashes(
  fixedBody: string,
  scaffolds: DetectedScaffoldRegion[],
  patternSummaries: DetectedPatternWithInstances[]
): Promise<DecomposedPageHashes> {
  const fixedBodyHash = await sha256(normalizeHtml(fixedBody));

  const scaffoldsKey =
    scaffolds
      .map(r => `${r.type}:${r.hash}`)
      .sort()
      .join("|") || "none";
  const scaffoldsHash = await sha256(scaffoldsKey);

  const patternKey =
    patternSummaries
      .map(p => `${p.type}:${p.count}`)
      .sort()
      .join("|") || "none";
  const patternsHash = await sha256(patternKey);

  return { fixedBodyHash, scaffoldsHash, patternsHash };
}
