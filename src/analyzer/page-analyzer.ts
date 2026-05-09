import type {
  TestElement,
  Expectation,
  ActionableItem,
  SizeClass,
  TestSurfaceResponse,
  TestSurfaceBundleRunResponse,
  TestSurfaceRunResponse,
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
  actionableItems: ActionableItem[];
  navigationSurface: TestSurfaceResponse;
  bundleRun: TestSurfaceBundleRunResponse;
  api: ApiClient;
}

/**
 * PageAnalyzer generates expectations and discovers new test elements
 * during discovery mode.
 */
export class PageAnalyzer {
  /**
   * Generate baseline expectations for a test element.
   * Called BEFORE expertises evaluate.
   */
  generateExpectations(testElement: TestElement): Expectation[] {
    const expectations: Expectation[] = [
      {
        expectationType: ExpectationType.PageLoaded,
        severity: ExpectationSeverity.MustPass,
        description: "Page should load with valid HTML and no HTTP error",
        playwrightCode: "await expect(page).not.toHaveTitle(/error/i)",
      },
    ];

    // If test element has only a navigation action, no more expectations
    const isNavigationOnly =
      testElement.steps.length === 1 &&
      testElement.steps[0].action.actionType === PlaywrightAction.Goto;

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
   * Generate new test elements for scaffolds and page content.
   * Called AFTER expertises evaluate and the target page state is established.
   */
  async generateTestElements(
    testElement: TestElement,
    context: AnalyzerContext
  ): Promise<void> {
    const currentPageStateId = await this.ensureTargetPageState(context);
    const resolvedContext: AnalyzerContext = {
      ...context,
      currentPageStateId,
    };

    if (this.isHoverOnly(testElement)) {
      await this.generateHoverFollowUpCases(testElement, resolvedContext);
      return;
    }

    // a. Navigation test elements — for every link on the page
    await this.generateNavigationTestElements(resolvedContext);

    // b. Scaffold test elements — for each scaffold's actionable elements
    await this.generateScaffoldTestElements(resolvedContext);

    // c. Content test elements — for non-scaffold actionable elements
    await this.generateContentTestElements(resolvedContext);
  }

  private async generateHoverFollowUpCases(
    testElement: TestElement,
    context: AnalyzerContext
  ): Promise<void> {
    const selector = this.getPrimarySelector(testElement);
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
      const clickCase = this.buildClickTestElement(
        hoveredItem,
        context.currentPath,
        context.sizeClass,
        context.uid,
        context.currentPageStateId,
        context.currentTestElementId
      );
      const tc = await context.api.ensureTestElement(
        context.runnerId,
        context.currentTestSurfaceId,
        clickCase
      );
      await context.api.createTestElementRun({
        testElementId: tc.id,
        testSurfaceRunId: context.currentSurfaceRunId ?? undefined,
      });
      return;
    }

    for (const item of revealedItems) {
      const nextHover = this.buildHoverTestElement(
        item,
        context.currentPath,
        context.sizeClass,
        context.uid,
        context.currentPageStateId,
        context.currentTestElementId
      );
      const tc = await context.api.ensureTestElement(
        context.runnerId,
        context.currentTestSurfaceId,
        nextHover
      );
      await context.api.createTestElementRun({
        testElementId: tc.id,
        testSurfaceRunId: context.currentSurfaceRunId ?? undefined,
      });
    }
  }

  private async generateNavigationTestElements(
    context: AnalyzerContext
  ): Promise<void> {
    if (context.pageRequiresLogin) return;

    const { api, runnerId, sizeClass, uid, navigationSurface, bundleRun } =
      context;
    const links = context.actionableItems.filter(
      item => item.actionKind === "navigate" && item.href && item.visible
    );

    // Ensure navigation surface is in the bundle
    await api.ensureBundleSurfaceLink(
      bundleRun.testSurfaceBundleId,
      navigationSurface.id
    );

    // Ensure a surface run exists for the navigation surface under this bundle run
    const surfaceRun = await this.ensureSurfaceRun(
      api,
      navigationSurface.id,
      bundleRun.id
    );

    for (const link of links) {
      if (!link.href) continue;
      const path = this.extractRelativePath(link.href);
      if (!path) continue;

      const testElement = this.buildNavigationTestElement(
        path,
        sizeClass,
        uid,
        context.currentPageStateId
      );
      const tc = await api.ensureTestElement(
        runnerId,
        navigationSurface.id,
        testElement
      );
      await api.createTestElementRun({
        testElementId: tc.id,
        testSurfaceRunId: surfaceRun.id,
      });
    }
  }

