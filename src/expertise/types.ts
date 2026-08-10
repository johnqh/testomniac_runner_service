import type {
  Expectation,
  ExpectationSeverity,
  ExpertiseRuleId,
  NetworkLogEntry,
} from "@sudobility/testomniac_types";
import type { DetectedScaffoldRegion } from "@sudobility/webgraph_parser";
import type { DetectedPatternWithInstances } from "@sudobility/webgraph_parser";
import type { ControlState } from "@sudobility/webgraph_parser";
import type { UiSnapshot } from "@sudobility/webgraph_parser";
import type { PageHealthIssue } from "../scanner/page-health-evaluator.js";
import type { PerformanceSnapshot } from "../browser/performance-snapshot.js";

export interface Outcome {
  ruleId?: ExpertiseRuleId;
  expected: string;
  observed: string;
  result: "pass" | "warning" | "error";
  severity?: ExpectationSeverity;
  priority?: number;
}

export interface ExpertiseContext {
  html: string;
  initialHtml: string;
  scaffolds: DetectedScaffoldRegion[];
  patterns: DetectedPatternWithInstances[];
  consoleLogs: string[];
  networkLogs: NetworkLogEntry[];
  expectations: Expectation[];
  initialUrl?: string;
  currentUrl?: string;
  startingPath?: string;
  initialUiSnapshot: UiSnapshot;
  finalUiSnapshot: UiSnapshot;
  initialControlStates: ControlState[];
  finalControlStates: ControlState[];
  pageHealthIssues?: PageHealthIssue[];
  performanceSnapshot?: PerformanceSnapshot | null;
}

export interface Expertise {
  name: string;
  evaluate(context: ExpertiseContext): Outcome[];
}
