import type {
  DetectionRule,
  DetectionContext,
  DetectedIssue,
} from "../detection-rule.js";

export const consoleErrorRule: DetectionRule = {
  name: "console_error",
  severity: "bug",

  async detect(_context: DetectionContext): Promise<DetectedIssue[]> {
    // Needs console log capture — not yet implemented
    return [];
  },
};
