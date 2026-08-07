import type {
  DetectionRule,
  DetectionContext,
  DetectedIssue,
} from "../detection-rule.js";

export const brokenImageRule: DetectionRule = {
  name: "broken_image",
  severity: "bug",

  async detect(context: DetectionContext): Promise<DetectedIssue[]> {
    const { html, currentActionChain } = context;

    const imgRegex = /<img\s([^>]*)>/gi;
    let match: RegExpExecArray | null;
    let brokenImgCount = 0;
    while ((match = imgRegex.exec(html)) !== null) {
      const attrs = match[1];
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
      return [
        {
          severity: "bug",
          ruleName: "broken_image",
          title: `${brokenImgCount} image(s) with empty or invalid src`,
          expectedOutcome: "All images should have valid source URLs",
          observedOutcome: `${brokenImgCount} image(s) with empty or invalid src`,
          actionChain: currentActionChain.map(a => a.id),
        },
      ];
    }

    return [];
  },
};
