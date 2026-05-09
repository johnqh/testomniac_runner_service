import type {
  TestElement,
  LegacyTestElement,
  LegacyTestAction,
  TestStep,
  Expectation,
  SizeClass,
} from "../domain/types";
import {
  PlaywrightAction,
  ExpectationType,
  ExpectationSeverity,
} from "../domain/types";
import { assignSurfaceTags } from "./surface-tagger";

export interface GeneratedTestElement {
  testElement: TestElement;
}

/** @deprecated Use GeneratedTestElement instead */
export interface LegacyGeneratedTestElement {
  testElement: LegacyTestElement;
  actions: LegacyTestAction[];
}

export interface RenderElement {
  elementIdentityId: number;
  playwrightLocator: string;
  playwrightScopeChain?: string;
  computedName: string;
  role: string;
  visible: boolean;
}

interface RenderInput {
  pageId: number;
  pageStateId: number;
  pageName: string;
  url: string;
  sizeClass: SizeClass;
  priority: number;
  elements: RenderElement[];
}

export function generateRenderTest(input: RenderInput): GeneratedTestElement {
  const steps: TestStep[] = [];

  // Step 1: Navigate
  steps.push({
    action: {
      actionType: PlaywrightAction.Goto,
      pageStateId: input.pageStateId,
      path: input.url,
      playwrightCode: `await page.goto('${input.url}');`,
      description: `Navigate to ${input.url}`,
    },
    expectations: [
      {
        expectationType: ExpectationType.PageLoaded,
        severity: ExpectationSeverity.MustPass,
        description: "Page loaded successfully",
        playwrightCode: "await page.waitForLoadState('networkidle');",
      },
    ],
    description: `Navigate to ${input.pageName}`,
    continueOnFailure: false,
  });

  // Step 2: Verify visible elements
  const visibleElements = input.elements.filter(e => e.visible).slice(0, 10);
  if (visibleElements.length > 0) {
    const expectations: Expectation[] = visibleElements.map(el => {
      const locatorExpr = el.playwrightScopeChain
        ? `page.${el.playwrightScopeChain}.${el.playwrightLocator}`
        : `page.${el.playwrightLocator}`;
      return {
        expectationType: ExpectationType.ElementVisible,
        elementIdentityId: el.elementIdentityId,
        severity: ExpectationSeverity.ShouldPass,
        description: `'${el.computedName}' ${el.role} is visible`,
        playwrightCode: `await expect(${locatorExpr}).toBeVisible();`,
      };
    });

    steps.push({
      action: {
        actionType: PlaywrightAction.WaitForLoadState,
        pageStateId: input.pageStateId,
        playwrightCode: "await page.waitForLoadState('networkidle');",
        description: "Wait for page to settle",
      },
      expectations,
      description: "Verify page elements are visible",
      continueOnFailure: true,
    });
  }

  // Step 3: Screenshot
  const label = `render-${input.pageName.toLowerCase().replace(/\s+/g, "-")}`;
  steps.push({
    action: {
      actionType: PlaywrightAction.Screenshot,
      pageStateId: input.pageStateId,
      value: label,
      playwrightCode: `await page.screenshot({ path: '${label}.png', fullPage: true });`,
      description: `Take screenshot '${label}'`,
    },
    expectations: [],
    description: `Capture screenshot`,
    continueOnFailure: true,
  });

  return {
    testElement: {
      title: `Render — ${input.pageName}`,
      type: "render",
      sizeClass: input.sizeClass,
      surface_tags: assignSurfaceTags("render", input.priority),
      page_id: input.pageId,
      priority: input.priority,
      startingPageStateId: input.pageStateId,
      startingPath: input.url,
      steps,
      globalExpectations: [
        {
          expectationType: ExpectationType.NoConsoleErrors,
          severity: ExpectationSeverity.ShouldPass,
          description: "No console errors",
          playwrightCode: "expect(consoleErrors).toHaveLength(0);",
        },
        {
          expectationType: ExpectationType.NoNetworkErrors,
          severity: ExpectationSeverity.ShouldPass,
          description: "No network errors",
          playwrightCode: "expect(networkErrors).toHaveLength(0);",
        },
      ],
    },
  };
}
