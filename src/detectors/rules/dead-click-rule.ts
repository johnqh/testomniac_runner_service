import type {
  DetectionRule,
  DetectionContext,
  DetectedIssue,
} from "../detection-rule.js";

export const deadClickRule: DetectionRule = {
  name: "dead_click",
  severity: "bug",

  async detect(_context: DetectionContext): Promise<DetectedIssue[]> {
    // Needs page state comparison — not yet implemented
    return [];
  },
};
