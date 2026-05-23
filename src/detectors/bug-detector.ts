function logModule(step: string, details?: Record<string, unknown>): void {
  console.info("[BugDetector]", step, details ?? {});
}

import type { BrowserAdapter } from "../adapter";

export interface BrokenLinkResult {
  href: string;
  text: string;
  error: string;
}

export interface VisualIssue {
  type: string;
  description: string;
}

export interface ContentIssue {
  type: string;
  description: string;
}

export interface MediaIssue {
  type: string;
  description: string;
}

export async function detectBrokenLinks(
  adapter: BrowserAdapter,
  pageUrl: string
): Promise<BrokenLinkResult[]> {
  const origin = new URL(pageUrl).origin;

  const links = (await adapter.evaluate((...args: unknown[]) => {
    const orig = args[0] as string;
    const anchors = document.querySelectorAll("a[href]");
    const results: Array<{ href: string; text: string }> = [];
    anchors.forEach(a => {
      const href = (a as HTMLAnchorElement).href;
      const text = a.textContent?.trim().slice(0, 80) || "";
      try {
        if (new URL(href).origin === orig) {
          results.push({ href, text });
        }
      } catch {
        console.info("[BugDetector]", "Invalid URL, skip", { href });
      }
    });
    return results;
  }, origin)) as Array<{ href: string; text: string }>;

  if (!links || links.length === 0) return [];

  const uniqueLinks = new Map<string, string>();
  for (const link of links) {
    if (!uniqueLinks.has(link.href)) {
      uniqueLinks.set(link.href, link.text);
    }
  }

  const broken: BrokenLinkResult[] = [];
  for (const [href, text] of uniqueLinks) {
    try {
      const resp = await fetch(href, { method: "HEAD", redirect: "manual" });
      if (resp.status === 404 || resp.status === 410 || resp.status >= 500) {
        broken.push({ href, text, error: `HTTP ${resp.status}` });
      }
    } catch {
      logModule("Unreachable URL", { href });
    }
  }

  return broken;
}

export function detectVisualIssues(html: string): VisualIssue[] {
  const issues: VisualIssue[] = [];

  const headingRegex = /<(h[1-6])[^>]*>([\s\S]*?)<\/\1>/gi;
  const headingTexts = new Map<string, number>();
  let headingMatch: RegExpExecArray | null;
  while ((headingMatch = headingRegex.exec(html)) !== null) {
    const text = headingMatch[2]
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
    if (text) {
      headingTexts.set(text, (headingTexts.get(text) || 0) + 1);
    }
  }
  for (const [text, count] of headingTexts) {
    if (count > 1) {
      issues.push({
        type: "duplicate_heading",
        description: `Heading "${text.slice(0, 60)}" appears ${count} times`,
      });
    }
  }

  const linkRegex = /<a\s[^>]*>([\s\S]*?)<\/a>/gi;
  let linkMatch: RegExpExecArray | null;
  let emptyLinkCount = 0;
  while ((linkMatch = linkRegex.exec(html)) !== null) {
    const innerText = linkMatch[1]
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, "")
      .trim();
    const hasImg = /<img\s[^>]*alt\s*=\s*"[^"]+"/i.test(linkMatch[1]);
    const hasAriaLabel = /aria-label\s*=\s*"[^"]+"/i.test(linkMatch[0]);
    if (!innerText && !hasImg && !hasAriaLabel) {
      emptyLinkCount++;
    }
  }
  if (emptyLinkCount > 0) {
    issues.push({
      type: "empty_link",
      description: `${emptyLinkCount} link(s) with no accessible text content`,
    });
  }

  const imgRegex = /<img\s([^>]*)>/gi;
  let imgMatch: RegExpExecArray | null;
  let brokenImgCount = 0;
  while ((imgMatch = imgRegex.exec(html)) !== null) {
    const attrs = imgMatch[1];
    const srcMatch = /src\s*=\s*"([^"]*)"/i.exec(attrs);
    if (
      !srcMatch ||
      !srcMatch[1] ||
      srcMatch[1].trim() === "" ||
      srcMatch[1] === "#"
    ) {
      brokenImgCount++;
    }
  }
  if (brokenImgCount > 0) {
    issues.push({
      type: "broken_image",
      description: `${brokenImgCount} image(s) with empty or invalid src`,
    });
  }

  const idRegex = /\sid\s*=\s*"([^"]+)"/gi;
  const idCounts = new Map<string, number>();
  let idMatch: RegExpExecArray | null;
  while ((idMatch = idRegex.exec(html)) !== null) {
    const id = idMatch[1];
    idCounts.set(id, (idCounts.get(id) || 0) + 1);
  }
  const duplicateIds: string[] = [];
  for (const [id, count] of idCounts) {
    if (count > 1) duplicateIds.push(id);
  }
  if (duplicateIds.length > 0) {
    issues.push({
      type: "duplicate_id",
      description: `${duplicateIds.length} duplicate element ID(s): ${duplicateIds.slice(0, 5).join(", ")}${duplicateIds.length > 5 ? "..." : ""}`,
    });
  }

  return issues;
}

