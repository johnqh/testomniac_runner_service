import type {
  DetectionRule,
  DetectionContext,
  DetectedIssue,
} from "../detection-rule.js";

export const blankPageRule: DetectionRule = {
  name: "blank_page",
  severity: "bug",

  async detect(context: DetectionContext): Promise<DetectedIssue[]> {
    const { visibleText, currentActionChain } = context;

    if (visibleText.trim().length < 50) {
      return [
        {
          severity: "bug",
          ruleName: "blank_page",
          title: "Page appears blank or nearly empty",
          expectedOutcome: "Page should have meaningful content",
          observedOutcome: `Page appears blank or nearly empty (${visibleText.trim().length} characters)`,
          actionChain: currentActionChain.map(a => a.id),
        },
      ];
    }

    return [];
  },
};
