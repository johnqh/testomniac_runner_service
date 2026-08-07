import type {
  DetectionRule,
  DetectionContext,
  DetectedIssue,
} from "../detection-rule.js";

export const emptyLinkRule: DetectionRule = {
  name: "empty_link",
  severity: "warning",

  async detect(context: DetectionContext): Promise<DetectedIssue[]> {
    const { html, currentActionChain } = context;

    const linkRegex = /<a\s[^>]*>([\s\S]*?)<\/a>/gi;
    let match: RegExpExecArray | null;
    let emptyLinkCount = 0;
    while ((match = linkRegex.exec(html)) !== null) {
      const innerText = match[1]
        .replace(/<[^>]+>/g, "")
        .replace(/\s+/g, "")
        .trim();
      const hasImg = /<img\s[^>]*alt\s*=\s*"[^"]+"/i.test(match[1]);
      const hasAriaLabel = /aria-label\s*=\s*"[^"]+"/i.test(match[0]);
      if (!innerText && !hasImg && !hasAriaLabel) {
        emptyLinkCount++;
      }
    }

    if (emptyLinkCount > 0) {
      return [
        {
          severity: "warning",
          ruleName: "empty_link",
          title: `${emptyLinkCount} link(s) with no accessible text`,
          expectedOutcome: "All links should have accessible text content",
          observedOutcome: `${emptyLinkCount} link(s) with no accessible text content`,
          actionChain: currentActionChain.map(a => a.id),
        },
      ];
    }

    return [];
  },
};
