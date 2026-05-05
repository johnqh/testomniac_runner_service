import type {
  TestCase,
  Expectation,
  ActionableItem,
  SizeClass,
  TestSuiteResponse,
  TestSuiteBundleRunResponse,
  TestSuiteRunResponse,
} from "@sudobility/testomniac_types";
import {
  PlaywrightAction,
  ExpectationType,
  ExpectationSeverity,
} from "@sudobility/testomniac_types";
import type { ApiClient } from "../api/client";
import type { DetectedScaffoldRegion } from "../scanner/component-detector";

export interface AnalyzerContext {
  runnerId: number;
  sizeClass: SizeClass;
  uid?: string;
  currentPageStateId: number;
  beginningPageStateId: number;
  currentPath: string;
  pageId: number;
  pageRequiresLogin: boolean;
  scaffolds: DetectedScaffoldRegion[];
  actionableItems: ActionableItem[];
  navigationSuite: TestSuiteResponse;
  bundleRun: TestSuiteBundleRunResponse;
  api: ApiClient;
}

/**
 * PageAnalyzer generates expectations and discovers new test cases
 * during discovery mode.
 */
export class PageAnalyzer {
  /**
   * Generate baseline expectations for a test case.
   * Called BEFORE expertises evaluate.
   */
  generateExpectations(testCase: TestCase): Expectation[] {
    const expectations: Expectation[] = [
      {
        expectationType: ExpectationType.PageLoaded,
        severity: ExpectationSeverity.MustPass,
        description: "Page should load with valid HTML and no HTTP error",
        playwrightCode: "await expect(page).not.toHaveTitle(/error/i)",
      },
    ];

    // If test case has only a navigation action, no more expectations
    const isNavigationOnly =
      testCase.steps.length === 1 &&
      testCase.steps[0].action.actionType === PlaywrightAction.Goto;

    if (!isNavigationOnly) {
      expectations.push({
        expectationType: ExpectationType.NoConsoleErrors,
        severity: ExpectationSeverity.ShouldPass,
        description: "No console errors during test execution",
        playwrightCode: "// checked by TesterExpertise",
      });
      expectations.push({
        expectationType: ExpectationType.NoNetworkErrors,
        severity: ExpectationSeverity.ShouldPass,
        description: "No network errors during test execution",
        playwrightCode: "// checked by TesterExpertise",
      });
    }

    return expectations;
  }

  /**
   * Generate new test cases for scaffolds and page content.
   * Called AFTER expertises evaluate and test case run results are set.
   *
   * Also performs mouse-over fixup: if a hover had no visible effect,
   * adds a click action.
   */
  async generateTestCases(
    testCase: TestCase,
    context: AnalyzerContext
  ): Promise<void> {
    const {
      api: _api,
      runnerId: _runnerId,
      sizeClass: _sizeClass,
      uid: _uid,
    } = context;

    // Mouse-over fixup
    await this.mouseOverFixup(testCase, context);

    // a. Navigation test cases — for every link on the page
    await this.generateNavigationTestCases(context);

    // b. Scaffold test cases — for each scaffold's actionable elements
    await this.generateScaffoldTestCases(context);

    // c. Content test cases — for non-scaffold actionable elements
    await this.generateContentTestCases(context);
  }

  private async mouseOverFixup(
    testCase: TestCase,
    context: AnalyzerContext
  ): Promise<void> {
    const isHoverOnly =
      testCase.steps.length === 1 &&
      testCase.steps[0].action.actionType === PlaywrightAction.Hover;

    if (
      isHoverOnly &&
      context.currentPageStateId === context.beginningPageStateId
    ) {
      // Hover had no visible effect — add a click action
      const hoverStep = testCase.steps[0];
      testCase.steps.push({
        action: {
          ...hoverStep.action,
          actionType: PlaywrightAction.Click,
          description: hoverStep.action.description.replace("Hover", "Click"),
        },
        expectations: [],
        description: `Click ${hoverStep.description.replace("Hover over ", "")} (hover had no effect)`,
        continueOnFailure: true,
      });
    }
  }

  private async generateNavigationTestCases(
    context: AnalyzerContext
  ): Promise<void> {
    if (context.pageRequiresLogin) return;

    const { api, runnerId, sizeClass, uid, navigationSuite, bundleRun } =
      context;
    const links = context.actionableItems.filter(
      item => item.actionKind === "navigate" && item.href && item.visible
    );

    // Ensure navigation suite is in the bundle
    await api.ensureBundleSuiteLink(
      bundleRun.testSuiteBundleId,
      navigationSuite.id
    );

    // Ensure a suite run exists for the navigation suite under this bundle run
    const suiteRun = await this.ensureSuiteRun(
      api,
      navigationSuite.id,
      bundleRun.id
    );

    for (const link of links) {
      if (!link.href) continue;
      const path = this.extractRelativePath(link.href);
      if (!path) continue;

      const testCase = this.buildNavigationTestCase(path, sizeClass, uid);
      const tc = await api.ensureTestCase(
        runnerId,
        navigationSuite.id,
        testCase
      );
      await api.createTestCaseRun({
        testCaseId: tc.id,
        testSuiteRunId: suiteRun.id,
      });
    }
  }

