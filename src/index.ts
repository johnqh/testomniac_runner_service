// Browser abstraction
export type { BrowserAdapter } from "./adapter";

// Scanner modules (existing)
export * from "./scanner/issue-detector";
export * from "./scanner/action-queue";
export * from "./scanner/pairwise";
export * from "./scanner/loop-guard";
export * from "./scanner/phase-timer";
export * from "./scanner/email-detector";
export * from "./scanner/component-detector";
export * from "./scanner/state-manager";
export * from "./scanner/scroll-scanner";

// Scanner modules (new)
export {
  normalizeHref,
  shouldExpectNavigation,
  looksLikeSubmitAction,
  looksLikeEnterCommitField,
  getActionPriority,
} from "./scanner/action-classifier";
export { Navigator } from "./scanner/navigator";
export { ReusableElementCache } from "./scanner/reusable-element-cache";
export { decomposeHtml, type DecomposedHtml } from "./scanner/html-decomposer";
export {
  detectReusableRegions,
  COMPONENT_TYPE_SELECTORS,
  type DetectedReusableRegion,
} from "./scanner/component-detector";

// Page utilities
export {
  sha256,
  normalizeHtml,
  extractVisibleText,
  computeHashes,
} from "./browser/page-utils";
export { buildDomSnapshot } from "./browser/dom-snapshot";

// Detectors (existing + new)
export * from "./detectors";

// Domain types
export * from "./domain/types";
export * from "./domain/url-ownership";

// Constants
export * from "./config/constants";

// API client
export { ApiClient, getApiClient } from "./api/client";

// Extractors (new)
export {
  extractActionableItems,
  getRegisteredExtractorNames,
} from "./extractors";
export { extractForms } from "./extractors/form-extractor";
export type {
  ItemExtractor,
  DomSnapshotEntry,
  ExtractorCandidate,
  SelectorResolvedCandidate,
  ActionKind,
} from "./extractors/types";

// Planners (new)
export {
  fillValuePlanner,
  RuleBasedFillValuePlanner,
  type FillValuePlanner,
} from "./planners/fill-value-planner";

// AI (new)
export { runAiAnalysis, type AnalyzerOptions } from "./ai/analyzer";
export { generatePersonas, type PersonaResult } from "./ai/persona-generator";
export { generateUseCases, type UseCaseResult } from "./ai/use-case-generator";
export {
  generateInputValues,
  type InputValueResult,
} from "./ai/input-generator";
export { trackOpenAiCall } from "./ai/token-tracker";

// Generation (new)
export {
  generateTestCases,
  type GeneratorOptions,
} from "./generation/generator";
export { assignPriority, assignSuiteTags } from "./generation/suite-tagger";
export { generateRenderTest } from "./generation/render";
export { generateInteractionTest } from "./generation/interaction";
export { generateFormTest } from "./generation/form";
export { generateFormNegativeTests } from "./generation/form-negative";
export {
  generatePasswordTests,
  type PasswordTestCase,
} from "./generation/password";
export { generateNavigationTest } from "./generation/navigation";
export { generateE2ETest, enumerateE2EPaths } from "./generation/e2e";

// Orchestrator (new)
export { runScan } from "./orchestrator/orchestrator";
export { runMouseScanning } from "./orchestrator/mouse-scanning";
export { runAiAnalysisPhase } from "./orchestrator/ai-analysis";
export { runInputScanningPhase } from "./orchestrator/input-scanning";
export { runTestGenerationPhase } from "./orchestrator/test-generation";
export { runTestExecutionPhase } from "./orchestrator/test-execution";
export type {
  ScanConfig,
  ScanEventHandler,
  ScanResult,
  ScanPhase,
  TestExecutor,
} from "./orchestrator/types";

// Plugins (new)
export type {
  Plugin,
  PluginContext,
  PluginResult,
  PluginIssue,
} from "./plugins/types";
export {
  registerPlugin,
  getPlugin,
  getEnabledPlugins,
  getAllPluginNames,
} from "./plugins/registry";