export function detectContentIssues(text: string): ContentIssue[] {
  const issues: ContentIssue[] = [];

  const placeholderPatterns = [
    /lorem ipsum/i,
    /dolor sit amet/i,
    /placeholder text/i,
    /todo[:\s]/i,
    /fixme[:\s]/i,
    /your (?:name|email|text) here/i,
    /example\.com/i,
    /test@test/i,
    /foo\s*bar/i,
  ];
  for (const pattern of placeholderPatterns) {
    if (pattern.test(text)) {
      issues.push({
        type: "placeholder_text",
        description: `Placeholder text detected: matches "${pattern.source}"`,
      });
      break;
    }
  }

  const errorPatterns: Array<{ pattern: RegExp; label: string }> = [
    { pattern: /404\s*(not found|error|page)/i, label: "404 Not Found" },
    { pattern: /500\s*(internal|server|error)/i, label: "500 Server Error" },
    {
      pattern: /503\s*(service|unavailable)/i,
      label: "503 Service Unavailable",
    },
    { pattern: /502\s*(bad gateway)/i, label: "502 Bad Gateway" },
    { pattern: /page\s*not\s*found/i, label: "Page Not Found" },
    { pattern: /server\s*error/i, label: "Server Error" },
    { pattern: /internal\s*server\s*error/i, label: "Internal Server Error" },
    { pattern: /access\s*denied/i, label: "Access Denied" },
    { pattern: /403\s*forbidden/i, label: "403 Forbidden" },
    { pattern: /something\s*went\s*wrong/i, label: "Something Went Wrong" },
    { pattern: /an?\s*error\s*(has\s*)?occurred/i, label: "Error Occurred" },
    { pattern: /application\s*error/i, label: "Application Error" },
  ];
  for (const { pattern, label } of errorPatterns) {
    if (pattern.test(text)) {
      issues.push({
        type: "error_page",
        description: `Error page detected: ${label}`,
      });
      break;
    }
  }

  if (text.trim().length < 50) {
    issues.push({
      type: "blank_page",
      description: `Page appears blank or nearly empty (${text.trim().length} characters)`,
    });
  }

  return issues;
}

export async function detectMediaIssues(
  adapter: BrowserAdapter
): Promise<MediaIssue[]> {
  const issues = (await adapter.evaluate(() => {
    const results: Array<{ type: string; description: string }> = [];
    const media = document.querySelectorAll("video, audio");

    media.forEach((element, index) => {
      const mediaEl = element as HTMLMediaElement;
      const tag = element.tagName.toLowerCase();
      const hasSource =
        Boolean(mediaEl.getAttribute("src")) ||
        element.querySelector("source[src]") !== null;

      if (!hasSource) {
        results.push({
          type: "missing_media_source",
          description: `${tag} #${index + 1} has no source`,
        });
        return;
      }

      if (mediaEl.error) {
        results.push({
          type: "broken_media",
          description: `${tag} #${index + 1} has media error code ${mediaEl.error.code}`,
        });
      } else if (mediaEl.networkState === HTMLMediaElement.NETWORK_NO_SOURCE) {
        results.push({
          type: "broken_media",
          description: `${tag} #${index + 1} has no playable source`,
        });
      }
    });

    return results;
  })) as MediaIssue[];

  return issues;
}
