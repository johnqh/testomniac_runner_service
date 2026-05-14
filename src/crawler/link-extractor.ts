import type { BrowserAdapter } from "../adapter";
import {
  isSameOrigin,
  normalizeNavigableUrl,
  toRelativePath,
} from "./url-normalizer";

export interface ExtractedLink {
  url: string;
  relativePath: string;
  label?: string;
}

export async function extractSameOriginLinks(
  adapter: BrowserAdapter,
  baseUrl: string,
  scanScopePath?: string
): Promise<ExtractedLink[]> {
  const rawLinks = await adapter.evaluate(() => {
    return Array.from(document.querySelectorAll("a[href]"))
      .map(anchor => {
        const href = anchor.getAttribute("href");
        if (!href) return null;
        const label = anchor.textContent
          ?.trim()
          .replace(/\s+/g, " ")
          .slice(0, 120);
        return {
          href,
          label: label || undefined,
        };
      })
      .filter(Boolean) as Array<{ href: string; label?: string }>;
  });

  const deduped = new Map<string, ExtractedLink>();
  for (const link of rawLinks) {
    const absoluteUrl = normalizeNavigableUrl(link.href, baseUrl);
    if (!absoluteUrl || !isSameOrigin(absoluteUrl, baseUrl)) {
      continue;
    }
    const relativePath = toRelativePath(absoluteUrl);
    if (scanScopePath && !relativePath.startsWith(scanScopePath)) {
      continue;
    }
    if (!deduped.has(relativePath)) {
      deduped.set(relativePath, {
        url: absoluteUrl,
        relativePath,
        label: link.label,
      });
    }
  }

  return Array.from(deduped.values());
}
