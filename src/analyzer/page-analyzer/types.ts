import type {
  ActionableItem,
  FormInfo,
  SizeClass,
  TestStep,
  TestSurfaceBundleRunResponse,
  TestSurfaceResponse,
} from "@sudobility/testomniac_types";
import type { ApiClient } from "../../api/client";
import type { ScanEventHandler } from "../../orchestrator/types";
import type { DetectedScaffoldRegion } from "../../scanner/component-detector";

export interface AnalyzerContext {
  runnerId: number;
  sizeClass: SizeClass;
  uid?: string;
  currentTestElementId: number;
  currentTestSurfaceId: number;
  currentSurfaceRunId: number | null;
  html: string;
  currentPageStateId: number;
  beginningPageStateId: number;
  currentPath: string;
  pageId: number;
  pageRequiresLogin: boolean;
  scaffolds: DetectedScaffoldRegion[];
  scaffoldSelectorByItemSelector: Record<string, string>;
  actionableItems: ActionableItem[];
  forms: FormInfo[];
  journeySteps: TestStep[];
  navigationSurface: TestSurfaceResponse;
  bundleRun: TestSurfaceBundleRunResponse;
  api: ApiClient;
  events: ScanEventHandler;
}
