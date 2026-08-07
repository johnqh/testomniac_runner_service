export {
  extractLinks,
  checkLinks,
  type LinkCheckResult,
} from "./link-checker.js";
export { checkVisualIssues, type VisualIssue } from "./visual-checker.js";
export { checkContentIssues, type ContentIssue } from "./content-checker.js";
export {
  analyzeConsoleErrors,
  analyzeNetworkErrors,
  checkPostClickState,
  type FunctionalIssue,
} from "./functional-checker.js";
export {
  detectBrokenLinks,
  detectVisualIssues,
  detectContentIssues,
  detectMediaIssues,
  type BrokenLinkResult,
  type MediaIssue,
} from "./bug-detector.js";
export { detectAndHandleModal, dismissModal } from "./modal-handler.js";

// Detection rules system
export type {
  DetectionContext,
  DetectedIssue,
  DetectionRule,
} from "./detection-rule.js";
export {
  describeAction,
  buildTestInteractionDescription,
} from "./action-description.js";
export { getAllDetectionRules } from "./rules/index.js";
