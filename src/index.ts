// Browser abstraction
export type { BrowserAdapter, RuntimeArtifacts } from "./adapter";

// Storage
export type { DedupStore } from "./storage/dedup-store";
export { InMemoryDedupStore } from "./storage/dedup-store";

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
export {
  NetworkIdleTracker,
  waitForNetworkIdle,
  NETWORK_IDLE_DEFAULTS,
  type NetworkIdleOptions,
  type NetworkIdleDeps,
} from "./browser/network-idle";

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

// Generation (new)
export {
  generateTestInteractions,
  type GeneratorOptions,
} from "./generation/generator";
export { assignPriority, assignSurfaceTags } from "./generation/surface-tagger";
export {
  generateRenderTest,
  type GeneratedTestInteraction,
} from "./generation/render";
export { generateInteractionTest } from "./generation/interaction";
export { generateFormTest } from "./generation/form";
export { generateFormNegativeTests } from "./generation/form-negative";
export {
  generatePasswordTests,
  type PasswordTestInteraction,
} from "./generation/password";
export { generateNavigationTest } from "./generation/navigation";
export { generateE2ETest, enumerateE2EPaths } from "./generation/e2e";

// Orchestrator (new)
export { runTestRun } from "./orchestrator/runner";
export {
  runSequenceRun,
  type SequenceRunConfig,
  type SequenceRunResult,
} from "./orchestrator/sequence-runner";
export {
  executeTestInteraction,
  setClickWaitMs,
} from "./orchestrator/test-interaction-executor";
export type {
  RunConfig,
  ScanEventHandler,
  ScanResult,
} from "./orchestrator/types";
export { LoginManager, type LoginConfig } from "./orchestrator/login-manager";
export {
  resolveVariables,
  findVariablePaths,
  UnresolvedVariableError,
} from "./orchestrator/variable-resolver";
export {
  evaluatePageHealth,
  type PageHealthIssue,
} from "./scanner/page-health-evaluator";
export { detectLoginPage, isLoginUrl } from "./scanner/login-detector";
export type {
  LoginDetectionResult,
  SSOButtonInfo,
} from "./scanner/login-detector";

// Analyzer
export { PageAnalyzer, type AnalyzerContext } from "./analyzer";

// Expertise system
export type { Outcome, ExpertiseContext, Expertise } from "./expertise";
export {
  createExpertises,
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
