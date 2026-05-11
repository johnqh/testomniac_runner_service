import type {
  Expectation,
  ExpectationSeverity,
  NetworkLogEntry,
} from "@sudobility/testomniac_types";
import type { DetectedScaffoldRegion } from "../scanner/component-detector";
import type { DetectedPatternWithInstances } from "../scanner/pattern-detector";
import type { ControlState } from "./tester/control-state";
import type { UiSnapshot } from "../browser/ui-snapshot";

export interface Outcome {
  expected: string;
  observed: string;
  result: "pass" | "warning" | "error";
  severity?: ExpectationSeverity;
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
}

export interface Expertise {
  name: string;
  evaluate(context: ExpertiseContext): Outcome[];
}
