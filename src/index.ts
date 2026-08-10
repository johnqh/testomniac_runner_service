// Browser abstraction
export type {
  BrowserAdapter,
  RuntimeArtifacts,
  CapturedNetworkRequest,
} from "@sudobility/webgraph_parser";

// Shared domain types, re-exported for consumers of this package.
export * from "./domain/types.js";

// Storage
export type { DedupStore } from "./storage/dedup-store.js";
export { InMemoryDedupStore } from "./storage/dedup-store.js";

// Scanner modules (existing)
// Page parsing: regions, patterns, controls, identity.
export * from "@sudobility/webgraph_parser";
// action-queue is deprecated, no longer exported
export * from "./scanner/pairwise.js";
export * from "./scanner/loop-guard.js";
export * from "./scanner/phase-timer.js";
export * from "./scanner/state-manager.js";
export * from "./scanner/scroll-scanner.js";

// Scanner modules (new)
export {
  normalizeHref,
  shouldExpectNavigation,
  looksLikeSubmitAction,
  looksLikeEnterCommitField,
  getActionPriority,
} from "@sudobility/webgraph_parser";
export { Navigator } from "./scanner/navigator.js";
export { ScaffoldCache } from "./scanner/scaffold-cache.js";
export { PageCache } from "./scanner/page-cache.js";
export {
  decomposeHtml,
  type DecomposedHtml,
} from "@sudobility/webgraph_parser";
export {
  detectScaffoldRegions,
  COMPONENT_TYPE_SELECTORS,
  type DetectedScaffoldRegion,
} from "@sudobility/webgraph_parser";

// Page utilities
export {
  sha256,
  normalizeHtml,
  extractVisibleText,
  computeHashes,
} from "@sudobility/webgraph_parser";
export { buildDomSnapshot } from "@sudobility/webgraph_parser";
export {
  NetworkIdleTracker,
  waitForNetworkIdle,
  NETWORK_IDLE_DEFAULTS,
  type NetworkIdleOptions,
  type NetworkIdleDeps,
} from "./browser/network-idle.js";

// Detectors (existing + new)

// Domain types
export * from "./domain/url-ownership.js";

// Constants

// API client
export { ApiClient, getApiClient } from "./api/client.js";

// Extractors (new)
export {
  extractActionableItems,
  getRegisteredExtractorNames,
} from "@sudobility/webgraph_parser";
export { extractForms } from "@sudobility/webgraph_parser";
export type {
  ItemExtractor,
  DomSnapshotEntry,
  ExtractorCandidate,
  SelectorResolvedCandidate,
  ActionKind,
} from "@sudobility/webgraph_parser";

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
export { detectLoginPage, isLoginUrl } from "@sudobility/webgraph_parser";
export type {
  LoginDetectionResult,
  SSOButtonInfo,
} from "@sudobility/webgraph_parser";

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
