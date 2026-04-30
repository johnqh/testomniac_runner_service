export { extractLinks, checkLinks, type LinkCheckResult } from "./link-checker";
export { checkVisualIssues, type VisualIssue } from "./visual-checker";
export { checkContentIssues, type ContentIssue } from "./content-checker";
export {
  analyzeConsoleErrors,
  analyzeNetworkErrors,
  checkPostClickState,
  type FunctionalIssue,
} from "./functional-checker";
export {
  detectBrokenLinks,
  detectVisualIssues,
  detectContentIssues,
  detectMediaIssues,
  type BrokenLinkResult,
  type MediaIssue,
} from "./bug-detector";
export { detectAndHandleModal, dismissModal } from "./modal-handler";

// Detection rules system
export type {
  DetectionContext,
  DetectedIssue,
  DetectionRule,
} from "./detection-rule";
export { describeAction, buildTestCaseDescription } from "./action-description";
export { getAllDetectionRules } from "./rules";
