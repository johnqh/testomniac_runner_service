import type { ApiClient } from "../api/client";
import type { ScanConfig, ScanEventHandler } from "./types";
import { PlaywrightAction } from "../domain/types";

const DIRECT_NAV_SUITE_TITLE = "Direct Navigations";

async function ensureDirectNavigationSuite(
  api: ApiClient,
  config: ScanConfig,
  events: ScanEventHandler
): Promise<number> {
  const suites = await api.getTestSuitesByRunner(config.runnerId);
  const existing = suites.find(suite => suite.title === DIRECT_NAV_SUITE_TITLE);
  if (existing) {
    return existing.id;
  }

  const suite = await api.insertTestSuite(config.runnerId, {
    title: DIRECT_NAV_SUITE_TITLE,
    description: "Auto-created suite for directly navigated URLs",
    startingPath: "/",
    sizeClass: config.sizeClass,
    priority: 1,
    suite_tags: ["direct-navigation"],
  } as any);
  events.onTestSuiteCreated({ suiteId: suite.id, title: suite.title });
  return suite.id;
}

export async function ensureDirectNavigationCase(
  api: ApiClient,
  config: ScanConfig,
  events: ScanEventHandler,
  relativePath: string
): Promise<void> {
  const suiteId = await ensureDirectNavigationSuite(api, config, events);
  const testCase = await api.insertTestCase(
    config.runnerId,
    {
      title: `Navigate to ${relativePath || "/"}`,
      type: "navigation",
      sizeClass: config.sizeClass,
      priority: 1,
      suite_tags: ["direct-navigation"],
      startingPath: relativePath || "/",
      steps: [],
      globalExpectations: [],
    } as any,
    suiteId
  );

  const existingActions = await api.getTestActionsByCase(testCase.id);
  if (existingActions.length > 0) {
    return;
  }

  await api.createTestAction({
    testCaseId: testCase.id,
    stepOrder: 1,
    actionType: PlaywrightAction.Goto,
    path: relativePath || "/",
    playwrightCode: `await page.goto('${relativePath || "/"}');`,
    description: `Navigate to ${relativePath || "/"}`,
    expectations: [],
    continueOnFailure: false,
  });
}
