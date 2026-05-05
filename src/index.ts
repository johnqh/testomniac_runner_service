// Browser abstraction
export type { BrowserAdapter } from "./adapter";

// Scanner modules (existing)
export * from "./scanner/issue-detector";
// action-queue is deprecated, no longer exported
export * from "./scanner/pairwise";
export * from "./scanner/loop-guard";
export * from "./scanner/phase-timer";
export * from "./scanner/email-detector";
export * from "./scanner/component-detector";
export * from "./scanner/pattern-detector";
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
export { ScaffoldCache } from "./scanner/scaffold-cache";
export { PageCache } from "./scanner/page-cache";
export { decomposeHtml, type DecomposedHtml } from "./scanner/html-decomposer";
export {
  detectScaffoldRegions,
  COMPONENT_TYPE_SELECTORS,
  type DetectedScaffoldRegion,
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

// Generation (new)
export {
  generateTestCases,
  type GeneratorOptions,
} from "./generation/generator";
export { assignPriority, assignSuiteTags } from "./generation/suite-tagger";
export {
  generateRenderTest,
  type GeneratedTestCase,
} from "./generation/render";
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
export { runTestRun } from "./orchestrator/runner";
export { executeTestCase } from "./orchestrator/test-case-executor";
export type {
  RunConfig,
  ScanEventHandler,
  ScanResult,
} from "./orchestrator/types";

// Orchestrator (deprecated — use runTestRun)
export { runScan } from "./orchestrator/orchestrator";
export { processDecompositionJob } from "./orchestrator/decomposition";
export { executeTestCases } from "./orchestrator/test-execution";
export type { ScanConfig } from "./orchestrator/types";

// Analyzer
export { PageAnalyzer, type AnalyzerContext } from "./analyzer";

// Expertise system
export type { Outcome, ExpertiseContext, Expertise } from "./expertise";
export {
  TesterExpertise,
  SeoExpertise,
  SecurityExpertise,
  PerformanceExpertise,
  NoopExpertise,
  createDefaultExpertises,
} from "./expertise";

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
