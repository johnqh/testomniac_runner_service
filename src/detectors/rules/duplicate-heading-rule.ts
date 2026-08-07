import type {
  DetectionRule,
  DetectionContext,
  DetectedIssue,
} from "../detection-rule.js";

export const duplicateHeadingRule: DetectionRule = {
  name: "duplicate_heading",
  severity: "warning",

  async detect(context: DetectionContext): Promise<DetectedIssue[]> {
    const issues: DetectedIssue[] = [];
    const { html, currentActionChain } = context;

    const headingRegex = /<(h[1-6])[^>]*>([\s\S]*?)<\/\1>/gi;
    const headingTexts = new Map<string, number>();
    let match: RegExpExecArray | null;
    while ((match = headingRegex.exec(html)) !== null) {
      const text = match[2]
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
          severity: "warning",
          ruleName: "duplicate_heading",
          title: `Duplicate heading "${text.slice(0, 60)}"`,
          expectedOutcome: "Each heading should be unique on the page",
          observedOutcome: `Heading "${text.slice(0, 60)}" appears ${count} times`,
          actionChain: currentActionChain.map(a => a.id),
        });
      }
    }

    return issues;
  },
};
