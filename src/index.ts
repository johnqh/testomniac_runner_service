// Browser abstraction
export type { BrowserAdapter, RuntimeArtifacts } from "./adapter.js";

// Storage
export type { DedupStore } from "./storage/dedup-store.js";
export { InMemoryDedupStore } from "./storage/dedup-store.js";

// Scanner modules (existing)
export * from "./scanner/issue-detector.js";
// action-queue is deprecated, no longer exported
export * from "./scanner/pairwise.js";
export * from "./scanner/loop-guard.js";
export * from "./scanner/phase-timer.js";
export * from "./scanner/email-detector.js";
export * from "./scanner/component-detector.js";
export * from "./scanner/pattern-detector.js";
export * from "./scanner/state-manager.js";
export * from "./scanner/scroll-scanner.js";

// Scanner modules (new)
export {
  normalizeHref,
  shouldExpectNavigation,
  looksLikeSubmitAction,
  looksLikeEnterCommitField,
  getActionPriority,
} from "./scanner/action-classifier.js";
export { Navigator } from "./scanner/navigator.js";
export { ScaffoldCache } from "./scanner/scaffold-cache.js";
export { PageCache } from "./scanner/page-cache.js";
export {
  decomposeHtml,
  type DecomposedHtml,
} from "./scanner/html-decomposer.js";
export {
  detectScaffoldRegions,
  COMPONENT_TYPE_SELECTORS,
  type DetectedScaffoldRegion,
} from "./scanner/component-detector.js";

// Page utilities
export {
  sha256,
  normalizeHtml,
  extractVisibleText,
  computeHashes,
} from "./browser/page-utils.js";
export { buildDomSnapshot } from "./browser/dom-snapshot.js";
export {
  NetworkIdleTracker,
  waitForNetworkIdle,
  NETWORK_IDLE_DEFAULTS,
  type NetworkIdleOptions,
  type NetworkIdleDeps,
} from "./browser/network-idle.js";

// Detectors (existing + new)
export * from "./detectors/index.js";

// Domain types
export * from "./domain/types.js";
export * from "./domain/url-ownership.js";

// Constants
export * from "./config/constants.js";

// API client
export { ApiClient, getApiClient } from "./api/client.js";

// Extractors (new)
export {
  extractActionableItems,
  getRegisteredExtractorNames,
} from "./extractors/index.js";
export { extractForms } from "./extractors/form-extractor.js";
export type {
  ItemExtractor,
  DomSnapshotEntry,
  ExtractorCandidate,
  SelectorResolvedCandidate,
  ActionKind,
} from "./extractors/types.js";

// Planners (new)
export {
  fillValuePlanner,
  RuleBasedFillValuePlanner,
  type FillValuePlanner,
} from "./planners/fill-value-planner.js";

// Generation (new)
export {
  generateTestInteractions,
  type GeneratorOptions,
} from "./generation/generator.js";
export {
  assignPriority,
  assignSurfaceTags,
} from "./generation/surface-tagger.js";
export {
  generateRenderTest,
  type GeneratedTestInteraction,
} from "./generation/render.js";
export { generateInteractionTest } from "./generation/interaction.js";
export { generateFormTest } from "./generation/form.js";
export { generateFormNegativeTests } from "./generation/form-negative.js";
export {
  generatePasswordTests,
  type PasswordTestInteraction,
} from "./generation/password.js";
export { generateNavigationTest } from "./generation/navigation.js";
export { generateE2ETest, enumerateE2EPaths } from "./generation/e2e.js";

// Orchestrator (new)
export { runTestRun } from "./orchestrator/runner.js";
export {
  runSequenceRun,
  type SequenceRunConfig,
  type SequenceRunResult,
} from "./orchestrator/sequence-runner.js";
export {
  executeTestInteraction,
  setClickWaitMs,
} from "./orchestrator/test-interaction-executor.js";
export type {
  RunConfig,
  ScanEventHandler,
  ScanResult,
} from "./orchestrator/types.js";
export {
  LoginManager,
  type LoginConfig,
} from "./orchestrator/login-manager.js";
export {
  resolveVariables,
  findVariablePaths,
  UnresolvedVariableError,
} from "./orchestrator/variable-resolver.js";
export {
  evaluatePageHealth,
  type PageHealthIssue,
} from "./scanner/page-health-evaluator.js";
export { detectLoginPage, isLoginUrl } from "./scanner/login-detector.js";
export type {
  LoginDetectionResult,
  SSOButtonInfo,
} from "./scanner/login-detector.js";

// Analyzer
export { PageAnalyzer, type AnalyzerContext } from "./analyzer/index.js";

// Expertise system
export type {
  Outcome,
  ExpertiseContext,
  Expertise,
} from "./expertise/index.js";
export {
  createExpertises,
  TesterExpertise,
  SeoExpertise,
  SecurityExpertise,
  PerformanceExpertise,
  NoopExpertise,
  createDefaultExpertises,
} from "./expertise/index.js";

// Plugins (new)
export type {
  Plugin,
  PluginContext,
  PluginResult,
  PluginIssue,
} from "./plugins/types.js";
export {
  registerPlugin,
  getPlugin,
  getEnabledPlugins,
  getAllPluginNames,
} from "./plugins/registry.js";
