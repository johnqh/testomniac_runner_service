import type { BrowserAdapter } from "../adapter.js";
import type {
  ActionableItem,
  PageResponse,
  PageStateResponse,
  ActionDefinitionResponse,
} from "@sudobility/testomniac_types";

export interface DetectionContext {
  adapter: BrowserAdapter;
  html: string;
  visibleText: string;
  pageUrl: string;
  pageRecord: PageResponse;
  pageState: PageStateResponse;
  items: ActionableItem[];
  runnerId: number;
  scanId: number;
  currentActionChain: ActionDefinitionResponse[];
}

export interface DetectedIssue {
  severity: "bug" | "warning";
  ruleName: string;
  title: string;
  expectedOutcome: string;
  observedOutcome: string;
  actionChain: number[];
}

export interface DetectionRule {
  name: string;
  severity: "bug" | "warning";
  detect(context: DetectionContext): Promise<DetectedIssue[]>;
}
