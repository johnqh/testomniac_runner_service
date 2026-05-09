import type {
  TestCase,
  Expectation,
  ActionableItem,
  SizeClass,
  TestSuiteResponse,
  TestSuiteBundleRunResponse,
  TestSuiteRunResponse,
  ActionableItemResponse,
} from "@sudobility/testomniac_types";
import {
  PlaywrightAction,
  ExpectationType,
  ExpectationSeverity,
} from "@sudobility/testomniac_types";
import { computeHashes } from "../browser/page-utils";
import type { ApiClient } from "../api/client";
import type { DetectedScaffoldRegion } from "../scanner/component-detector";
import { createHash } from "node:crypto";

export interface AnalyzerContext {
  runnerId: number;
  sizeClass: SizeClass;
  uid?: string;
  currentTestCaseId: number;
  currentTestSuiteId: number;
  currentSuiteRunId: number | null;
  html: string;
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
   * Called AFTER expertises evaluate and the target page state is established.
   */
  async generateTestCases(
    testCase: TestCase,
    context: AnalyzerContext
  ): Promise<void> {
    const currentPageStateId = await this.ensureTargetPageState(context);
    const resolvedContext: AnalyzerContext = {
      ...context,
      currentPageStateId,
    };

    if (this.isHoverOnly(testCase)) {
      await this.generateHoverFollowUpCases(testCase, resolvedContext);
      return;
    }

    // a. Navigation test cases — for every link on the page
    await this.generateNavigationTestCases(resolvedContext);

    // b. Scaffold test cases — for each scaffold's actionable elements
    await this.generateScaffoldTestCases(resolvedContext);

    // c. Content test cases — for non-scaffold actionable elements
    await this.generateContentTestCases(resolvedContext);
  }

  private async generateHoverFollowUpCases(
    testCase: TestCase,
    context: AnalyzerContext
  ): Promise<void> {
    const selector = this.getPrimarySelector(testCase);
    if (!selector || !context.currentPageStateId) return;

    const beginningItems =
      context.beginningPageStateId > 0
        ? await context.api.getItemsByPageState(context.beginningPageStateId)
        : [];
    const beginningKeys = new Set(
      beginningItems.map(item => this.getItemKey(item)).filter(Boolean)
    );

    const revealedItems = context.actionableItems.filter(item => {
      if (!this.isMouseActionable(item)) return false;
      const key = this.getItemKey(item);
      return Boolean(key) && !beginningKeys.has(key);
    });

    const hoveredItem =
      context.actionableItems.find(item => item.selector === selector) ?? null;

    if (revealedItems.length === 0 && hoveredItem) {
      const clickCase = this.buildClickTestCase(
        hoveredItem,
        context.currentPath,
        context.sizeClass,
        context.uid,
        context.currentPageStateId,
        context.currentTestCaseId
      );
      const tc = await context.api.ensureTestCase(
        context.runnerId,
        context.currentTestSuiteId,
        clickCase
      );
      await context.api.createTestCaseRun({
        testCaseId: tc.id,
        testSuiteRunId: context.currentSuiteRunId ?? undefined,
      });
      return;
    }

    for (const item of revealedItems) {
      const nextHover = this.buildHoverTestCase(
        item,
        context.currentPath,
        context.sizeClass,
        context.uid,
        context.currentPageStateId,
        context.currentTestCaseId
      );
      const tc = await context.api.ensureTestCase(
        context.runnerId,
        context.currentTestSuiteId,
        nextHover
      );
      await context.api.createTestCaseRun({
        testCaseId: tc.id,
        testSuiteRunId: context.currentSuiteRunId ?? undefined,
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

      const testCase = this.buildNavigationTestCase(
        path,
        sizeClass,
        uid,
        context.currentPageStateId
      );
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
          uid,
          context.currentPageStateId
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
        uid,
        context.currentPageStateId
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
    const openSuiteRuns = await api.getOpenTestSuiteRuns(bundleRunId);
    const existing = openSuiteRuns.find(
      suiteRun => suiteRun.testSuiteId === testSuiteId
    );
    if (existing) {
      return existing;
    }
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
    uid?: string,
    startingPageStateId?: number
  ): TestCase {
    return {
      title: `Navigate to ${path}`,
      type: "navigation",
      sizeClass,
      suite_tags: ["navigation"],
      priority: 3,
      startingPageStateId,
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
    uid?: string,
    startingPageStateId?: number,
    dependencyTestCaseId?: number
  ): TestCase {
    const label = item.accessibleName || item.textContent || item.selector;
    return {
      title: `Hover over ${label}`,
      type: "interaction",
      sizeClass,
      suite_tags: ["interaction", "hover"],
      priority: 4,
      dependencyTestCaseId,
      startingPageStateId,
      startingPath,
      steps: [
        {
          action: {
            actionType: PlaywrightAction.Hover,
            path: item.selector ?? undefined,
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

  private buildClickTestCase(
    item: ActionableItem,
    startingPath: string,
    sizeClass: SizeClass,
    uid?: string,
    startingPageStateId?: number,
    dependencyTestCaseId?: number
  ): TestCase {
    const label = item.accessibleName || item.textContent || item.selector;
    return {
      title: `Click ${label}`,
      type: "interaction",
      sizeClass,
      suite_tags: ["interaction", "click"],
      priority: 5,
      dependencyTestCaseId,
      startingPageStateId,
      startingPath,
      steps: [
        {
          action: {
            actionType: PlaywrightAction.Click,
            path: item.selector ?? undefined,
            playwrightCode: `await page.click('${item.selector}')`,
            description: `Click ${label}`,
          },
          expectations: [],
          description: `Click ${label}`,
          continueOnFailure: false,
        },
      ],
      globalExpectations: [],
      uid,
    };
  }

  private isHoverOnly(testCase: TestCase): boolean {
    return (
      testCase.steps.length === 1 &&
      testCase.steps[0].action.actionType === PlaywrightAction.Hover
    );
  }

  private getPrimarySelector(testCase: TestCase): string | null {
    const step = testCase.steps[0];
    return step?.action.path ?? null;
  }

  private getItemKey(
    item:
      | Pick<ActionableItem, "stableKey" | "selector">
      | ActionableItemResponse
  ): string | null {
    const stableKey = "stableKey" in item ? item.stableKey : null;
    const selector = item.selector;
    return stableKey ?? selector ?? null;
  }

  private async ensureTargetPageState(
    context: AnalyzerContext
  ): Promise<number> {
    if (context.currentPageStateId > 0) {
      return context.currentPageStateId;
    }

    const hashes = await computeHashes(context.html, context.actionableItems);
    const existing = await context.api.findMatchingPageState(
      context.pageId,
      hashes,
      context.sizeClass
    );
    if (existing) {
      return existing.id;
    }

    const contentHash = createHash("sha256").update(context.html).digest("hex");
    const contentElement = await context.api.findOrCreateHtmlElement(
      context.html,
      contentHash
    );
    await context.api.insertActionableItems(
      contentElement.id,
      context.actionableItems
    );

    const pageState = await context.api.createPageState({
      pageId: context.pageId,
      sizeClass: context.sizeClass,
      hashes,
      contentText: context.html.slice(0, 5000),
      contentHtmlElementId: contentElement.id,
    });

    return pageState.id;
  }
}
