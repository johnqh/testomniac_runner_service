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

export async function computeHashes(
  html: string,
  actionableItems: ActionableItem[]
): Promise<PageHashes> {
  const normalized = normalizeHtml(html);
  const visibleText = extractVisibleText(html);
  const visibleKeys = actionableItems
    .filter(i => i.visible)
    .map(i => i.stableKey)
    .sort()
    .join("|");

  return {
    htmlHash: await sha256(html),
    normalizedHtmlHash: await sha256(normalized),
    textHash: await sha256(visibleText),
    actionableHash: await sha256(visibleKeys),
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
