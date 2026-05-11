import type {
  TestElement,
  Expectation,
  ActionableItem,
  SizeClass,
  TestSurfaceResponse,
  TestSurfaceBundleRunResponse,
  TestSurfaceRunResponse,
  ActionableItemResponse,
  FormInfo,
  FormField,
  TestStep,
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
import type { ScanEventHandler } from "../orchestrator/types";
import { fillValuePlanner } from "../planners/fill-value-planner";
import { AUTH_URL_PATTERNS, SIGNUP_URL_PATTERNS } from "../config/constants";

type AnalyzerFormField = FormField & {
  disabled?: boolean;
  readOnly?: boolean;
  appearanceHint?: string;
};

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
        description: "Page should load with valid HTML",
        playwrightCode: "await expect(page).not.toHaveTitle(/error/i)",
      },
      {
        expectationType: ExpectationType.NoNetworkErrors,
        severity: ExpectationSeverity.MustPass,
        description: "No network errors during page load or interaction",
        playwrightCode: "// checked by TesterExpertise",
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

    // b. Render test elements — capture render coverage for the page
    await this.generateRenderTestElements(resolvedContext);

    // c. Form and password test elements — build form workflows from extracted forms
    await this.generateFormTestElements(resolvedContext);

    // d. Synthetic journey test elements — build generic business flows from common UI verbs
    await this.generateSemanticJourneyTestElements(resolvedContext);

    // e. Journey test elements — preserve discovered multi-step flows as standalone e2e tests
    await this.generateE2ETestElements(resolvedContext);

    // f. Dialog lifecycle cases — only when a dialog is already open in the analyzed state
    await this.generateDialogLifecycleTestElements(resolvedContext);

    // g. Scaffold test elements — for each scaffold's actionable elements
    await this.generateScaffoldTestElements(resolvedContext);

    // h. Content test elements — for non-scaffold actionable elements
    await this.generateContentTestElements(resolvedContext);

    // i. Keyboard/disclosure cases
    await this.generateKeyboardAndDisclosureTestElements(resolvedContext);
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
        item => item.scaffoldId != null && this.isSurfaceCandidate(item)
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
      context.events.onTestSurfaceCreated({
        surfaceId: surface.id,
        title: surface.title,
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
        const testElement = this.shouldUseDirectControlInteraction(item)
          ? this.buildControlInteractionTestElement(
              item,
              context.currentPath,
              sizeClass,
              uid,
              context.currentPageStateId
            )
          : this.buildHoverTestElement(
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

  private async generateRenderTestElements(
    context: AnalyzerContext
  ): Promise<void> {
    const { api, runnerId, sizeClass, uid, bundleRun } = context;

    const surface = await api.ensureTestSurface(runnerId, {
      title: `Render: ${context.currentPath}`,
      description: `Render validation for ${context.currentPath}`,
      startingPageStateId: context.currentPageStateId,
      startingPath: context.currentPath,
      sizeClass,
      priority: 2,
      surface_tags: ["render"],
      uid,
    });
    context.events.onTestSurfaceCreated({
      surfaceId: surface.id,
      title: surface.title,
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

    const testElement = this.buildRenderTestElement(
      context.currentPath,
      sizeClass,
      uid,
      context.currentPageStateId,
      context.pageId
    );
    const tc = await api.ensureTestElement(runnerId, surface.id, testElement);
    await api.createTestElementRun({
      testElementId: tc.id,
      testSurfaceRunId: surfaceRun.id,
    });
  }

  private async generateFormTestElements(
    context: AnalyzerContext
  ): Promise<void> {
    if (context.forms.length === 0) return;

    const { api, runnerId, sizeClass, uid, bundleRun } = context;
    const surface = await api.ensureTestSurface(runnerId, {
      title: `Forms: ${context.currentPath}`,
      description: `Form workflows for ${context.currentPath}`,
      startingPageStateId: context.currentPageStateId,
      startingPath: context.currentPath,
      sizeClass,
      priority: 2,
      surface_tags: ["form"],
      uid,
    });
    context.events.onTestSurfaceCreated({
      surfaceId: surface.id,
      title: surface.title,
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

    for (let index = 0; index < context.forms.length; index++) {
      const form = context.forms[index];
      const formType = this.identifyFormType(form, context.currentPath);
      const formLabel = this.describeForm(form, index);

      const validValues = this.planFormValues(form, context.actionableItems);
      if (this.isSearchForm(form)) {
        const searchTests = this.buildSearchTestElements(
          form,
          formLabel,
          context.currentPath,
          sizeClass,
          uid,
          context.currentPageStateId,
          validValues
        );

        for (const searchTest of searchTests) {
          const searchElement = await api.ensureTestElement(
            runnerId,
            surface.id,
            searchTest
          );
          await api.createTestElementRun({
            testElementId: searchElement.id,
            testSurfaceRunId: surfaceRun.id,
          });
        }
        continue;
      }

      const positive = this.buildFormTestElement(
        form,
        formLabel,
        formType,
        context.currentPath,
        sizeClass,
        uid,
        context.currentPageStateId,
        validValues
      );
      const positiveElement = await api.ensureTestElement(
        runnerId,
        surface.id,
        positive
      );
      await api.createTestElementRun({
        testElementId: positiveElement.id,
        testSurfaceRunId: surfaceRun.id,
      });

      for (const field of form.fields.filter(field =>
        this.isNegativeCandidateField(field)
      )) {
        const negative = this.buildNegativeFormTestElement(
          form,
          formLabel,
          formType,
          field,
          context.currentPath,
          sizeClass,
          uid,
          context.currentPageStateId,
          validValues
        );
        const negativeElement = await api.ensureTestElement(
          runnerId,
          surface.id,
          negative
        );
        await api.createTestElementRun({
          testElementId: negativeElement.id,
          testSurfaceRunId: surfaceRun.id,
        });

        const correction = this.buildFormCorrectionTestElement(
          form,
          formLabel,
          formType,
          field,
          context.currentPath,
          sizeClass,
          uid,
          context.currentPageStateId,
          validValues
        );
        const correctionElement = await api.ensureTestElement(
          runnerId,
          surface.id,
          correction
        );
        await api.createTestElementRun({
          testElementId: correctionElement.id,
          testSurfaceRunId: surfaceRun.id,
        });
      }

      if (this.isPasswordScenario(formType, form)) {
        const passwordTests = this.buildPasswordTestElements(
          form,
          formLabel,
          formType,
          context.currentPath,
          sizeClass,
          uid,
          context.currentPageStateId,
          validValues,
          this.detectPasswordRequirements(this.extractVisibleText(context.html))
        );

        for (const passwordTest of passwordTests) {
          const passwordElement = await api.ensureTestElement(
            runnerId,
            surface.id,
            passwordTest
          );
          await api.createTestElementRun({
            testElementId: passwordElement.id,
            testSurfaceRunId: surfaceRun.id,
          });
        }
      }
    }
  }

  private async generateE2ETestElements(
    context: AnalyzerContext
  ): Promise<void> {
    if (context.journeySteps.length < 2) return;

    const { api, runnerId, sizeClass, uid, bundleRun } = context;
    const surface = await api.ensureTestSurface(runnerId, {
      title: `Journeys: ${context.currentPath}`,
      description: `End-to-end journeys reaching ${context.currentPath}`,
      startingPageStateId: context.currentPageStateId,
      startingPath: context.currentPath,
      sizeClass,
      priority: 2,
      surface_tags: ["e2e"],
      uid,
    });
    context.events.onTestSurfaceCreated({
      surfaceId: surface.id,
      title: surface.title,
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

    const e2e = this.buildE2ETestElement(
      context.currentPath,
      sizeClass,
      uid,
      context.currentPageStateId,
      context.journeySteps
    );
    const tc = await api.ensureTestElement(runnerId, surface.id, e2e);
    await api.createTestElementRun({
      testElementId: tc.id,
      testSurfaceRunId: surfaceRun.id,
    });
  }

  private async generateSemanticJourneyTestElements(
    context: AnalyzerContext
  ): Promise<void> {
    const journeys = this.buildSemanticJourneyTestElements(context);
    if (journeys.length === 0) return;

    const { api, runnerId, bundleRun } = context;
    const surface = await api.ensureTestSurface(runnerId, {
      title: `Journeys: ${context.currentPath}`,
      description: `Semantic multi-step journeys from ${context.currentPath}`,
      startingPageStateId: context.currentPageStateId,
      startingPath: context.currentPath,
      sizeClass: context.sizeClass,
      priority: 2,
      surface_tags: ["e2e", "semantic-journey"],
      uid: context.uid,
    });
    context.events.onTestSurfaceCreated({
      surfaceId: surface.id,
      title: surface.title,
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

    for (const journey of journeys) {
      const tc = await api.ensureTestElement(runnerId, surface.id, journey);
      await api.createTestElementRun({
        testElementId: tc.id,
        testSurfaceRunId: surfaceRun.id,
      });
    }
  }

  private async generateDialogLifecycleTestElements(
    context: AnalyzerContext
  ): Promise<void> {
    if (!this.pageHasOpenDialog(context.html)) return;

    const closeCandidates = context.actionableItems.filter(
      item =>
        item.visible &&
        !item.disabled &&
        item.selector &&
        this.isDialogCloseItem(item)
    );

    const tests: TestElement[] = [];
    for (const item of closeCandidates) {
      tests.push(
        this.buildDialogCloseTestElement(
          item,
          context.currentPath,
          context.sizeClass,
          context.uid,
          context.currentPageStateId
        )
      );
    }
    tests.push(
      this.buildEscapeDialogTestElement(
        context.currentPath,
        context.sizeClass,
        context.uid,
        context.currentPageStateId
      )
    );

    const { api, runnerId, bundleRun } = context;
    const surface = await api.ensureTestSurface(runnerId, {
      title: `Dialogs: ${context.currentPath}`,
      description: `Dialog lifecycle checks for ${context.currentPath}`,
      startingPageStateId: context.currentPageStateId,
      startingPath: context.currentPath,
      sizeClass: context.sizeClass,
      priority: 2,
      surface_tags: ["dialog"],
      uid: context.uid,
    });
    context.events.onTestSurfaceCreated({
      surfaceId: surface.id,
      title: surface.title,
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

    for (const test of tests) {
      const tc = await api.ensureTestElement(runnerId, surface.id, test);
      await api.createTestElementRun({
        testElementId: tc.id,
        testSurfaceRunId: surfaceRun.id,
      });
    }
  }

  private async generateKeyboardAndDisclosureTestElements(
    context: AnalyzerContext
  ): Promise<void> {
    const tests = this.buildKeyboardAndDisclosureTestElements(context);
    if (tests.length === 0) return;

    const { api, runnerId, bundleRun } = context;
    const surface = await api.ensureTestSurface(runnerId, {
      title: `Keyboard: ${context.currentPath}`,
      description: `Keyboard parity and disclosure checks for ${context.currentPath}`,
      startingPageStateId: context.currentPageStateId,
      startingPath: context.currentPath,
      sizeClass: context.sizeClass,
      priority: 3,
      surface_tags: ["keyboard", "disclosure"],
      uid: context.uid,
    });
    context.events.onTestSurfaceCreated({
      surfaceId: surface.id,
      title: surface.title,
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

    for (const test of tests) {
      const tc = await api.ensureTestElement(runnerId, surface.id, test);
      await api.createTestElementRun({
        testElementId: tc.id,
        testSurfaceRunId: surfaceRun.id,
      });
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
      item => item.scaffoldId == null && this.isSurfaceCandidate(item)
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
    context.events.onTestSurfaceCreated({
      surfaceId: surface.id,
      title: surface.title,
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
      const testElement = this.shouldUseDirectControlInteraction(item)
        ? this.buildControlInteractionTestElement(
            item,
            context.currentPath,
            sizeClass,
            uid,
            context.currentPageStateId
          )
        : this.buildHoverTestElement(
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

  private isSurfaceCandidate(item: ActionableItem): boolean {
    if (!item.visible || !item.selector || item.disabled) return false;

    return ["click", "navigate", "fill", "select", "radio_select"].includes(
      item.actionKind
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
    const scaffoldIdsBySelector = await this.ensureScaffolds(context);

    for (const item of context.actionableItems) {
      if (!item.selector) continue;
      const scaffoldSelector =
        context.scaffoldSelectorByItemSelector[item.selector] ?? null;
      if (!scaffoldSelector) continue;
      const scaffoldId = scaffoldIdsBySelector.get(scaffoldSelector);
      if (scaffoldId) {
        item.scaffoldId = scaffoldId;
      }
    }

    if (context.currentPageStateId > 0) {
      if (scaffoldIdsBySelector.size > 0) {
        await context.api.linkPageStateScaffolds(
          context.currentPageStateId,
          Array.from(new Set(scaffoldIdsBySelector.values()))
        );
      }
      context.events.onPageStateCreated({
        pageStateId: context.currentPageStateId,
        pageId: context.pageId,
      });
      await this.ensureStoredForms(context.currentPageStateId, context);
      return context.currentPageStateId;
    }

    const hashes = await computeHashes(context.html, context.actionableItems);
    const existing = await context.api.findMatchingPageState(
      context.pageId,
      hashes,
      context.sizeClass
    );
    if (existing) {
      if (scaffoldIdsBySelector.size > 0) {
        await context.api.linkPageStateScaffolds(
          existing.id,
          Array.from(new Set(scaffoldIdsBySelector.values()))
        );
      }
      context.events.onPageStateCreated({
        pageStateId: existing.id,
        pageId: context.pageId,
      });
      await this.ensureStoredForms(existing.id, context);
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
    context.events.onPageStateCreated({
      pageStateId: pageState.id,
      pageId: context.pageId,
    });

    if (scaffoldIdsBySelector.size > 0) {
      await context.api.linkPageStateScaffolds(
        pageState.id,
        Array.from(new Set(scaffoldIdsBySelector.values()))
      );
    }

    await this.ensureStoredForms(pageState.id, context);

    return pageState.id;
  }

  private async ensureScaffolds(
    context: AnalyzerContext
  ): Promise<Map<string, number>> {
    const scaffoldIdsBySelector = new Map<string, number>();

    for (const scaffold of context.scaffolds) {
      const result = await context.api.findOrCreateScaffold({
        runnerId: context.runnerId,
        type: scaffold.type,
        html: scaffold.outerHtml,
        hash: scaffold.hash,
      });
      scaffoldIdsBySelector.set(scaffold.selector, result.id);
    }

    return scaffoldIdsBySelector;
  }

  private async ensureStoredForms(
    pageStateId: number,
    context: AnalyzerContext
  ): Promise<void> {
    if (context.forms.length === 0) return;

    const existing = await context.api.getFormsByPageState(pageStateId);
    const existingSelectors = new Set(existing.map(form => form.selector));

    for (const form of context.forms) {
      if (existingSelectors.has(form.selector)) continue;
      await context.api.insertForm(
        pageStateId,
        form,
        this.identifyFormType(form, context.currentPath)
      );
    }
  }

  private buildRenderTestElement(
    currentPath: string,
    sizeClass: SizeClass,
    uid: string | undefined,
    startingPageStateId: number,
    pageId: number
  ): TestElement {
    return {
      title: `Render — ${currentPath}`,
      type: "render",
      sizeClass,
      surface_tags: ["render"],
      priority: 2,
      page_id: pageId,
      startingPageStateId,
      startingPath: currentPath,
      steps: [
        {
          action: {
            actionType: PlaywrightAction.Goto,
            path: currentPath,
            playwrightCode: `await page.goto('${currentPath}')`,
            description: `Navigate to ${currentPath}`,
          },
          expectations: [
            {
              expectationType: ExpectationType.PageLoaded,
              severity: ExpectationSeverity.MustPass,
              description: `Page ${currentPath} should load`,
              playwrightCode: "await page.waitForLoadState('networkidle')",
            },
          ],
          description: `Navigate to ${currentPath}`,
          continueOnFailure: false,
        },
        {
          action: {
            actionType: PlaywrightAction.WaitForLoadState,
            playwrightCode: "await page.waitForLoadState('networkidle')",
            description: "Wait for page to settle",
          },
          expectations: [],
          description: "Wait for page to settle",
          continueOnFailure: true,
        },
        {
          action: {
            actionType: PlaywrightAction.Screenshot,
            value: `render-${this.slugify(currentPath)}`,
            playwrightCode: `await page.screenshot({ fullPage: true })`,
            description: "Capture screenshot",
          },
          expectations: [],
          description: "Capture screenshot",
          continueOnFailure: true,
        },
      ],
      globalExpectations: this.defaultFlowExpectations(
        "Render page without runtime errors"
      ),
      uid,
    };
  }

  private buildFormTestElement(
    form: FormInfo,
    formLabel: string,
    formType: "login" | "signup" | "other",
    currentPath: string,
    sizeClass: SizeClass,
    uid: string | undefined,
    startingPageStateId: number,
    validValues: Record<string, string>
  ): TestElement {
    const steps = this.buildFormSteps(form, validValues, undefined);
    return {
      title: `Form — ${formLabel}`,
      type: "form",
      sizeClass,
      surface_tags: ["form", formType],
      priority: this.formPriority(formType),
      startingPageStateId,
      startingPath: currentPath,
      steps,
      globalExpectations: [
        ...this.defaultFlowExpectations(
          `Form ${formLabel} should execute cleanly`
        ),
        this.makeExpectation(
          ExpectationType.FormSubmittedSuccessfully,
          `Form ${formLabel} should submit without client-side errors`
        ),
        this.makeExpectation(
          ExpectationType.NetworkRequestMade,
          `Submitting ${formLabel} should trigger a backend mutation request`,
          {
            expectedValue: "mutation",
          }
        ),
        this.makeExpectation(
          "feedback_visible",
          `Submitting ${formLabel} should provide visible user feedback`,
          {
            expectedTextTokens: [
              "success",
              "saved",
              "submitted",
              "thank",
              "done",
            ],
            forbiddenTextTokens: ["error", "failed", "try again"],
          }
        ),
        this.makeExpectation(
          "field_error_clears_after_fix",
          `Validation errors on ${formLabel} should clear once the fields are corrected`
        ),
      ],
      uid,
    };
  }

  private buildNegativeFormTestElement(
    form: FormInfo,
    formLabel: string,
    formType: "login" | "signup" | "other",
    omittedField: FormField,
    currentPath: string,
    sizeClass: SizeClass,
    uid: string | undefined,
    startingPageStateId: number,
    validValues: Record<string, string>
  ): TestElement {
    const steps = this.buildFormSteps(form, validValues, omittedField.selector);
    return {
      title: `Form Negative — ${formLabel} (missing ${this.fieldLabel(omittedField)})`,
      type: "form_negative",
      sizeClass,
      surface_tags: ["form", "negative", formType],
      priority: this.formPriority(formType) + 1,
      startingPageStateId,
      startingPath: currentPath,
      steps,
      globalExpectations: [
        ...this.defaultFlowExpectations(`Negative form check for ${formLabel}`),
        this.makeExpectation(
          ExpectationType.ValidationMessageVisible,
          `Validation feedback should appear when ${this.fieldLabel(omittedField)} is omitted`
        ),
        this.makeExpectation(
          "required_error_shown_for_field",
          `${this.fieldLabel(omittedField)} should show a required-field error when omitted`,
          {
            targetPath: omittedField.selector,
          }
        ),
      ],
      uid,
    };
  }

  private buildFormCorrectionTestElement(
    form: FormInfo,
    formLabel: string,
    formType: "login" | "signup" | "other",
    correctedField: FormField,
    currentPath: string,
    sizeClass: SizeClass,
    uid: string | undefined,
    startingPageStateId: number,
    validValues: Record<string, string>
  ): TestElement {
    const steps = this.buildFormSteps(
      form,
      validValues,
      correctedField.selector
    );
    const correctionValue = validValues[correctedField.selector];
    if (correctionValue) {
      const correctionStep = this.buildFieldStep(
        correctedField,
        correctionValue,
        this.makeExpectation(
          "field_error_clears_after_fix",
          `${this.fieldLabel(correctedField)} should clear its validation error after correction`,
          {
            targetPath: correctedField.selector,
          }
        )
      );
      if (correctionStep) {
        steps.push(correctionStep);
      }
    }
    steps.push(...this.buildSubmitSteps(form.submitSelector));

    return {
      title: `Form Correction — ${formLabel} (fix ${this.fieldLabel(correctedField)})`,
      type: "form",
      sizeClass,
      surface_tags: ["form", "correction", formType],
      priority: this.formPriority(formType) + 1,
      startingPageStateId,
      startingPath: currentPath,
      steps,
      globalExpectations: [
        ...this.defaultFlowExpectations(`Correction flow for ${formLabel}`),
        this.makeExpectation(
          ExpectationType.FormSubmittedSuccessfully,
          `Form ${formLabel} should submit after correcting ${this.fieldLabel(correctedField)}`
        ),
        this.makeExpectation(
          ExpectationType.NetworkRequestMade,
          `Submitting ${formLabel} after correction should trigger a backend mutation request`,
          {
            expectedValue: "mutation",
          }
        ),
        this.makeExpectation(
          "feedback_visible",
          `Form ${formLabel} should show success feedback after correction`,
          {
            expectedTextTokens: [
              "success",
              "saved",
              "submitted",
              "thank",
              "done",
            ],
            forbiddenTextTokens: ["error", "required", "invalid"],
          }
        ),
      ],
      uid,
    };
  }

  private buildPasswordTestElements(
    form: FormInfo,
    formLabel: string,
    formType: "login" | "signup" | "other",
    currentPath: string,
    sizeClass: SizeClass,
    uid: string | undefined,
    startingPageStateId: number,
    validValues: Record<string, string>,
    passwordRequirements: PasswordRequirementSnapshot
  ): TestElement[] {
    const passwordFields = form.fields.filter(
      field => field.type === "password"
    );
    if (passwordFields.length === 0) return [];

    const variants = this.generatePasswordVariants(passwordRequirements);
    return variants.map(variant => {
      const values = { ...validValues };
      for (const field of passwordFields) {
        values[field.selector] = variant.password;
      }

      return {
        title: `Password — ${formLabel} (${variant.description})`,
        type: "password",
        sizeClass,
        surface_tags: ["form", "password", formType],
        priority: variant.shouldFail ? 2 : 1,
        startingPageStateId,
        startingPath: currentPath,
        steps: this.buildFormSteps(form, values, undefined),
        globalExpectations: [
          ...this.defaultFlowExpectations(
            `Password flow ${variant.description}`
          ),
          {
            expectationType: variant.shouldFail
              ? ExpectationType.ValidationMessageVisible
              : ExpectationType.FormSubmittedSuccessfully,
            severity: ExpectationSeverity.ShouldPass,
            description: variant.shouldFail
              ? `Password validation should reject ${variant.description}`
              : `Password validation should accept ${variant.description}`,
            playwrightCode: "// checked by password follow-up validation",
          },
        ],
        uid,
      };
    });
  }

  private buildE2ETestElement(
    currentPath: string,
    sizeClass: SizeClass,
    uid: string | undefined,
    startingPageStateId: number,
    journeySteps: TestStep[]
  ): TestElement {
    return {
      title: `E2E — Journey to ${currentPath}`,
      type: "e2e",
      sizeClass,
      surface_tags: ["e2e"],
      priority: 2,
      startingPageStateId,
      startingPath: currentPath,
      steps: journeySteps.map(step => ({
        ...step,
        expectations: [],
      })),
      globalExpectations: this.defaultFlowExpectations(
        `Journey to ${currentPath} should complete without runtime errors`
      ),
      uid,
    };
  }

  private buildFormSteps(
    form: FormInfo,
    valuesBySelector: Record<string, string>,
    omittedSelector?: string
  ): TestStep[] {
    const steps: TestStep[] = [];

    for (const field of form.fields) {
      if (field.selector === omittedSelector) continue;
      const analyzerField = field as AnalyzerFormField;
      const fieldIsImmutable = Boolean(
        analyzerField.disabled ||
        analyzerField.readOnly ||
        this.looksVisuallyDisabledField(analyzerField)
      );

      if (fieldIsImmutable) continue;

      const value = valuesBySelector[field.selector];
      if (!value || this.isSkippableFieldType(field)) continue;

      const step = this.buildFieldStep(field, value);
      if (step) steps.push(step);
    }

    steps.push(...this.buildSubmitSteps(form.submitSelector));

    return steps;
  }

  private buildFieldStep(
    field: FormField,
    value: string,
    trailingExpectation?: Expectation
  ): TestStep | null {
    const analyzerField = field as AnalyzerFormField;
    const fieldIsImmutable = Boolean(
      analyzerField.disabled ||
      analyzerField.readOnly ||
      this.looksVisuallyDisabledField(analyzerField)
    );
    if (fieldIsImmutable) return null;

    if (this.isCheckboxLike(field)) {
      return {
        action: {
          actionType: PlaywrightAction.Check,
          path: field.selector,
          value,
          playwrightCode: `await page.locator('${field.selector}').check()`,
          description: `Check ${this.fieldLabel(field)}`,
        },
        expectations: [
          this.makeExpectation(
            ExpectationType.ElementChecked,
            `Checking ${this.fieldLabel(field)} should update the control state`,
            {
              targetPath: field.selector,
            }
          ),
          ...(trailingExpectation ? [trailingExpectation] : []),
        ],
        description: `Check ${this.fieldLabel(field)}`,
        continueOnFailure: false,
      };
    }

    if (this.isSelectLike(field)) {
      return {
        action: {
          actionType: PlaywrightAction.SelectOption,
          path: field.selector,
          value,
          playwrightCode: `await page.locator('${field.selector}').selectOption('${value}')`,
          description: `Select ${this.fieldLabel(field)}`,
        },
        expectations: [
          this.makeExpectation(
            ExpectationType.InputValue,
            `Selecting ${this.fieldLabel(field)} should update the selected option`,
            {
              targetPath: field.selector,
              expectedValue: value,
            }
          ),
          ...(trailingExpectation ? [trailingExpectation] : []),
        ],
        description: `Select ${this.fieldLabel(field)}`,
        continueOnFailure: false,
      };
    }

    return {
      action: {
        actionType: PlaywrightAction.Type,
        path: field.selector,
        value,
        playwrightCode: `await page.locator('${field.selector}').type('${this.escapeSingleQuotes(value)}')`,
        description: `Fill ${this.fieldLabel(field)}`,
      },
      expectations: [
        this.makeExpectation(
          ExpectationType.InputValue,
          `Typing into ${this.fieldLabel(field)} should update the control value`,
          {
            targetPath: field.selector,
            expectedValue: value,
          }
        ),
        ...(trailingExpectation ? [trailingExpectation] : []),
      ],
      description: `Fill ${this.fieldLabel(field)}`,
      continueOnFailure: false,
    };
  }

  private buildSubmitSteps(submitSelector?: string): TestStep[] {
    if (!submitSelector) return [];

    return [
      {
        action: {
          actionType: PlaywrightAction.Click,
          path: submitSelector,
          playwrightCode: `await page.locator('${submitSelector}').click()`,
          description: "Submit form",
        },
        expectations: [],
        description: "Submit form",
        continueOnFailure: false,
      },
      {
        action: {
          actionType: PlaywrightAction.WaitForLoadState,
          playwrightCode: "await page.waitForLoadState('networkidle')",
          description: "Wait for post-submit state",
        },
        expectations: [],
        description: "Wait for post-submit state",
        continueOnFailure: true,
      },
    ];
  }

  private planFormValues(
    form: FormInfo,
    actionableItems: ActionableItem[]
  ): Record<string, string> {
    const values: Record<string, string> = {};

    for (const field of form.fields) {
      const analyzerField = field as AnalyzerFormField;
      if (
        analyzerField.disabled ||
        analyzerField.readOnly ||
        this.looksVisuallyDisabledField(analyzerField)
      ) {
        continue;
      }

      if (this.isCheckboxLike(field)) {
        values[field.selector] = "true";
        continue;
      }

      if (this.isSelectLike(field)) {
        const option = field.options?.find(
          value => value && value.trim().length > 0
        );
        if (option) values[field.selector] = option;
        continue;
      }

      const item = actionableItems.find(
        candidate => candidate.selector === field.selector
      );
      const fallbackItem: ActionableItem = item ?? {
        stableKey: field.selector,
        selector: field.selector,
        tagName: field.type === "textarea" ? "TEXTAREA" : "INPUT",
        inputType: field.type,
        actionKind: "fill",
        accessibleName: field.label,
        disabled: false,
        visible: true,
        attributes: {
          name: field.name,
          placeholder: field.placeholder,
          labelText: field.label,
        },
      };
      values[field.selector] = fillValuePlanner.planValue(fallbackItem);
    }

    return values;
  }

  private identifyFormType(
    form: FormInfo,
    currentPath: string
  ): "login" | "signup" | "other" {
    const url = currentPath.toLowerCase();
    const fields = form.fields;

    const isLoginUrl = AUTH_URL_PATTERNS.some(pattern => url.includes(pattern));
    const isSignupUrl = SIGNUP_URL_PATTERNS.some(pattern =>
      url.includes(pattern)
    );

    const hasPassword = fields.some(field => field.type === "password");
    const hasEmail = fields.some(field => {
      const label = field.label.toLowerCase();
      return (
        field.type === "email" ||
        field.name.toLowerCase() === "email" ||
        label.includes("email")
      );
    });
    const hasUsername = fields.some(field => {
      const signal = `${field.name} ${field.label}`.toLowerCase();
      return signal.includes("username") || signal.includes("user name");
    });
    const hasName = fields.some(field => {
      const signal = `${field.name} ${field.label}`.toLowerCase();
      return (
        signal.includes("name") &&
        !signal.includes("username") &&
        !signal.includes("email")
      );
    });
    const hasMessage = fields.some(field => {
      const signal = `${field.name} ${field.label}`.toLowerCase();
      return signal.includes("message") || signal.includes("subject");
    });
    const passwordCount = fields.filter(
      field => field.type === "password"
    ).length;

    if (hasMessage) return "other";
    if (!hasPassword) return "other";

    if (hasEmail || hasUsername) {
      if (passwordCount >= 2 || hasName || isSignupUrl) return "signup";
      if (isLoginUrl) return "login";
      if (fields.length <= 2) return "login";
      return hasName ? "signup" : "login";
    }

    if (isSignupUrl) return "signup";
    if (isLoginUrl) return "login";
    return "other";
  }

  private isSearchForm(form: FormInfo): boolean {
    if (String(form.method || "").toUpperCase() === "GET") {
      return true;
    }

    return form.fields.some(field => this.isSearchField(field));
  }

  private isSearchField(field: FormField): boolean {
    const text = [
      field.type,
      field.label,
      field.name,
      field.placeholder,
      field.selector,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return field.type === "search" || /\bsearch\b/.test(text);
  }

  private buildSearchTestElements(
    form: FormInfo,
    formLabel: string,
    currentPath: string,
    sizeClass: SizeClass,
    uid: string | undefined,
    startingPageStateId: number,
    validValues: Record<string, string>
  ): TestElement[] {
    const searchField = form.fields.find(field => this.isSearchField(field));
    if (!searchField) return [];

    const searchValues = {
      ...validValues,
      [searchField.selector]: "test",
    };
    const noResultsValues = {
      ...validValues,
      [searchField.selector]: this.improbableSearchQuery(),
    };

    return [
      {
        title: `Search — ${formLabel}`,
        type: "form",
        sizeClass,
        surface_tags: ["form", "search"],
        priority: 2,
        startingPageStateId,
        startingPath: currentPath,
        steps: this.buildFormSteps(form, searchValues, undefined),
        globalExpectations: [
          ...this.defaultFlowExpectations(`Search flow ${formLabel}`),
          this.makeExpectation(
            ExpectationType.NetworkRequestMade,
            `Searching via ${formLabel} should issue a GET request`,
            {
              expectedValue: "GET",
              expectedTextTokens: ["search", "q=", "query", "term"],
            }
          ),
          this.makeExpectation(
            ExpectationType.NavigationOrStateChanged,
            `Searching via ${formLabel} should change the page or result state`
          ),
          this.makeExpectation(
            ExpectationType.ResultsChanged,
            `Searching via ${formLabel} should change the visible results`
          ),
          this.makeExpectation(
            ExpectationType.LoadingCompletes,
            `Search results for ${formLabel} should finish loading`
          ),
        ],
        uid,
      },
      {
        title: `Search Empty State — ${formLabel}`,
        type: "form",
        sizeClass,
        surface_tags: ["form", "search", "empty-state"],
        priority: 3,
        startingPageStateId,
        startingPath: currentPath,
        steps: this.buildFormSteps(form, noResultsValues, undefined),
        globalExpectations: [
          ...this.defaultFlowExpectations(
            `Empty-state search flow ${formLabel}`
          ),
          this.makeExpectation(
            ExpectationType.NetworkRequestMade,
            `No-result search via ${formLabel} should still issue a GET request`,
            {
              expectedValue: "GET",
              expectedTextTokens: ["search", "q=", "query", "term"],
            }
          ),
          this.makeExpectation(
            ExpectationType.NavigationOrStateChanged,
            `No-result search via ${formLabel} should change the page or result state`
          ),
          this.makeExpectation(
            ExpectationType.EmptyStateVisible,
            `No-result search via ${formLabel} should show an empty state`
          ),
          this.makeExpectation(
            ExpectationType.LoadingCompletes,
            `No-result search for ${formLabel} should finish loading`
          ),
        ],
        uid,
      },
    ];
  }

  private describeForm(form: FormInfo, index: number): string {
    const namedField = form.fields.find(field => field.label || field.name);
    const descriptor =
      namedField?.label || namedField?.name || `form ${index + 1}`;
    return `${descriptor} @ ${form.selector}`;
  }

  private buildSemanticJourneyTestElements(
    context: AnalyzerContext
  ): TestElement[] {
    const items = context.actionableItems.filter(
      item => item.visible && !item.disabled && Boolean(item.selector)
    );
    const journeys: TestElement[] = [];

    const addToCart = items.find(item => this.isAddToCartItem(item));
    const checkout = items.find(item => this.isCheckoutItem(item));
    if (addToCart && checkout) {
      journeys.push(
        this.buildJourneyTestElement(
          "Commerce journey",
          ["commerce", "cart", "checkout"],
          context,
          [
            this.buildJourneyAction(addToCart, "Add item to cart", [
              this.makeExpectation(
                "navigation_or_state_changed",
                "Adding an item to cart should update the page state"
              ),
              this.makeExpectation(
                "count_changed",
                "Adding an item should update a visible count",
                {
                  expectedCountDelta: 1,
                }
              ),
              this.makeExpectation(
                "cart_summary_changed",
                "Adding an item should update the cart summary"
              ),
              this.makeExpectation(
                ExpectationType.NetworkRequestMade,
                "Adding an item should trigger a backend mutation request",
                {
                  expectedValue: "mutation",
                }
              ),
              this.makeExpectation(
                "feedback_visible",
                "Adding an item should provide visible feedback",
                {
                  expectedTextTokens: ["added", "success", "cart", "bag"],
                  forbiddenTextTokens: ["error", "failed"],
                }
              ),
              this.makeExpectation(
                "loading_completes",
                "Cart update should complete loading"
              ),
              this.makeExpectation(
                "page_responsive",
                "Page should remain responsive after cart update"
              ),
            ]),
            this.waitStep(700, "Wait for cart state"),
            this.buildJourneyAction(checkout, "Proceed to checkout", [
              this.makeExpectation(
                "navigation_or_state_changed",
                "Proceeding to checkout should change the page state"
              ),
              this.makeExpectation(
                ExpectationType.NetworkRequestMade,
                "Proceeding to checkout should trigger a network request or document transition",
                {
                  expectedValue: "ANY",
                  expectedTextTokens: ["checkout"],
                }
              ),
              this.makeExpectation(
                "loading_completes",
                "Checkout transition should complete loading"
              ),
              this.makeExpectation(
                "page_responsive",
                "Page should remain responsive during checkout transition"
              ),
            ]),
          ]
        )
      );
    }

    const removeItem = items.find(item => this.isRemoveItemAction(item));
    if (removeItem) {
      journeys.push(
        this.buildJourneyTestElement(
          "Remove item from collection",
          ["commerce", "remove"],
          context,
          [
            this.buildJourneyAction(removeItem, "Remove item", [
              this.makeExpectation(
                "navigation_or_state_changed",
                "Removing an item should change the page state"
              ),
              this.makeExpectation(
                "count_changed",
                "Removing an item should update a visible count",
                {
                  expectedCountDelta: -1,
                }
              ),
              this.makeExpectation(
                "cart_summary_changed",
                "Removing an item should update the cart summary"
              ),
              this.makeExpectation(
                ExpectationType.NetworkRequestMade,
                "Removing an item should trigger a backend mutation request",
                {
                  expectedValue: "mutation",
                }
              ),
              this.makeExpectation(
                "feedback_visible",
                "Removing an item should provide visible feedback",
                {
                  expectedTextTokens: ["removed", "updated", "cart", "bag"],
                  forbiddenTextTokens: ["error", "failed"],
                }
              ),
              this.makeExpectation(
                "loading_completes",
                "Removal flow should complete loading"
              ),
              this.makeExpectation(
                "page_responsive",
                "Page should remain responsive after removal"
              ),
            ]),
          ]
        )
      );
    }

    const authEntry = items.find(item => this.isAuthEntryItem(item));
    if (authEntry) {
      journeys.push(
        this.buildJourneyTestElement(
          "Authentication entry journey",
          ["auth"],
          context,
          [
            this.buildJourneyAction(
              authEntry,
              "Open authentication entry point",
              [
                this.makeExpectation(
                  "navigation_or_state_changed",
                  "Authentication entry should open the next auth state"
                ),
                this.makeExpectation(
                  "loading_completes",
                  "Authentication entry flow should settle"
                ),
                this.makeExpectation(
                  "page_responsive",
                  "Page should remain responsive when opening auth flow"
                ),
              ]
            ),
          ]
        )
      );
    }

    const mediaCandidate = items.find(item => this.isMediaOpenItem(item));
    if (mediaCandidate) {
      const mediaExpectations = [
        this.makeExpectation(
          "modal_opened",
          "Opening media should reveal a modal, overlay, or new state"
        ),
        this.makeExpectation(
          "media_loaded",
          "Opened media should load successfully"
        ),
      ];
      if (this.isVideoLikeItem(mediaCandidate)) {
        mediaExpectations.push(
          this.makeExpectation(
            "video_playable",
            "Opened video should be playable"
          )
        );
      }

      journeys.push(
        this.buildJourneyTestElement("Media open journey", ["media"], context, [
          this.buildJourneyAction(
            mediaCandidate,
            "Open media",
            mediaExpectations
          ),
        ])
      );
    }

    const quantityAction = items.find(item => this.isQuantityAction(item));
    if (quantityAction) {
      journeys.push(
        this.buildJourneyTestElement(
          "Quantity adjustment journey",
          ["commerce", "quantity"],
          context,
          [
            this.buildJourneyAction(quantityAction, "Adjust quantity", [
              this.makeExpectation(
                "count_changed",
                "Adjusting quantity should update a visible count or quantity indicator"
              ),
              this.makeExpectation(
                "cart_summary_changed",
                "Adjusting quantity should update the summary values"
              ),
              this.makeExpectation(
                ExpectationType.NetworkRequestMade,
                "Adjusting quantity should trigger a backend mutation request",
                {
                  expectedValue: "mutation",
                }
              ),
              this.makeExpectation(
                "loading_completes",
                "Quantity adjustment should complete loading"
              ),
            ]),
          ]
        )
      );
    }

    const filterAction = items.find(item => this.isFilterAction(item));
    if (filterAction) {
      journeys.push(
        this.buildJourneyTestElement(
          "Filter results journey",
          ["filter"],
          context,
          [
            this.buildJourneyAction(filterAction, "Apply filter", [
              this.makeExpectation(
                "navigation_or_state_changed",
                "Applying a filter should change the result state"
              ),
              this.makeExpectation(
                "results_changed",
                "Applying a filter should change the visible result summary"
              ),
              this.makeExpectation(
                "loading_completes",
                "Filter update should complete loading"
              ),
            ]),
          ]
        )
      );
      journeys.push(
        this.buildJourneyTestElement(
          "Filter persistence journey",
          ["filter", "reload"],
          context,
          [
            this.buildJourneyAction(filterAction, "Apply filter", [
              this.makeExpectation(
                "navigation_or_state_changed",
                "Applying a filter should change the result state"
              ),
            ]),
            this.waitStep(500, "Wait for filtered state"),
            this.buildReloadStep([
              this.makeExpectation(
                "state_persists_after_reload",
                "Filter state should persist after reload",
                {
                  expectedTextTokens: ["filter", "results", "showing", "items"],
                }
              ),
            ]),
          ]
        )
      );
    }

    const sortAction = items.find(item => this.isSortAction(item));
    if (sortAction) {
      journeys.push(
        this.buildJourneyTestElement(
          "Sort results journey",
          ["sort"],
          context,
          [
            this.buildJourneyAction(sortAction, "Change sort order", [
              this.makeExpectation(
                "navigation_or_state_changed",
                "Changing sort should update the result state"
              ),
              this.makeExpectation(
                "collection_order_changed",
                "Changing sort should change the visible collection ordering"
              ),
              this.makeExpectation(
                "loading_completes",
                "Sort update should complete loading"
              ),
            ]),
          ]
        )
      );
    }

    if (addToCart) {
      journeys.push(
        this.buildJourneyTestElement(
          "Cart persistence journey",
          ["commerce", "reload"],
          context,
          [
            this.buildJourneyAction(addToCart, "Add item to cart", [
              this.makeExpectation(
                "navigation_or_state_changed",
                "Adding an item should change page state before reload"
              ),
            ]),
            this.waitStep(500, "Wait for updated cart state"),
            this.buildReloadStep([
              this.makeExpectation(
                "state_persists_after_reload",
                "Cart state should persist after reload",
                {
                  expectedTextTokens: [
                    "cart",
                    "bag",
                    "basket",
                    "qty",
                    "quantity",
                  ],
                }
              ),
            ]),
          ]
        )
      );
    }

    const backCandidate = items.find(
      item =>
        item.actionKind === "navigate" ||
        this.isMediaOpenItem(item) ||
        this.isAuthEntryItem(item)
    );
    if (backCandidate) {
      journeys.push(
        this.buildJourneyTestElement(
          "Back and forward navigation journey",
          ["navigation", "history"],
          context,
          [
            this.buildJourneyAction(backCandidate, "Navigate to next state", [
              this.makeExpectation(
                "navigation_or_state_changed",
                "Navigation should move to a different state"
              ),
            ]),
            this.waitStep(500, "Wait for next state"),
            this.buildBackStep([
              this.makeExpectation(
                "back_navigation_restores_state",
                "Back navigation should restore the previous state"
              ),
            ]),
            this.waitStep(300, "Wait after back navigation"),
            this.buildForwardStep([
              this.makeExpectation(
                "forward_navigation_reapplies_state",
                "Forward navigation should reapply the later state"
              ),
            ]),
          ]
        )
      );
    }

    return journeys;
  }

  private buildJourneyTestElement(
    title: string,
    surfaceTags: string[],
    context: AnalyzerContext,
    steps: TestStep[]
  ): TestElement {
    return {
      title: `${title} — ${context.currentPath}`,
      type: "e2e",
      sizeClass: context.sizeClass,
      surface_tags: ["e2e", ...surfaceTags],
      priority: 2,
      startingPageStateId: context.currentPageStateId,
      startingPath: context.currentPath,
      steps,
      globalExpectations: this.defaultFlowExpectations(
        `${title} should complete without runtime errors`
      ),
      uid: context.uid,
    };
  }

  private buildJourneyAction(
    item: ActionableItem,
    description: string,
    expectations: Expectation[]
  ): TestStep {
    const signal = this.describeActionableItem(item);
    const action = this.buildSemanticAction(item, description, signal);

    return {
      action,
      expectations,
      description: `${description}: ${signal}`,
      continueOnFailure: false,
    };
  }

  private waitStep(ms: number, description: string): TestStep {
    return {
      action: {
        actionType: PlaywrightAction.WaitForTimeout,
        value: String(ms),
        playwrightCode: `await page.waitForTimeout(${ms})`,
        description,
      },
      expectations: [],
      description,
      continueOnFailure: true,
    };
  }

  private buildReloadStep(expectations: Expectation[]): TestStep {
    return {
      action: {
        actionType: PlaywrightAction.Reload,
        playwrightCode: "await page.reload({ waitUntil: 'networkidle' })",
        description: "Reload page",
      },
      expectations,
      description: "Reload page",
      continueOnFailure: false,
    };
  }

  private buildBackStep(expectations: Expectation[]): TestStep {
    return {
      action: {
        actionType: PlaywrightAction.GoBack,
        playwrightCode: "await page.goBack()",
        description: "Go back",
      },
      expectations,
      description: "Go back",
      continueOnFailure: false,
    };
  }

  private buildForwardStep(expectations: Expectation[]): TestStep {
    return {
      action: {
        actionType: PlaywrightAction.GoForward,
        playwrightCode: "await page.goForward()",
        description: "Go forward",
      },
      expectations,
      description: "Go forward",
      continueOnFailure: false,
    };
  }

  private defaultFlowExpectations(description: string): Expectation[] {
    return [
      {
        expectationType: ExpectationType.PageLoaded,
        severity: ExpectationSeverity.MustPass,
        description,
        playwrightCode: "await page.waitForLoadState('networkidle')",
      },
      {
        expectationType: ExpectationType.NoNetworkErrors,
        severity: ExpectationSeverity.MustPass,
        description: "No network errors during flow",
        playwrightCode: "// checked by TesterExpertise",
      },
      {
        expectationType: ExpectationType.NoConsoleErrors,
        severity: ExpectationSeverity.ShouldPass,
        description: "No console errors during flow",
        playwrightCode: "// checked by TesterExpertise",
      },
    ];
  }

  private formPriority(formType: "login" | "signup" | "other"): number {
    if (formType === "login" || formType === "signup") return 1;
    return 2;
  }

  private isNegativeCandidateField(field: FormField): boolean {
    const analyzerField = field as AnalyzerFormField;
    return (
      field.required &&
      !analyzerField.disabled &&
      !analyzerField.readOnly &&
      !this.looksVisuallyDisabledField(analyzerField) &&
      !this.isCheckboxLike(field) &&
      !this.isSkippableFieldType(field)
    );
  }

  private isPasswordScenario(
    formType: "login" | "signup" | "other",
    form: FormInfo
  ): boolean {
    return (
      formType !== "other" &&
      form.fields.some(field => field.type === "password")
    );
  }

  private isCheckboxLike(field: FormField): boolean {
    return field.type === "checkbox" || field.type === "radio";
  }

  private buildKeyboardAndDisclosureTestElements(
    context: AnalyzerContext
  ): TestElement[] {
    const items = context.actionableItems.filter(
      item => item.visible && !item.disabled && Boolean(item.selector)
    );
    const tests: TestElement[] = [];

    for (const item of items) {
      if (this.isDisclosureItem(item)) {
        tests.push(
          this.buildDisclosureToggleTestElement(
            item,
            context.currentPath,
            context.sizeClass,
            context.uid,
            context.currentPageStateId
          )
        );
        tests.push(
          this.buildKeyboardActivateTestElement(
            item,
            "Enter",
            "Activate disclosure with Enter",
            [
              this.makeExpectation(
                "expanded_state_changed",
                "Enter should toggle the disclosure state",
                {
                  targetPath: item.selector,
                }
              ),
            ],
            context.currentPath,
            context.sizeClass,
            context.uid,
            context.currentPageStateId
          )
        );
        tests.push(
          this.buildKeyboardActivateTestElement(
            item,
            " ",
            "Activate disclosure with Space",
            [
              this.makeExpectation(
                "expanded_state_changed",
                "Space should toggle the disclosure state",
                {
                  targetPath: item.selector,
                }
              ),
            ],
            context.currentPath,
            context.sizeClass,
            context.uid,
            context.currentPageStateId
          )
        );
        continue;
      }

      if (this.isKeyboardPrimaryAction(item)) {
        tests.push(
          this.buildKeyboardActivateTestElement(
            item,
            "Enter",
            "Activate with Enter",
            [
              this.makeExpectation(
                "navigation_or_state_changed",
                "Enter key activation should change the page or control state"
              ),
            ],
            context.currentPath,
            context.sizeClass,
            context.uid,
            context.currentPageStateId
          )
        );
      }

      if (this.isKeyboardToggleAction(item)) {
        tests.push(
          this.buildKeyboardActivateTestElement(
            item,
            " ",
            "Toggle with Space",
            [
              this.makeExpectation(
                ExpectationType.ElementChecked,
                "Space key activation should toggle the control state",
                {
                  targetPath: item.selector,
                }
              ),
            ],
            context.currentPath,
            context.sizeClass,
            context.uid,
            context.currentPageStateId
          )
        );
      }
    }

    return tests;
  }

  private buildDisclosureToggleTestElement(
    item: ActionableItem,
    startingPath: string,
    sizeClass: SizeClass,
    uid?: string,
    startingPageStateId?: number
  ): TestElement {
    const label = this.describeActionableItem(item);
    return {
      title: `Toggle disclosure ${label}`,
      type: "interaction",
      sizeClass,
      surface_tags: ["disclosure", "click"],
      priority: 3,
      startingPageStateId,
      startingPath,
      steps: [
        {
          action: {
            actionType: PlaywrightAction.Click,
            path: item.selector,
            playwrightCode: `await page.click('${item.selector}')`,
            description: `Toggle disclosure ${label}`,
          },
          expectations: [
            this.makeExpectation(
              "expanded_state_changed",
              "Clicking the disclosure should toggle its expanded state",
              {
                targetPath: item.selector,
              }
            ),
          ],
          description: `Toggle disclosure ${label}`,
          continueOnFailure: false,
        },
      ],
      globalExpectations: this.defaultFlowExpectations(
        "Disclosure interaction should complete without runtime errors"
      ),
      uid,
    };
  }

  private buildKeyboardActivateTestElement(
    item: ActionableItem,
    key: string,
    titlePrefix: string,
    expectations: Expectation[],
    startingPath: string,
    sizeClass: SizeClass,
    uid?: string,
    startingPageStateId?: number
  ): TestElement {
    const label = this.describeActionableItem(item);
    return {
      title: `${titlePrefix} ${label}`,
      type: "interaction",
      sizeClass,
      surface_tags: [
        "keyboard",
        key.trim() === "" ? "space" : key.toLowerCase(),
      ],
      priority: 3,
      startingPageStateId,
      startingPath,
      steps: [
        {
          action: {
            actionType: PlaywrightAction.Focus,
            path: item.selector,
            playwrightCode: `await page.locator('${item.selector}').focus()`,
            description: `Focus ${label}`,
          },
          expectations: [],
          description: `Focus ${label}`,
          continueOnFailure: false,
        },
        {
          action: {
            actionType: PlaywrightAction.Press,
            value: key,
            playwrightCode: `await page.keyboard.press('${key === " " ? "Space" : key}')`,
            description: `${titlePrefix} ${label}`,
          },
          expectations,
          description: `${titlePrefix} ${label}`,
          continueOnFailure: false,
        },
      ],
      globalExpectations: this.defaultFlowExpectations(
        "Keyboard activation should complete without runtime errors"
      ),
      uid,
    };
  }

  private buildDialogCloseTestElement(
    item: ActionableItem,
    startingPath: string,
    sizeClass: SizeClass,
    uid?: string,
    startingPageStateId?: number
  ): TestElement {
    const label = this.describeActionableItem(item);
    return {
      title: `Close dialog via ${label}`,
      type: "interaction",
      sizeClass,
      surface_tags: ["dialog", "close"],
      priority: 2,
      startingPageStateId,
      startingPath,
      steps: [
        {
          action: {
            actionType: PlaywrightAction.Click,
            path: item.selector,
            playwrightCode: `await page.click('${item.selector}')`,
            description: `Close dialog via ${label}`,
          },
          expectations: [
            this.makeExpectation(
              "dialog_closed",
              "Close action should dismiss the open dialog"
            ),
            this.makeExpectation(
              "focus_returned",
              "Focus should return after the dialog closes"
            ),
          ],
          description: `Close dialog via ${label}`,
          continueOnFailure: false,
        },
      ],
      globalExpectations: this.defaultFlowExpectations(
        "Dialog should close cleanly"
      ),
      uid,
    };
  }

  private buildEscapeDialogTestElement(
    startingPath: string,
    sizeClass: SizeClass,
    uid?: string,
    startingPageStateId?: number
  ): TestElement {
    return {
      title: "Close dialog with Escape",
      type: "interaction",
      sizeClass,
      surface_tags: ["dialog", "escape"],
      priority: 2,
      startingPageStateId,
      startingPath,
      steps: [
        {
          action: {
            actionType: PlaywrightAction.Press,
            value: "Escape",
            playwrightCode: "await page.keyboard.press('Escape')",
            description: "Press Escape",
          },
          expectations: [
            this.makeExpectation(
              "dialog_closed",
              "Escape should dismiss the open dialog"
            ),
            this.makeExpectation(
              "focus_returned",
              "Focus should return after Escape closes the dialog"
            ),
          ],
          description: "Press Escape",
          continueOnFailure: false,
        },
      ],
      globalExpectations: this.defaultFlowExpectations(
        "Dialog should close on Escape without runtime errors"
      ),
      uid,
    };
  }

  private shouldUseDirectControlInteraction(item: ActionableItem): boolean {
    const role = (item.role ?? "").toLowerCase();
    const inputType = (item.inputType ?? "").toLowerCase();
    return (
      this.looksVisuallyDisabledButEnabled(item) ||
      item.actionKind === "fill" ||
      item.actionKind === "select" ||
      item.actionKind === "radio_select" ||
      role === "tab" ||
      role === "radio" ||
      role === "checkbox" ||
      role === "switch" ||
      inputType === "radio" ||
      inputType === "checkbox"
    );
  }

  private buildControlInteractionTestElement(
    item: ActionableItem,
    startingPath: string,
    sizeClass: SizeClass,
    uid?: string,
    startingPageStateId?: number
  ): TestElement {
    const label = item.accessibleName || item.textContent || item.selector;
    const role = (item.role ?? "").toLowerCase();
    const inputType = (item.inputType ?? "").toLowerCase();
    const isTab = role === "tab";
    const isFillControl = item.actionKind === "fill";
    const isSelectControl = item.actionKind === "select";
    const isRadioControl =
      item.actionKind === "radio_select" ||
      role === "radio" ||
      inputType === "radio";
    const isCheckboxControl =
      role === "checkbox" || role === "switch" || inputType === "checkbox";
    const expectsChecked = isRadioControl || isCheckboxControl || isTab;
    const expectsInputValue = isFillControl || isSelectControl;
    const plannedValue = isSelectControl
      ? this.extractSelectableValue(item)
      : isFillControl
        ? fillValuePlanner.planValue(item)
        : undefined;
    const isImmutable = this.looksVisuallyDisabledButEnabled(item);

    let actionType: PlaywrightAction = PlaywrightAction.Click;
    let actionValue: string | undefined;
    let playwrightCode = `await page.click('${item.selector}')`;
    let description = `${isTab ? "Select" : "Activate"} ${label}`;

    if (isFillControl) {
      actionType = PlaywrightAction.Type;
      actionValue = plannedValue;
      playwrightCode = `await page.locator('${item.selector}').type('${this.escapeSingleQuotes(plannedValue ?? "")}')`;
      description = `Type into ${label}`;
    } else if (isSelectControl) {
      actionType = PlaywrightAction.SelectOption;
      actionValue = plannedValue;
      playwrightCode = `await page.locator('${item.selector}').selectOption('${this.escapeSingleQuotes(plannedValue ?? "")}')`;
      description = `Select ${label}`;
    } else if (isRadioControl) {
      actionType = PlaywrightAction.Click;
      playwrightCode = `await page.click('${item.selector}')`;
      description = `Select ${label}`;
    }

    const expectations = isImmutable
      ? this.buildImmutableControlExpectations(item, label)
      : expectsInputValue
        ? [
            this.makeExpectation(
              ExpectationType.InputValue,
              `${description} should update the control value`,
              {
                targetPath: item.selector,
                expectedValue: plannedValue,
              }
            ),
          ]
        : expectsChecked
          ? [
              this.makeExpectation(
                ExpectationType.ElementChecked,
                `${label} should react to user input`,
                {
                  targetPath: item.selector,
                }
              ),
            ]
          : [];

    return {
      title: isImmutable ? `Visually Disabled ${description}` : description,
      type: "interaction",
      sizeClass,
      surface_tags: [
        "interaction",
        isImmutable ? "visually-disabled" : "enabled",
        role || inputType || item.actionKind || "control",
      ],
      priority: 3,
      startingPageStateId,
      startingPath,
      steps: [
        {
          action: {
            actionType,
            path: item.selector ?? undefined,
            value: actionValue,
            playwrightCode,
            description,
          },
          expectations,
          description,
          continueOnFailure: isImmutable,
        },
      ],
      globalExpectations: this.defaultFlowExpectations(
        isImmutable
          ? `${label} should remain non-interactive despite appearing disabled`
          : `${label} should react without runtime errors`
      ),
      uid,
    };
  }

  private buildImmutableControlExpectations(
    item: ActionableItem,
    label: string
  ): Expectation[] {
    const role = (item.role ?? "").toLowerCase();
    const inputType = (item.inputType ?? "").toLowerCase();

    if (item.actionKind === "fill" || item.actionKind === "select") {
      return [
        this.makeExpectation(
          ExpectationType.InputValue,
          `${label} should not respond to user input while it appears disabled`,
          {
            targetPath: item.selector,
            expectNoChange: true,
          }
        ),
      ];
    }

    if (
      role === "tab" ||
      role === "radio" ||
      role === "checkbox" ||
      role === "switch" ||
      inputType === "radio" ||
      inputType === "checkbox" ||
      item.actionKind === "radio_select"
    ) {
      return [
        this.makeExpectation(
          ExpectationType.ElementChecked,
          `${label} should not change state while it appears disabled`,
          {
            targetPath: item.selector,
            expectNoChange: true,
          }
        ),
      ];
    }

    return [
      this.makeExpectation(
        ExpectationType.UrlUnchanged,
        `${label} should not trigger navigation while it appears disabled`,
        {
          expectNoChange: true,
        }
      ),
    ];
  }

  private extractSelectableValue(item: ActionableItem): string | undefined {
    const rawOptions = item.attributes?.options;
    const parsedOptions = Array.isArray(rawOptions)
      ? rawOptions
      : typeof rawOptions === "string"
        ? this.parseSelectOptions(rawOptions)
        : [];

    return parsedOptions.find(
      (value): value is string =>
        typeof value === "string" && value.trim().length > 0
    );
  }

  private parseSelectOptions(rawOptions: string): string[] {
    try {
      const parsed = JSON.parse(rawOptions);
      return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
    } catch {
      return rawOptions
        .split(",")
        .map(value => value.trim())
        .filter(Boolean);
    }
  }

  private looksVisuallyDisabledButEnabled(item: ActionableItem): boolean {
    if (item.disabled) return false;

    const attrs = Object.entries(item.attributes ?? {})
      .map(([key, value]) => `${key}=${String(value)}`)
      .join(" ")
      .toLowerCase();

    return this.hasDisabledAppearanceSignal(attrs);
  }

  private looksVisuallyDisabledField(field: AnalyzerFormField): boolean {
    if (field.disabled) return false;
    return this.hasDisabledAppearanceSignal(
      (field.appearanceHint ?? "").toLowerCase()
    );
  }

  private hasDisabledAppearanceSignal(value: string): boolean {
    if (!value) return false;

    return (
      value.includes("aria-disabled=true") ||
      value.includes("cursor-not-allowed") ||
      value.includes("pointer-events:none") ||
      value.includes("pointer-events: none") ||
      value.includes("opacity-50") ||
      value.includes("opacity:0.5") ||
      value.includes("opacity: 0.5") ||
      value.includes("opacity-40") ||
      value.includes("disabled")
    );
  }

  private describeActionableItem(item: ActionableItem): string {
    return (
      item.accessibleName ||
      item.textContent ||
      String(item.attributes?.labelText ?? "") ||
      String(item.attributes?.placeholder ?? "") ||
      item.selector
    );
  }

  private semanticText(item: ActionableItem): string {
    return [
      item.accessibleName || "",
      item.textContent || "",
      String(item.attributes?.labelText ?? ""),
      String(item.attributes?.placeholder ?? ""),
      String(item.attributes?.name ?? ""),
      String(item.attributes?.id ?? ""),
      item.href || "",
      item.selector,
    ]
      .join(" ")
      .toLowerCase();
  }

  private isAddToCartItem(item: ActionableItem): boolean {
    return /\b(add to cart|add to bag|buy now|add item)\b/.test(
      this.semanticText(item)
    );
  }

  private isCheckoutItem(item: ActionableItem): boolean {
    return /\b(checkout|proceed to checkout|submit order|place order)\b/.test(
      this.semanticText(item)
    );
  }

  private isRemoveItemAction(item: ActionableItem): boolean {
    return /\b(remove|delete|trash|clear item|remove item)\b/.test(
      this.semanticText(item)
    );
  }

  private isAuthEntryItem(item: ActionableItem): boolean {
    return /\b(sign up|register|create account|sign in|log in|login)\b/.test(
      this.semanticText(item)
    );
  }

  private isMediaOpenItem(item: ActionableItem): boolean {
    const text = this.semanticText(item);
    return (
      item.tagName === "VIDEO" ||
      item.tagName === "AUDIO" ||
      /\b(image|photo|gallery|video|play|watch|zoom|preview)\b/.test(text)
    );
  }

  private isVideoLikeItem(item: ActionableItem): boolean {
    return (
      item.tagName === "VIDEO" ||
      /\b(video|play|watch)\b/.test(this.semanticText(item))
    );
  }

  private isQuantityAction(item: ActionableItem): boolean {
    return /\b(qty|quantity|increase|decrease|increment|decrement|plus|minus)\b/.test(
      this.semanticText(item)
    );
  }

  private isFilterAction(item: ActionableItem): boolean {
    return /\b(filter|refine|apply filter|show results|category|brand|size|color|price)\b/.test(
      this.semanticText(item)
    );
  }

  private isSortAction(item: ActionableItem): boolean {
    return /\b(sort|order by|best selling|price low|price high|newest|featured)\b/.test(
      this.semanticText(item)
    );
  }

  private isDialogCloseItem(item: ActionableItem): boolean {
    return /\b(close|dismiss|cancel|done|x)\b/.test(this.semanticText(item));
  }

  private pageHasOpenDialog(html: string): boolean {
    return (
      /role=["']dialog["']/i.test(html) ||
      /role=["']alertdialog["']/i.test(html) ||
      /aria-modal=["']true["']/i.test(html) ||
      /\bmodal\b/i.test(html) ||
      /\boverlay\b/i.test(html)
    );
  }

  private isDisclosureItem(item: ActionableItem): boolean {
    const expanded = String(
      item.attributes?.["aria-expanded"] ?? ""
    ).toLowerCase();
    return expanded === "true" || expanded === "false";
  }

  private isKeyboardPrimaryAction(item: ActionableItem): boolean {
    const role = (item.role ?? "").toLowerCase();
    return (
      item.actionKind === "navigate" ||
      role === "button" ||
      role === "link" ||
      role === "menuitem" ||
      item.tagName === "BUTTON" ||
      item.tagName === "A"
    );
  }

  private isKeyboardToggleAction(item: ActionableItem): boolean {
    const role = (item.role ?? "").toLowerCase();
    const inputType = (item.inputType ?? "").toLowerCase();
    return (
      role === "checkbox" ||
      role === "switch" ||
      role === "radio" ||
      inputType === "checkbox" ||
      inputType === "radio"
    );
  }

  private buildSemanticAction(
    item: ActionableItem,
    description: string,
    signal: string
  ): TestStep["action"] {
    if (item.actionKind === "select") {
      const value = this.extractSelectableValue(item);
      return {
        actionType: PlaywrightAction.SelectOption,
        path: item.selector,
        value,
        playwrightCode: `await page.locator('${item.selector}').selectOption('${this.escapeSingleQuotes(value ?? "")}')`,
        description: `${description}: ${signal}`,
      };
    }

    if (item.actionKind === "fill") {
      const value = this.isQuantityAction(item)
        ? "2"
        : fillValuePlanner.planValue(item);
      return {
        actionType: PlaywrightAction.Type,
        path: item.selector,
        value,
        playwrightCode: `await page.locator('${item.selector}').type('${this.escapeSingleQuotes(value)}')`,
        description: `${description}: ${signal}`,
      };
    }

    return {
      actionType: PlaywrightAction.Click,
      path: item.selector,
      playwrightCode: `await page.click('${item.selector}')`,
      description: `${description}: ${signal}`,
    };
  }

  private makeExpectation(
    expectationType: string,
    description: string,
    extras?: Record<string, unknown>
  ): Expectation {
    return {
      expectationType,
      severity: ExpectationSeverity.ShouldPass,
      description,
      playwrightCode: "// evaluated by TesterExpertise",
      ...(extras ?? {}),
    } as Expectation;
  }

  private isSelectLike(field: FormField): boolean {
    return field.type === "select" || field.type === "select-one";
  }

  private isSkippableFieldType(field: FormField): boolean {
    return ["hidden", "submit", "button", "image", "file"].includes(field.type);
  }

  private fieldLabel(field: FormField): string {
    return field.label || field.name || field.selector;
  }

  private improbableSearchQuery(): string {
    return "zzzz-no-results-testomniac";
  }

  private slugify(value: string): string {
    return (
      value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "page"
    );
  }

  private escapeSingleQuotes(value: string): string {
    return value.replace(/'/g, "\\'");
  }

  private extractVisibleText(html: string): string {
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  private detectPasswordRequirements(
    visibleText: string
  ): PasswordRequirementSnapshot {
    const lower = visibleText.toLowerCase();
    const requirements: PasswordRequirementSnapshot = {
      requiresUppercase: false,
      requiresLowercase: false,
      requiresNumber: false,
      requiresSpecial: false,
      noSpaces: false,
    };

    const lengthMatch =
      lower.match(/(?:at least|minimum|min\.?)\s*(\d+)\s*character/i) ||
      lower.match(/(\d+)\+?\s*character/i);
    if (lengthMatch) {
      requirements.minLength = Number.parseInt(lengthMatch[1], 10);
    }

    if (/uppercase|capital letter/i.test(lower))
      requirements.requiresUppercase = true;
    if (/lowercase/i.test(lower)) requirements.requiresLowercase = true;
    if (
      /number|digit|\d/i.test(lower) &&
      /must|require|contain|include/i.test(lower)
    ) {
      requirements.requiresNumber = true;
    }
    if (
      /special character|symbol|[!@#$%^&*]/i.test(lower) &&
      /must|require|contain|include/i.test(lower)
    ) {
      requirements.requiresSpecial = true;
    }
    if (/no\s*spaces/i.test(lower)) requirements.noSpaces = true;

    return requirements;
  }

  private generatePasswordVariants(
    requirements: PasswordRequirementSnapshot
  ): Array<{
    password: string;
    description: string;
    shouldFail: boolean;
  }> {
    const variants: Array<{
      password: string;
      description: string;
      shouldFail: boolean;
    }> = [];
    const minimumLength = Math.max(requirements.minLength ?? 8, 8);

    let validPassword = "Aa1!";
    while (validPassword.length < minimumLength) {
      validPassword += "xY2@".charAt(validPassword.length % 4);
    }

    if (requirements.minLength) {
      variants.push({
        password: validPassword.slice(
          0,
          Math.max(requirements.minLength - 1, 1)
        ),
        description: "too short password",
        shouldFail: true,
      });
    }
    if (requirements.requiresUppercase) {
      variants.push({
        password: validPassword.toLowerCase(),
        description: "missing uppercase password",
        shouldFail: true,
      });
    }
    if (requirements.requiresLowercase) {
      variants.push({
        password: validPassword.toUpperCase(),
        description: "missing lowercase password",
        shouldFail: true,
      });
    }
    if (requirements.requiresNumber) {
      variants.push({
        password: validPassword.replace(/\d/g, "a"),
        description: "missing number password",
        shouldFail: true,
      });
    }
    if (requirements.requiresSpecial) {
      variants.push({
        password: validPassword.replace(/[^a-zA-Z0-9]/g, "a"),
        description: "missing special character password",
        shouldFail: true,
      });
    }
    if (requirements.noSpaces) {
      variants.push({
        password: `${validPassword.slice(0, 4)} ${validPassword.slice(4)}`,
        description: "password with spaces",
        shouldFail: true,
      });
    }

    variants.push({
      password: validPassword,
      description: "valid password",
      shouldFail: false,
    });

    return variants;
  }
}

interface PasswordRequirementSnapshot {
  minLength?: number;
  requiresUppercase: boolean;
  requiresLowercase: boolean;
  requiresNumber: boolean;
  requiresSpecial: boolean;
  noSpaces: boolean;
}