  private async generateScaffoldTestCases(
    context: AnalyzerContext
  ): Promise<void> {
    const { api, runnerId, sizeClass, uid, bundleRun } = context;

    for (const scaffold of context.scaffolds) {
      // Find actionable items belonging to this scaffold
      const scaffoldItems = context.actionableItems.filter(
        item => item.scaffoldId != null && this.isMouseActionable(item)
      );
      if (scaffoldItems.length === 0) continue;

      // Ensure a test suite for this scaffold
      const suiteTitle = `Scaffold: ${scaffold.type}`;
      const suite = await api.ensureTestSuite(runnerId, {
        title: suiteTitle,
        description: `Tests for ${scaffold.type} scaffold`,
        startingPageStateId: context.currentPageStateId,
        startingPath: context.currentPath,
        sizeClass,
        priority: 3,
        suite_tags: ["scaffold", scaffold.type],
        uid,
      });

      await api.ensureBundleSuiteLink(bundleRun.testSuiteBundleId, suite.id);
      const suiteRun = await this.ensureSuiteRun(api, suite.id, bundleRun.id);

      for (const item of scaffoldItems) {
        const testCase = this.buildHoverTestCase(
          item,
          context.currentPath,
          sizeClass,
          uid
        );
        const tc = await api.ensureTestCase(runnerId, suite.id, testCase);
        await api.createTestCaseRun({
          testCaseId: tc.id,
          testSuiteRunId: suiteRun.id,
        });
      }
    }
  }

  private async generateContentTestCases(
    context: AnalyzerContext
  ): Promise<void> {
    const {
      api,
      runnerId,
      sizeClass,
      uid,
      bundleRun,
      pageId: _pageId,
    } = context;

    // Content items are those NOT in a scaffold
    const contentItems = context.actionableItems.filter(
      item => item.scaffoldId == null && this.isMouseActionable(item)
    );
    if (contentItems.length === 0) return;

    const suiteTitle = `Page: ${context.currentPath}`;
    const suite = await api.ensureTestSuite(runnerId, {
      title: suiteTitle,
      description: `Tests for page content at ${context.currentPath}`,
      startingPageStateId: context.currentPageStateId,
      startingPath: context.currentPath,
      sizeClass,
      priority: 3,
      suite_tags: ["page-content"],
      uid,
    });

    await api.ensureBundleSuiteLink(bundleRun.testSuiteBundleId, suite.id);
    const suiteRun = await this.ensureSuiteRun(api, suite.id, bundleRun.id);

    for (const item of contentItems) {
      const testCase = this.buildHoverTestCase(
        item,
        context.currentPath,
        sizeClass,
        uid
      );
      const tc = await api.ensureTestCase(runnerId, suite.id, testCase);
      await api.createTestCaseRun({
        testCaseId: tc.id,
        testSuiteRunId: suiteRun.id,
      });
    }
  }

  private async ensureSuiteRun(
    api: ApiClient,
    testSuiteId: number,
    bundleRunId: number
  ): Promise<TestSuiteRunResponse> {
    // Create a new suite run under this bundle run
    return api.createTestSuiteRun({
      testSuiteId,
      testSuiteBundleRunId: bundleRunId,
    });
  }

  private isMouseActionable(item: ActionableItem): boolean {
    return (
      item.visible &&
      !item.disabled &&
      (item.actionKind === "click" || item.actionKind === "navigate")
    );
  }

  private extractRelativePath(href: string): string | null {
    try {
      const url = new URL(href, "http://placeholder");
      return url.pathname + url.search;
    } catch {
      return null;
    }
  }

  private buildNavigationTestCase(
    path: string,
    sizeClass: SizeClass,
    uid?: string
  ): TestCase {
    return {
      title: `Navigate to ${path}`,
      type: "navigation",
      sizeClass,
      suite_tags: ["navigation"],
      priority: 3,
      startingPageStateId: 0,
      startingPath: path,
      steps: [
        {
          action: {
            actionType: PlaywrightAction.Goto,
            path,
            playwrightCode: `await page.goto('${path}')`,
            description: `Navigate to ${path}`,
          },
          expectations: [],
          description: `Navigate to ${path}`,
          continueOnFailure: false,
        },
      ],
      globalExpectations: [],
      uid,
    };
  }

  private buildHoverTestCase(
    item: ActionableItem,
    startingPath: string,
    sizeClass: SizeClass,
    uid?: string
  ): TestCase {
    const label = item.accessibleName || item.textContent || item.selector;
    return {
      title: `Hover over ${label}`,
      type: "interaction",
      sizeClass,
      suite_tags: ["interaction", "hover"],
      priority: 4,
      startingPageStateId: 0,
      startingPath,
      steps: [
        {
          action: {
            actionType: PlaywrightAction.Hover,
            playwrightCode: `await page.hover('${item.selector}')`,
            description: `Hover over ${label}`,
          },
          expectations: [],
          description: `Hover over ${label}`,
          continueOnFailure: true,
        },
      ],
      globalExpectations: [],
      uid,
    };
  }
}