  private async generateScaffoldTestElements(
    context: AnalyzerContext
  ): Promise<void> {
    const { api, runnerId, sizeClass, uid, bundleRun } = context;

    for (const scaffold of context.scaffolds) {
      // Find actionable items belonging to this scaffold
      const scaffoldItems = context.actionableItems.filter(
        item => item.scaffoldId != null && this.isMouseActionable(item)
      );
      if (scaffoldItems.length === 0) continue;

      // Ensure a test surface for this scaffold
      const surfaceTitle = `Scaffold: ${scaffold.type}`;
      const surface = await api.ensureTestSurface(runnerId, {
        title: surfaceTitle,
        description: `Tests for ${scaffold.type} scaffold`,
        startingPageStateId: context.currentPageStateId,
        startingPath: context.currentPath,
        sizeClass,
        priority: 3,
        surface_tags: ["scaffold", scaffold.type],
        uid,
      });

      await api.ensureBundleSurfaceLink(
        bundleRun.testSurfaceBundleId,
        surface.id
      );
      const surfaceRun = await this.ensureSurfaceRun(
        api,
        surface.id,
        bundleRun.id
      );

      for (const item of scaffoldItems) {
        const testElement = this.buildHoverTestElement(
          item,
          context.currentPath,
          sizeClass,
          uid,
          context.currentPageStateId
        );
        const tc = await api.ensureTestElement(
          runnerId,
          surface.id,
          testElement
        );
        await api.createTestElementRun({
          testElementId: tc.id,
          testSurfaceRunId: surfaceRun.id,
        });
      }
    }
  }

  private async generateContentTestElements(
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

    const surfaceTitle = `Page: ${context.currentPath}`;
    const surface = await api.ensureTestSurface(runnerId, {
      title: surfaceTitle,
      description: `Tests for page content at ${context.currentPath}`,
      startingPageStateId: context.currentPageStateId,
      startingPath: context.currentPath,
      sizeClass,
      priority: 3,
      surface_tags: ["page-content"],
      uid,
    });

    await api.ensureBundleSurfaceLink(
      bundleRun.testSurfaceBundleId,
      surface.id
    );
    const surfaceRun = await this.ensureSurfaceRun(
      api,
      surface.id,
      bundleRun.id
    );

    for (const item of contentItems) {
      const testElement = this.buildHoverTestElement(
        item,
        context.currentPath,
        sizeClass,
        uid,
        context.currentPageStateId
      );
      const tc = await api.ensureTestElement(runnerId, surface.id, testElement);
      await api.createTestElementRun({
        testElementId: tc.id,
        testSurfaceRunId: surfaceRun.id,
      });
    }
  }

  private async ensureSurfaceRun(
    api: ApiClient,
    testSurfaceId: number,
    bundleRunId: number
  ): Promise<TestSurfaceRunResponse> {
    const openSurfaceRuns = await api.getOpenTestSurfaceRuns(bundleRunId);
    const existing = openSurfaceRuns.find(
      surfaceRun => surfaceRun.testSurfaceId === testSurfaceId
    );
    if (existing) {
      return existing;
    }
    return api.createTestSurfaceRun({
      testSurfaceId,
      testSurfaceBundleRunId: bundleRunId,
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

  private buildNavigationTestElement(
    path: string,
    sizeClass: SizeClass,
    uid?: string,
    startingPageStateId?: number
  ): TestElement {
    return {
      title: `Navigate to ${path}`,
      type: "navigation",
      sizeClass,
      surface_tags: ["navigation"],
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

  private buildHoverTestElement(
    item: ActionableItem,
    startingPath: string,
    sizeClass: SizeClass,
    uid?: string,
    startingPageStateId?: number,
    dependencyTestElementId?: number
  ): TestElement {
    const label = item.accessibleName || item.textContent || item.selector;
    return {
      title: `Hover over ${label}`,
      type: "interaction",
      sizeClass,
      surface_tags: ["interaction", "hover"],
      priority: 4,
      dependencyTestElementId,
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

  private buildClickTestElement(
    item: ActionableItem,
    startingPath: string,
    sizeClass: SizeClass,
    uid?: string,
    startingPageStateId?: number,
    dependencyTestElementId?: number
  ): TestElement {
    const label = item.accessibleName || item.textContent || item.selector;
    return {
      title: `Click ${label}`,
      type: "interaction",
      sizeClass,
      surface_tags: ["interaction", "click"],
      priority: 5,
      dependencyTestElementId,
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

  private isHoverOnly(testElement: TestElement): boolean {
    return (
      testElement.steps.length === 1 &&
      testElement.steps[0].action.actionType === PlaywrightAction.Hover
    );
  }

  private getPrimarySelector(testElement: TestElement): string | null {
    const step = testElement.steps[0];
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
