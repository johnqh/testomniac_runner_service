function logModule(step: string, details?: Record<string, unknown>): void {
  console.info("[LinkChecker]", step, details ?? {});
}

export interface LinkCheckResult {
  url: string;
  text: string;
  status: number | null;
  error: string | null;
  isBroken: boolean;
}

/**
 * Extract all links from HTML and check which are suspicious.
 * Detects: 404 links, typos in URLs, links to non-existent pages.
 */
export function extractLinks(
  html: string,
  baseUrl: string
): Array<{ href: string; text: string }> {
  const links: Array<{ href: string; text: string }> = [];
  const linkRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = linkRegex.exec(html)) !== null) {
    const href = match[1];
    const text = match[2]
      .replace(/<[^>]+>/g, "")
      .trim()
      .slice(0, 80);
    // Skip anchors, javascript, mailto
    if (
      href.startsWith("#") ||
      href.startsWith("javascript:") ||
      href.startsWith("mailto:")
    )
      continue;
    // Resolve relative URLs
    try {
      const resolved = new URL(href, baseUrl).href;
      links.push({ href: resolved, text });
    } catch {
      logModule("URL resolution failed", { href, baseUrl });
      links.push({ href, text });
    }
  }
  return links;
}

/**
 * Check a batch of URLs for broken links.
 * Returns only broken/suspicious ones.
 */
export async function checkLinks(
  links: Array<{ href: string; text: string }>,
  baseOrigin: string
): Promise<LinkCheckResult[]> {
  const results: LinkCheckResult[] = [];
  const checked = new Set<string>();

  for (const link of links) {
    if (checked.has(link.href)) continue;
    checked.add(link.href);

    // Only check same-origin links (don't hit external sites)
    try {
      const url = new URL(link.href);
      if (url.origin !== baseOrigin) continue;
    } catch {
      logModule("URL parsing failed", { href: link.href });
      results.push({
        url: link.href,
        text: link.text,
        status: null,
        error: "Invalid URL",
        isBroken: true,
      });
      continue;
    }

    try {
      const response = await fetch(link.href, {
        method: "HEAD",
        redirect: "follow",
      });
      if (response.status >= 400) {
        results.push({
          url: link.href,
          text: link.text,
          status: response.status,
          error: `HTTP ${response.status}`,
          isBroken: true,
        });
      }
    } catch (err) {
      logModule("URL fetch failed", {
        href: link.href,
        error: err instanceof Error ? err.message : "Fetch failed",
      });
      results.push({
        url: link.href,
        text: link.text,
        status: null,
        error: err instanceof Error ? err.message : "Fetch failed",
        isBroken: true,
      });
    }
  }
  return results;
}
