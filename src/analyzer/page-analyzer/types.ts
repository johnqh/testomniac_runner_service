import type {
  ActionableItem,
  FormInfo,
  SizeClass,
  TestStep,
  TestSurfaceBundleRunResponse,
  TestSurfaceResponse,
} from "@sudobility/testomniac_types";
import type { ApiClient } from "../../api/client.js";
import type { ScanEventHandler } from "../../orchestrator/types.js";
import type { DetectedScaffoldRegion } from "@sudobility/webgraph_parser";
import type { LoginDetectionResult } from "@sudobility/webgraph_parser";
import type { LoginConfig } from "../../orchestrator/login-manager.js";

export interface AnalyzerContext {
  runnerId: number;
  testEnvironmentId?: number;
  sizeClass: SizeClass;
  uid?: string;
  currentTestInteractionId: number;
  currentTestSurfaceId: number;
  currentSurfaceRunId: number | null;
  html: string;
  currentPageStateId: number;
  beginningPageStateId: number;
  currentPath: string;
  pageId: number;
  pageRequiresLogin: boolean;
  scaffolds: DetectedScaffoldRegion[];
  actionableItems: ActionableItem[];
  forms: FormInfo[];
  journeySteps: TestStep[];
  navigationSurface: TestSurfaceResponse;
  bundleRun: TestSurfaceBundleRunResponse;
  api: ApiClient;
  events: ScanEventHandler;
  siteOrigin?: string;
  scanScopePath?: string;
  screenshotPath?: string;
  loginDetection?: LoginDetectionResult;
  loginConfig?: LoginConfig;
}
