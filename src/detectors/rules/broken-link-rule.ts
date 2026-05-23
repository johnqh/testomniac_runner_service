function logModule(step: string, details?: Record<string, unknown>): void {
  console.info("[BrokenLinkRule]", step, details ?? {});
}

import type {
  DetectionRule,
  DetectionContext,
  DetectedIssue,
} from "../detection-rule";

export const brokenLinkRule: DetectionRule = {
  name: "broken_link",
  severity: "bug",

  async detect(context: DetectionContext): Promise<DetectedIssue[]> {
    const { adapter, pageUrl, currentActionChain } = context;
    const issues: DetectedIssue[] = [];
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
          console.info("[BrokenLinkRule]", "Invalid URL, skip", { href });
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

    for (const [href, text] of uniqueLinks) {
      try {
        const resp = await fetch(href, { method: "HEAD", redirect: "manual" });
        if (resp.status === 404 || resp.status === 410 || resp.status >= 500) {
          issues.push({
            severity: "bug",
            ruleName: "broken_link",
            title: `Broken link: ${href}`,
            expectedOutcome: "Link should resolve to a valid page",
            observedOutcome: `Broken link: ${href} (HTTP ${resp.status}) — "${text}"`,
            actionChain: currentActionChain.map(a => a.id),
          });
        }
      } catch {
        logModule("Unreachable URL", { href });
      }
    }

    return issues;
  },
};
