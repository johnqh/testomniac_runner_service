import type {
  Expectation,
  NetworkLogEntry,
} from "@sudobility/testomniac_types";
import type { DetectedScaffoldRegion } from "../scanner/component-detector";
import type { DetectedPatternWithInstances } from "../scanner/pattern-detector";

export interface Outcome {
  expected: string;
  observed: string;
  result: "pass" | "warning" | "error";
}

export interface ExpertiseContext {
  html: string;
  scaffolds: DetectedScaffoldRegion[];
  patterns: DetectedPatternWithInstances[];
  consoleLogs: string[];
  networkLogs: NetworkLogEntry[];
  expectations: Expectation[];
}

export interface Expertise {
  name: string;
  evaluate(context: ExpertiseContext): Outcome[];
}
