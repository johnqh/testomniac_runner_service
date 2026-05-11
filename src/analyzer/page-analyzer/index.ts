import type {
  TestElement,
  Expectation,
  ActionableItem,
  SizeClass,
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
import { computeHashes } from "../../browser/page-utils";
import type { ApiClient } from "../../api/client";
import type { DetectedScaffoldRegion } from "../../scanner/component-detector";
import { createHash } from "node:crypto";
import { fillValuePlanner } from "../../planners/fill-value-planner";
import { AUTH_URL_PATTERNS, SIGNUP_URL_PATTERNS } from "../../config/constants";
import type { AnalyzerContext } from "./types";
import { generateHoverFollowUpCases } from "./generators/hover-follow-up";
import { generateNavigationTestElements } from "./generators/navigation";
import { generateScaffoldTestElements } from "./generators/scaffolds";
import { generateRenderTestElements } from "./generators/render";
import { generateFormTestElements } from "./generators/forms";
import { generateE2ETestElements } from "./generators/e2e";
import { generateSemanticJourneyTestElements } from "./generators/semantic-journeys";
import { generateDialogLifecycleTestElements } from "./generators/dialogs";
import { generateKeyboardAndDisclosureTestElements } from "./generators/keyboard-disclosure";
import { generateVariantTestElements } from "./generators/variants";
import { generateContentTestElements } from "./generators/content";

export type { AnalyzerContext } from "./types";

type AnalyzerFormField = FormField & {
  disabled?: boolean;
  readOnly?: boolean;
  appearanceHint?: string;
};

type GeneratedTestElement = TestElement & {
  generatedKey?: string;
};

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
    const steps = Array.isArray(testElement.steps) ? testElement.steps : [];
    const expectations: Expectation[] = [
      {
        expectationType: ExpectationType.PageLoaded,
        severity: ExpectationSeverity.MustPass,
        description: "Page should load with valid HTML",
        playwrightCode: "await expect(page).not.toHaveTitle(/error/i)",
      },
      {
        expectationType: ExpectationType.NoNetworkErrors,
        severity: ExpectationSeverity.ShouldPass,
        description: "No network errors during page load or interaction",
        playwrightCode: "// checked by TesterExpertise",
      },
    ];

    // If test element has only a navigation action, no more expectations
    const isNavigationOnly =
      steps.length === 1 &&
      steps[0]?.action?.actionType === PlaywrightAction.Goto;

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
    const normalizedContext = this.normalizeContext(context);
    const currentPageStateId =
      await this.ensureTargetPageState(normalizedContext);
    const resolvedContext: AnalyzerContext = {
      ...normalizedContext,
      currentPageStateId,
    };

    if (this.isHoverOnly(testElement)) {
      await generateHoverFollowUpCases(this, testElement, resolvedContext);
      return;
    }

    await generateNavigationTestElements(this, resolvedContext);
    await generateRenderTestElements(this, resolvedContext);
    await generateFormTestElements(this, resolvedContext);
    await generateSemanticJourneyTestElements(this, resolvedContext);
    await generateE2ETestElements(this, resolvedContext);
    await generateDialogLifecycleTestElements(this, resolvedContext);
    await generateScaffoldTestElements(this, resolvedContext);
    await generateContentTestElements(this, resolvedContext);
    await generateKeyboardAndDisclosureTestElements(this, resolvedContext);
    await generateVariantTestElements(this, resolvedContext);
  }

  async reconcileGeneratedSurfaceElements(
    context: AnalyzerContext,
    params: {
      surfaceId?: number | null;
      surfaceTitle: string;
      desiredKeys: string[];
      dependencyTestElementId?: number;
    }
  ): Promise<void> {
    const surface =
      params.surfaceId != null
        ? { id: params.surfaceId, title: params.surfaceTitle }
        : await this.findExistingSurfaceByTitle(context, params.surfaceTitle);
    if (!surface) return;

    const existing = await context.api.getTestElementsByTestSurface(
      surface.id,
      true
    );
    const desiredKeys = new Set(
      params.desiredKeys.map(key => key.trim()).filter(Boolean)
    );
    const obsoleteIds = existing
      .filter(testElement => {
        const isGenerated = Boolean((testElement as any).isGenerated);
        const isActive = (testElement as any).isActive !== false;
        if (!isGenerated || !isActive) return false;
        if (testElement.startingPageStateId !== context.currentPageStateId)
          return false;
        if (
          (testElement.dependencyTestElementId ?? null) !==
          (params.dependencyTestElementId ?? null)
        ) {
          return false;
        }
        const existingKey = this.getPersistedGeneratedKey(testElement);
        return !existingKey || !desiredKeys.has(existingKey);
      })
      .map(testElement => testElement.id);

    if (obsoleteIds.length === 0) return;
    await context.api.retireTestElements(obsoleteIds);
  }

  private async findExistingSurfaceByTitle(
    context: AnalyzerContext,
    title: string
  ): Promise<{ id: number; title: string } | null> {
    const surfaces = await context.api.getTestSurfacesByRunner(
      context.runnerId
    );
    const surface = surfaces.find(candidate => candidate.title === title);
    return surface ? { id: surface.id, title: surface.title } : null;
  }

  private getScaffoldSurfaceItems(
    context: AnalyzerContext,
    scaffold: DetectedScaffoldRegion
  ): ActionableItem[] {
    return this.normalizeActionableItems(context.actionableItems).filter(
      item => {
        if (!this.isSurfaceCandidate(item) || !item.selector) return false;

        return (
          context.scaffoldSelectorByItemSelector[item.selector] ===
          scaffold.selector
        );
      }
    );
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
  ): GeneratedTestElement {
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
      generatedKey: this.buildGeneratedKey(
        "navigation",
        startingPageStateId,
        path
      ),
    };
  }

  private buildHoverTestElement(
    item: ActionableItem,
    startingPath: string,
    sizeClass: SizeClass,
    uid?: string,
    startingPageStateId?: number,
    dependencyTestElementId?: number
  ): GeneratedTestElement {
    const label = this.describeActionableItem(item);
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
      generatedKey: this.buildGeneratedKey(
        "hover",
        startingPageStateId,
        dependencyTestElementId,
        item.stableKey ?? item.selector ?? label
      ),
    };
  }

  private buildClickTestElement(
    item: ActionableItem,
    startingPath: string,
    sizeClass: SizeClass,
    uid?: string,
    startingPageStateId?: number,
    dependencyTestElementId?: number
  ): GeneratedTestElement {
    const label = this.describeActionableItem(item);
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
      generatedKey: this.buildGeneratedKey(
        "click",
        startingPageStateId,
        dependencyTestElementId,
        item.stableKey ?? item.selector ?? label
      ),
    };
  }

  private isHoverOnly(testElement: TestElement): boolean {
    const steps = Array.isArray(testElement.steps) ? testElement.steps : [];
    return (
      steps.length === 1 &&
      steps[0]?.action?.actionType === PlaywrightAction.Hover
    );
  }

  private getPrimarySelector(testElement: TestElement): string | null {
    const steps = Array.isArray(testElement.steps) ? testElement.steps : [];
    const step = steps[0];
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

  withGeneratedKey(
    testElement: GeneratedTestElement,
    ...parts: Array<string | number | null | undefined>
  ): GeneratedTestElement {
    return {
      ...testElement,
      generatedKey: this.buildGeneratedKey(...parts),
    };
  }

  getGeneratedKey(
    testElement: Pick<GeneratedTestElement, "generatedKey" | "title">
  ): string {
    return (testElement.generatedKey?.trim() || testElement.title).trim();
  }

  private getPersistedGeneratedKey(
    testElement: Pick<TestElement, "title"> & {
      generatedKey?: string | null;
    }
  ): string | null {
    const generatedKey = testElement.generatedKey?.trim();
    if (generatedKey) return generatedKey;
    const title = testElement.title?.trim();
    return title || null;
  }

  private buildGeneratedKey(
    ...parts: Array<string | number | null | undefined>
  ): string {
    const normalized = parts
      .map(part => (part == null ? "" : String(part).trim()))
      .filter(Boolean);
    const raw = normalized.join("||");
    const digest = createHash("sha1").update(raw).digest("hex").slice(0, 16);
    const prefix = normalized
      .slice(0, 3)
      .map(part =>
        part
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "")
      )
      .filter(Boolean)
      .join(":")
      .slice(0, 80);
    return prefix ? `${prefix}:${digest}` : digest;
  }

  private buildStepSignature(steps: TestStep[]): string {
    return steps
      .map(step =>
        [
          step.action?.actionType ?? "",
          step.action?.path ?? "",
          step.action?.value ?? "",
          step.action?.description ?? "",
        ].join("|")
      )
      .join("||");
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
    const forms = this.normalizeForms(context.forms);
    if (forms.length === 0) return;

    const existing = await context.api.getFormsByPageState(pageStateId);
    const existingSelectors = new Set(existing.map(form => form.selector));

    for (const form of forms) {
      if (existingSelectors.has(form.selector)) continue;
      await context.api.insertForm(
        pageStateId,
        form,
        this.identifyFormType(form, context.currentPath)
      );
    }
  }

  private normalizeContext(context: AnalyzerContext): AnalyzerContext {
    return {
      ...context,
      html: typeof context.html === "string" ? context.html : "",
      scaffolds: Array.isArray(context.scaffolds) ? context.scaffolds : [],
      scaffoldSelectorByItemSelector:
        context.scaffoldSelectorByItemSelector &&
        typeof context.scaffoldSelectorByItemSelector === "object"
          ? context.scaffoldSelectorByItemSelector
          : {},
      actionableItems: this.normalizeActionableItems(context.actionableItems),
      forms: this.normalizeForms(context.forms),
      journeySteps: Array.isArray(context.journeySteps)
        ? context.journeySteps
        : [],
    };
  }

  private normalizeActionableItems(
    items: AnalyzerContext["actionableItems"]
  ): ActionableItem[] {
    return Array.isArray(items) ? items : [];
  }

  private normalizeForms(forms: AnalyzerContext["forms"]): FormInfo[] {
    return Array.isArray(forms) ? forms : [];
  }

  private buildRenderTestElement(
    currentPath: string,
    sizeClass: SizeClass,
    uid: string | undefined,
    startingPageStateId: number,
    pageId: number
  ): GeneratedTestElement {
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
      generatedKey: this.buildGeneratedKey(
        "render",
        startingPageStateId,
        pageId,
        currentPath
      ),
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
  ): GeneratedTestElement {
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
        ...(formType === "login" || formType === "signup"
          ? [
              this.makeExpectation(
                ExpectationType.NavigationOrStateChanged,
                `${formLabel} should advance authentication state after a successful submit`,
                {
                  severity: ExpectationSeverity.ShouldPass,
                }
              ),
              this.makeExpectation(
                ExpectationType.ErrorStateCleared,
                `${formLabel} should not leave a visible error state after a successful authentication submit`,
                {
                  severity: ExpectationSeverity.ShouldPass,
                }
              ),
            ]
          : []),
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
          ExpectationType.NoDuplicateMutationRequests,
          `Submitting ${formLabel} should not trigger duplicate mutation requests`
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
          "feedback_not_duplicated",
          `Submitting ${formLabel} should not show duplicate feedback messages`
        ),
        this.makeExpectation(
          "field_error_clears_after_fix",
          `Validation errors on ${formLabel} should clear once the fields are corrected`
        ),
      ],
      uid,
      generatedKey: this.buildGeneratedKey(
        "form-positive",
        startingPageStateId,
        form.selector,
        formType
      ),
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
  ): GeneratedTestElement {
    const steps = this.buildFormSteps(
      form,
      validValues,
      omittedField.selector,
      this.buildValuePreservationExpectations(
        form,
        validValues,
        omittedField.selector
      )
    );
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
          ExpectationType.ErrorStateVisible,
          `Omitting ${this.fieldLabel(omittedField)} should surface an error state`
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
      generatedKey: this.buildGeneratedKey(
        "form-negative",
        startingPageStateId,
        form.selector,
        formType,
        omittedField.selector
      ),
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
  ): GeneratedTestElement {
    const steps = this.buildFormSteps(
      form,
      validValues,
      correctedField.selector,
      this.buildValuePreservationExpectations(
        form,
        validValues,
        correctedField.selector
      )
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
          ExpectationType.ErrorStateCleared,
          `Error state for ${formLabel} should clear after correcting ${this.fieldLabel(correctedField)}`
        ),
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
          ExpectationType.NoDuplicateMutationRequests,
          `Submitting ${formLabel} after correction should not trigger duplicate mutation requests`
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
        this.makeExpectation(
          "feedback_not_duplicated",
          `Form ${formLabel} should not show duplicate feedback after correction`
        ),
      ],
      uid,
      generatedKey: this.buildGeneratedKey(
        "form-correction",
        startingPageStateId,
        form.selector,
        formType,
        correctedField.selector
      ),
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
  ): GeneratedTestElement[] {
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
        generatedKey: this.buildGeneratedKey(
          "password",
          startingPageStateId,
          form.selector,
          formType,
          variant.description,
          variant.password
        ),
      };
    });
  }

  private buildE2ETestElement(
    currentPath: string,
    sizeClass: SizeClass,
    uid: string | undefined,
    startingPageStateId: number,
    journeySteps: TestStep[]
  ): GeneratedTestElement {
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
      generatedKey: this.buildGeneratedKey(
        "dependency-journey",
        startingPageStateId,
        currentPath,
        this.buildStepSignature(journeySteps)
      ),
    };
  }

  private buildFormSteps(
    form: FormInfo,
    valuesBySelector: Record<string, string>,
    omittedSelector?: string,
    postSubmitExpectations: Expectation[] = []
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

    steps.push(
      ...this.buildSubmitSteps(form.submitSelector, postSubmitExpectations)
    );

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

  private buildSubmitSteps(
    submitSelector?: string,
    postSubmitExpectations: Expectation[] = []
  ): TestStep[] {
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
        expectations: postSubmitExpectations,
        description: "Wait for post-submit state",
        continueOnFailure: true,
      },
    ];
  }

  private buildValuePreservationExpectations(
    form: FormInfo,
    valuesBySelector: Record<string, string>,
    omittedSelector?: string
  ): Expectation[] {
    const expectations: Expectation[] = [];

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

      if (this.isCheckboxLike(field)) {
        expectations.push(
          this.makeExpectation(
            ExpectationType.ElementChecked,
            `${this.fieldLabel(field)} should preserve its selected state after validation feedback`,
            {
              targetPath: field.selector,
            }
          )
        );
        continue;
      }

      expectations.push(
        this.makeExpectation(
          ExpectationType.InputValue,
          `${this.fieldLabel(field)} should preserve its value after validation feedback`,
          {
            targetPath: field.selector,
            expectedValue: value,
          }
        )
      );
    }

    return expectations;
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
    validValues: Record<string, string>,
    actionableItems: ActionableItem[]
  ): GeneratedTestElement[] {
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

    const tests: GeneratedTestElement[] = [
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
              timeoutMs: 3000,
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
        generatedKey: this.buildGeneratedKey(
          "search",
          startingPageStateId,
          form.selector,
          searchField.selector
        ),
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
              timeoutMs: 3000,
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
        generatedKey: this.buildGeneratedKey(
          "search-empty",
          startingPageStateId,
          form.selector,
          searchField.selector
        ),
      },
      {
        title: `Search Recovery — ${formLabel}`,
        type: "form",
        sizeClass,
        surface_tags: ["form", "search", "recovery"],
        priority: 3,
        startingPageStateId,
        startingPath: currentPath,
        steps: [
          ...this.buildFormSteps(form, noResultsValues, undefined),
          ...this.buildSearchRecoverySteps(form, searchField, "test"),
        ],
        globalExpectations: [
          ...this.defaultFlowExpectations(`Search recovery flow ${formLabel}`),
          this.makeExpectation(
            ExpectationType.NetworkRequestMade,
            `Recovering search results via ${formLabel} should issue GET requests`,
            {
              expectedValue: "GET",
              timeoutMs: 3000,
              expectedTextTokens: ["search", "q=", "query", "term"],
            }
          ),
          this.makeExpectation(
            ExpectationType.LoadingCompletes,
            `Search recovery for ${formLabel} should finish loading`
          ),
        ],
        uid,
        generatedKey: this.buildGeneratedKey(
          "search-recovery",
          startingPageStateId,
          form.selector,
          searchField.selector
        ),
      },
    ];

    const clearAction = actionableItems.find(item =>
      this.isSearchClearItem(item)
    );
    if (clearAction) {
      const clearSteps = this.buildFormSteps(form, searchValues, undefined);
      clearSteps.push(
        this.buildJourneyAction(clearAction, "Clear search", [
          this.makeExpectation(
            ExpectationType.ResultsRestored,
            `Clearing ${formLabel} should restore the baseline results`
          ),
          this.makeExpectation(
            ExpectationType.InputValue,
            `Clearing ${formLabel} should empty the search field`,
            {
              targetPath: searchField.selector,
              expectedValue: "",
            }
          ),
        ])
      );

      tests.push({
        title: `Search Clear Restore — ${formLabel}`,
        type: "form",
        sizeClass,
        surface_tags: ["form", "search", "restore"],
        priority: 3,
        startingPageStateId,
        startingPath: currentPath,
        steps: clearSteps,
        globalExpectations: [
          ...this.defaultFlowExpectations(`Search clear flow ${formLabel}`),
          this.makeExpectation(
            ExpectationType.ResultsRestored,
            `Clearing ${formLabel} should restore the initial results baseline`
          ),
        ],
        uid,
        generatedKey: this.buildGeneratedKey(
          "search-clear",
          startingPageStateId,
          form.selector,
          searchField.selector,
          clearAction.selector
        ),
      });
    }

    return tests;
  }

  private buildSearchRecoverySteps(
    form: FormInfo,
    searchField: FormField,
    recoveryValue: string
  ): TestStep[] {
    const steps: TestStep[] = [];
    const refillStep = this.buildFieldStep(searchField, recoveryValue);
    if (refillStep) {
      steps.push(refillStep);
    }
    steps.push(
      ...this.buildSubmitSteps(form.submitSelector, [
        this.makeExpectation(
          ExpectationType.ResultsChanged,
          `${this.fieldLabel(searchField)} should recover from the empty state to a different result set`
        ),
        this.makeExpectation(
          ExpectationType.InputValue,
          `${this.fieldLabel(searchField)} should preserve the recovery query after resubmission`,
          {
            targetPath: searchField.selector,
            expectedValue: recoveryValue,
          }
        ),
        this.makeExpectation(
          ExpectationType.LoadingCompletes,
          "Recovered search results should finish loading"
        ),
      ])
    );

    return steps;
  }

  private describeForm(form: FormInfo, index: number): string {
    const namedField = form.fields.find(field => field.label || field.name);
    const descriptor =
      namedField?.label || namedField?.name || `form ${index + 1}`;
    return `${descriptor} @ ${form.selector}`;
  }

  private buildSemanticJourneyTestElements(
    context: AnalyzerContext
  ): GeneratedTestElement[] {
    const items = this.selectRepresentativeItems(
      context.actionableItems.filter(
        item => item.visible && !item.disabled && Boolean(item.selector)
      )
    );
    const journeys: GeneratedTestElement[] = [];
    const collectionCount = this.estimateCollectionCount(context.html);

    const addToCart = items.find(item => this.isAddToCartItem(item));
    const checkout = items.find(item => this.isCheckoutItem(item));
    const createCollectionAction = items.find(item =>
      this.isCreateCollectionAction(item)
    );
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
                  timeoutMs: 3000,
                }
              ),
              this.makeExpectation(
                ExpectationType.NoDuplicateMutationRequests,
                "Adding an item should not trigger duplicate mutation requests"
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
                "feedback_not_duplicated",
                "Adding an item should not show duplicate feedback messages"
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
                  timeoutMs: 3000,
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
      const removeExpectations = [
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
          "row_count_changed",
          "Removing an item should change the visible row or item count",
          {
            expectedCountDelta: -1,
          }
        ),
        this.makeExpectation(
          "results_changed",
          "Removing an item should change the visible collection state"
        ),
        this.makeExpectation(
          ExpectationType.NetworkRequestMade,
          "Removing an item should trigger a backend mutation request",
          {
            expectedValue: "mutation",
            timeoutMs: 3000,
          }
        ),
        this.makeExpectation(
          ExpectationType.NoDuplicateMutationRequests,
          "Removing an item should not trigger duplicate mutation requests"
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
          "feedback_not_duplicated",
          "Removing an item should not show duplicate feedback messages"
        ),
        this.makeExpectation(
          "loading_completes",
          "Removal flow should complete loading"
        ),
        this.makeExpectation(
          "page_responsive",
          "Page should remain responsive after removal"
        ),
      ];
      if (this.estimateCollectionCount(context.html) <= 1) {
        removeExpectations.push(
          this.makeExpectation(
            ExpectationType.EmptyStateVisible,
            "Removing the last visible item should show an empty state or zero-results message",
            {
              expectedTextTokens: [
                "no items",
                "no products",
                "empty",
                "no results",
                "nothing found",
              ],
              severity: ExpectationSeverity.ShouldPass,
            }
          )
        );
      }

      journeys.push(
        this.buildJourneyTestElement(
          "Remove item from collection",
          ["commerce", "remove"],
          context,
          [
            this.buildJourneyAction(
              removeItem,
              "Remove item",
              removeExpectations
            ),
          ]
        )
      );
    }

    if (createCollectionAction) {
      const createExpectations = [
        this.makeExpectation(
          "navigation_or_state_changed",
          "Creating or adding a record should change the page state"
        ),
        this.makeExpectation(
          "row_count_changed",
          "Creating or adding a record should increase the visible row or item count",
          {
            expectedCountDelta: 1,
          }
        ),
        this.makeExpectation(
          "results_changed",
          "Creating or adding a record should change the visible collection state"
        ),
        this.makeExpectation(
          ExpectationType.NetworkRequestMade,
          "Creating or adding a record should trigger a backend mutation request",
          {
            expectedValue: "mutation",
            timeoutMs: 3000,
          }
        ),
        this.makeExpectation(
          ExpectationType.NoDuplicateMutationRequests,
          "Creating or adding a record should not trigger duplicate mutation requests"
        ),
        this.makeExpectation(
          "feedback_not_duplicated",
          "Creating or adding a record should not duplicate visible feedback"
        ),
        this.makeExpectation(
          "loading_completes",
          "Create/add flow should complete loading"
        ),
        this.makeExpectation(
          "page_responsive",
          "Page should remain responsive after creating or adding a record"
        ),
      ];

      journeys.push(
        this.buildJourneyTestElement(
          "Create or add collection record",
          ["list", "crud", "create"],
          context,
          [
            this.buildJourneyAction(
              createCollectionAction,
              "Create or add record",
              createExpectations
            ),
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

    const protectedAction = items.find(
      item => item !== authEntry && this.isProtectedActionItem(item)
    );
    if (authEntry && protectedAction) {
      journeys.push(
        this.buildJourneyTestElement(
          "Protected action auth gate journey",
          ["auth", "protected"],
          context,
          [
            this.buildJourneyAction(protectedAction, "Open protected action", [
              this.makeExpectation(
                ExpectationType.NavigationOrStateChanged,
                "Protected action should open a gated state, redirect, or login requirement"
              ),
              this.makeExpectation(
                ExpectationType.PageResponsive,
                "Page should remain responsive when auth gating is triggered"
              ),
              this.makeExpectation(
                ExpectationType.LoadingCompletes,
                "Protected action gate should settle cleanly"
              ),
            ]),
          ]
        )
      );
    }

    const logoutAction = items.find(item => this.isLogoutAction(item));
    if (logoutAction) {
      journeys.push(
        this.buildJourneyTestElement(
          "Logout journey",
          ["auth", "logout"],
          context,
          [
            this.buildJourneyAction(logoutAction, "Log out", [
              this.makeExpectation(
                ExpectationType.NavigationOrStateChanged,
                "Logging out should change application state"
              ),
              this.makeExpectation(
                ExpectationType.PageResponsive,
                "Page should remain responsive during logout"
              ),
              this.makeExpectation(
                ExpectationType.LoadingCompletes,
                "Logout should settle cleanly"
              ),
              this.makeExpectation(
                ExpectationType.FeedbackVisible,
                "Logout should provide visible confirmation or a clear state change",
                {
                  forbiddenTextTokens: ["error", "failed"],
                }
              ),
              this.makeExpectation(
                ExpectationType.ErrorStateCleared,
                "Logout should not leave visible recoverable error state behind",
                {
                  severity: ExpectationSeverity.ShouldPass,
                }
              ),
            ]),
          ]
        )
      );
    }

    const retryAction = items.find(item => this.isRetryAction(item));
    if (retryAction) {
      journeys.push(
        this.buildJourneyTestElement(
          "Retry recovery journey",
          ["recovery", "retry"],
          context,
          [
            this.buildJourneyAction(retryAction, "Retry failed action", [
              this.makeExpectation(
                ExpectationType.ErrorStateCleared,
                "Retrying should clear any visible recoverable error state"
              ),
              this.makeExpectation(
                ExpectationType.NetworkRequestMade,
                "Retrying should trigger a follow-up request or state transition",
                {
                  expectedValue: "ANY",
                  timeoutMs: 3000,
                }
              ),
              this.makeExpectation(
                "navigation_or_state_changed",
                "Retrying should change page state or visibly advance recovery"
              ),
              this.makeExpectation(
                "loading_completes",
                "Retry recovery should complete loading"
              ),
              this.makeExpectation(
                "page_responsive",
                "Page should remain responsive during retry recovery"
              ),
              this.makeExpectation(
                "feedback_not_duplicated",
                "Retry recovery should not duplicate visible feedback"
              ),
              this.makeExpectation(
                "feedback_visible",
                "Retry recovery should show updated feedback or state confirmation",
                {
                  forbiddenTextTokens: ["error", "failed", "try again"],
                }
              ),
            ]),
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

    for (const quantityAction of items.filter(item =>
      this.isQuantityAction(item)
    )) {
      const quantityDelta = this.inferQuantityDelta(quantityAction);
      const quantityExpectations = [
        this.makeExpectation(
          "count_changed",
          "Adjusting quantity should update a visible count or quantity indicator",
          quantityDelta == null
            ? undefined
            : { expectedCountDelta: quantityDelta }
        ),
        this.makeExpectation(
          "cart_summary_changed",
          "Adjusting quantity should update subtotal, totals, or line pricing"
        ),
        this.makeExpectation(
          "results_changed",
          "Adjusting quantity should change the visible cart or line-item state"
        ),
        this.makeExpectation(
          ExpectationType.NetworkRequestMade,
          "Adjusting quantity should trigger a backend mutation request",
          {
            expectedValue: "mutation",
            timeoutMs: 3000,
          }
        ),
        this.makeExpectation(
          ExpectationType.NoDuplicateMutationRequests,
          "Adjusting quantity should not trigger duplicate mutation requests"
        ),
        this.makeExpectation(
          "feedback_not_duplicated",
          "Quantity adjustment should not duplicate visible feedback"
        ),
        this.makeExpectation(
          "loading_completes",
          "Quantity adjustment should complete loading"
        ),
        this.makeExpectation(
          "page_responsive",
          "Page should remain responsive during quantity adjustment"
        ),
      ].filter(Boolean) as Expectation[];

      journeys.push(
        this.buildJourneyTestElement(
          quantityDelta === -1
            ? "Quantity decrease journey"
            : quantityDelta === 1
              ? "Quantity increase journey"
              : "Quantity adjustment journey",
          ["commerce", "quantity"],
          context,
          [
            this.buildJourneyAction(
              quantityAction,
              quantityDelta === -1
                ? "Decrease quantity"
                : quantityDelta === 1
                  ? "Increase quantity"
                  : "Adjust quantity",
              quantityExpectations
            ),
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

    const paginationAction = items.find(item => this.isPaginationAction(item));
    if (paginationAction) {
      journeys.push(
        this.buildJourneyTestElement(
          "Pagination journey",
          ["list", "pagination"],
          context,
          [
            this.buildJourneyAction(paginationAction, "Paginate list", [
              this.makeExpectation(
                ExpectationType.NavigationOrStateChanged,
                "Pagination should change the visible list state"
              ),
              this.makeExpectation(
                "results_changed",
                "Pagination should change the visible collection contents"
              ),
              this.makeExpectation(
                "row_count_changed",
                "Pagination should change the visible rows or items"
              ),
              this.makeExpectation(
                "collection_order_changed",
                "Pagination should change the visible collection ordering or composition"
              ),
              this.makeExpectation(
                ExpectationType.LoadingCompletes,
                "Pagination should complete loading"
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

    if (collectionCount > 0 && removeItem && createCollectionAction) {
      journeys.push(
        this.buildJourneyTestElement(
          "Collection mutation recovery journey",
          ["list", "crud", "recovery"],
          context,
          [
            this.buildJourneyAction(removeItem, "Remove record", [
              this.makeExpectation(
                "row_count_changed",
                "Removing a record should change the visible collection",
                {
                  expectedCountDelta: -1,
                }
              ),
              this.makeExpectation(
                "results_changed",
                "Removing a record should change the visible collection contents"
              ),
            ]),
            this.waitStep(500, "Wait for collection mutation"),
            this.buildJourneyAction(createCollectionAction, "Add record back", [
              this.makeExpectation(
                "row_count_changed",
                "Adding a record back should restore visible collection size",
                {
                  expectedCountDelta: 1,
                }
              ),
              this.makeExpectation(
                "results_changed",
                "Adding a record back should change the visible collection contents again"
              ),
              this.makeExpectation(
                "loading_completes",
                "Collection recovery should complete loading"
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
  ): GeneratedTestElement {
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
      generatedKey: this.buildGeneratedKey(
        "semantic-journey",
        context.currentPageStateId,
        context.currentPath,
        this.buildStepSignature(steps)
      ),
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
        severity: ExpectationSeverity.ShouldPass,
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
  ): GeneratedTestElement[] {
    const items = this.selectRepresentativeItems(
      context.actionableItems.filter(
        item => item.visible && !item.disabled && Boolean(item.selector)
      )
    );
    const tests: GeneratedTestElement[] = [];

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

  private buildVariantTestElements(
    context: AnalyzerContext
  ): GeneratedTestElement[] {
    const items = this.selectRepresentativeItems(
      context.actionableItems.filter(
        item =>
          item.visible &&
          !item.disabled &&
          Boolean(item.selector) &&
          this.isVariantSelector(item)
      )
    );

    const tests = items
      .map(item => this.buildVariantTestElement(item, context))
      .filter((item): item is GeneratedTestElement => Boolean(item));

    const purchaseAction = context.actionableItems.find(
      item =>
        item.visible &&
        !item.disabled &&
        Boolean(item.selector) &&
        (this.isAddToCartItem(item) || this.isCheckoutItem(item))
    );

    for (const item of items) {
      const purchaseJourney = this.buildVariantPurchaseJourney(
        item,
        purchaseAction,
        context
      );
      if (purchaseJourney) tests.push(purchaseJourney);

      const requiredField = this.findRequiredVariantField(item, context.forms);
      if (requiredField && purchaseAction) {
        tests.push(
          this.buildRequiredVariantGuardTestElement(
            item,
            requiredField,
            purchaseAction,
            context
          )
        );
      }
    }

    return tests;
  }

  private buildVariantTestElement(
    item: ActionableItem,
    context: AnalyzerContext
  ): GeneratedTestElement | null {
    const plannedValue = this.extractSelectableValue(item);
    if (!plannedValue || !item.selector) return null;

    const label = this.describeActionableItem(item);
    return {
      title: `Variant selection ${label}`,
      type: "interaction",
      sizeClass: context.sizeClass,
      surface_tags: ["variant", "selection"],
      priority: 2,
      startingPageStateId: context.currentPageStateId,
      startingPath: context.currentPath,
      steps: [
        {
          action: {
            actionType: PlaywrightAction.SelectOption,
            path: item.selector,
            value: plannedValue,
            playwrightCode: `await page.locator('${item.selector}').selectOption('${this.escapeSingleQuotes(plannedValue)}')`,
            description: `Select variant ${label}`,
          },
          expectations: [
            this.makeExpectation(
              ExpectationType.InputValue,
              `Selecting ${label} should update the chosen variant option`,
              {
                targetPath: item.selector,
                expectedValue: plannedValue,
              }
            ),
            this.makeExpectation(
              ExpectationType.VariantStateChanged,
              `Selecting ${label} should change product state`,
              {
                targetPath: item.selector,
                expectedValue: plannedValue,
              }
            ),
          ],
          description: `Select variant ${label}`,
          continueOnFailure: false,
        },
      ],
      globalExpectations: this.defaultFlowExpectations(
        "Variant selection should complete without runtime errors"
      ),
      uid: context.uid,
      generatedKey: this.buildGeneratedKey(
        "variant-selection",
        context.currentPageStateId,
        item.selector,
        plannedValue
      ),
    };
  }

  private buildVariantPurchaseJourney(
    item: ActionableItem,
    purchaseAction: ActionableItem | undefined,
    context: AnalyzerContext
  ): GeneratedTestElement | null {
    const plannedValue = this.extractSelectableValue(item);
    if (!plannedValue || !item.selector || !purchaseAction?.selector) {
      return null;
    }

    const label = this.describeActionableItem(item);
    const purchaseLabel = this.describeActionableItem(purchaseAction);
    const purchaseExpectations = this.isAddToCartItem(purchaseAction)
      ? [
          this.makeExpectation(
            ExpectationType.NetworkRequestMade,
            `${purchaseLabel} should trigger a backend mutation request after selecting ${label}`,
            {
              expectedValue: "mutation",
              timeoutMs: 3000,
            }
          ),
          this.makeExpectation(
            ExpectationType.NoDuplicateMutationRequests,
            `${purchaseLabel} should not trigger duplicate mutation requests after selecting ${label}`
          ),
          this.makeExpectation(
            ExpectationType.CountChanged,
            `${purchaseLabel} should update a visible count after selecting ${label}`,
            {
              expectedCountDelta: 1,
            }
          ),
          this.makeExpectation(
            ExpectationType.CartSummaryChanged,
            `${purchaseLabel} should update cart summary after selecting ${label}`
          ),
          this.makeExpectation(
            ExpectationType.FeedbackVisible,
            `${purchaseLabel} should provide visible feedback after selecting ${label}`,
            {
              expectedTextTokens: ["added", "success", "cart", "bag"],
              forbiddenTextTokens: ["error", "failed"],
            }
          ),
        ]
      : [
          this.makeExpectation(
            ExpectationType.NetworkRequestMade,
            `${purchaseLabel} should trigger a request or transition after selecting ${label}`,
            {
              expectedValue: "ANY",
              timeoutMs: 3000,
              expectedTextTokens: ["checkout", "buy", "order"],
            }
          ),
          this.makeExpectation(
            ExpectationType.NavigationOrStateChanged,
            `${purchaseLabel} should advance the purchase flow after selecting ${label}`
          ),
        ];

    return {
      title: `Variant purchase journey ${label}`,
      type: "interaction",
      sizeClass: context.sizeClass,
      surface_tags: ["variant", "purchase"],
      priority: 2,
      startingPageStateId: context.currentPageStateId,
      startingPath: context.currentPath,
      steps: [
        {
          action: {
            actionType: PlaywrightAction.SelectOption,
            path: item.selector,
            value: plannedValue,
            playwrightCode: `await page.locator('${item.selector}').selectOption('${this.escapeSingleQuotes(plannedValue)}')`,
            description: `Select variant ${label}`,
          },
          expectations: [
            this.makeExpectation(
              ExpectationType.InputValue,
              `Selecting ${label} should update the chosen option`,
              {
                targetPath: item.selector,
                expectedValue: plannedValue,
              }
            ),
            this.makeExpectation(
              ExpectationType.VariantStateChanged,
              `Selecting ${label} should update product state before purchase`,
              {
                targetPath: item.selector,
                expectedValue: plannedValue,
              }
            ),
          ],
          description: `Select variant ${label}`,
          continueOnFailure: false,
        },
        this.buildJourneyAction(
          purchaseAction,
          `Purchase with selected ${label}`,
          [
            ...purchaseExpectations,
            this.makeExpectation(
              ExpectationType.LoadingCompletes,
              `${purchaseLabel} should complete loading after selecting ${label}`
            ),
            this.makeExpectation(
              ExpectationType.PageResponsive,
              `Page should remain responsive while completing ${purchaseLabel}`
            ),
          ]
        ),
      ],
      globalExpectations: this.defaultFlowExpectations(
        `Variant purchase journey for ${label} should execute cleanly`
      ),
      uid: context.uid,
      generatedKey: this.buildGeneratedKey(
        "variant-purchase",
        context.currentPageStateId,
        item.selector,
        plannedValue,
        purchaseAction.selector
      ),
    };
  }

  private buildRequiredVariantGuardTestElement(
    item: ActionableItem,
    requiredField: FormField,
    purchaseAction: ActionableItem,
    context: AnalyzerContext
  ): GeneratedTestElement {
    const label = this.describeActionableItem(item);
    const purchaseLabel = this.describeActionableItem(purchaseAction);

    return {
      title: `Variant required guard ${label}`,
      type: "interaction",
      sizeClass: context.sizeClass,
      surface_tags: ["variant", "validation", "guard"],
      priority: 3,
      startingPageStateId: context.currentPageStateId,
      startingPath: context.currentPath,
      steps: [
        this.buildJourneyAction(
          purchaseAction,
          `Attempt ${purchaseLabel} without selecting ${label}`,
          [
            this.makeExpectation(
              ExpectationType.RequiredErrorShownForField,
              `${label} should show required validation before ${purchaseLabel}`,
              {
                targetPath: requiredField.selector,
              }
            ),
            this.makeExpectation(
              ExpectationType.PageResponsive,
              `Page should remain responsive when ${purchaseLabel} is blocked by missing ${label}`
            ),
          ]
        ),
      ],
      globalExpectations: this.defaultFlowExpectations(
        `${label} should be enforced before ${purchaseLabel}`
      ),
      uid: context.uid,
      generatedKey: this.buildGeneratedKey(
        "variant-guard",
        context.currentPageStateId,
        item.selector,
        requiredField.selector,
        purchaseAction.selector
      ),
    };
  }

  private findRequiredVariantField(
    item: ActionableItem,
    forms: FormInfo[]
  ): FormField | undefined {
    for (const form of forms) {
      const field = form.fields.find(
        field =>
          field.selector === item.selector &&
          field.required &&
          this.isSearchField(field) === false
      );
      if (field) return field;
    }

    return undefined;
  }

  private buildDisclosureToggleTestElement(
    item: ActionableItem,
    startingPath: string,
    sizeClass: SizeClass,
    uid?: string,
    startingPageStateId?: number
  ): GeneratedTestElement {
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
      generatedKey: this.buildGeneratedKey(
        "disclosure-click",
        startingPageStateId,
        item.stableKey ?? item.selector ?? label
      ),
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
  ): GeneratedTestElement {
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
          expectations: [
            this.makeExpectation(
              ExpectationType.ElementFocused,
              `${label} should be keyboard-focusable`,
              {
                targetPath: item.selector,
              }
            ),
          ],
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
      generatedKey: this.buildGeneratedKey(
        "keyboard",
        startingPageStateId,
        key === " " ? "space" : key,
        item.stableKey ?? item.selector ?? label
      ),
    };
  }

  private buildDialogCloseTestElement(
    item: ActionableItem,
    startingPath: string,
    sizeClass: SizeClass,
    uid?: string,
    startingPageStateId?: number
  ): GeneratedTestElement {
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
      generatedKey: this.buildGeneratedKey(
        "dialog-close",
        startingPageStateId,
        item.stableKey ?? item.selector ?? label
      ),
    };
  }

  private buildEscapeDialogTestElement(
    startingPath: string,
    sizeClass: SizeClass,
    uid?: string,
    startingPageStateId?: number
  ): GeneratedTestElement {
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
      generatedKey: this.buildGeneratedKey(
        "dialog-escape",
        startingPageStateId,
        startingPath
      ),
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
  ): GeneratedTestElement {
    const label = this.describeActionableItem(item);
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
      generatedKey: this.buildGeneratedKey(
        "control",
        startingPageStateId,
        isImmutable ? "immutable" : "enabled",
        role || inputType || item.actionKind || "control",
        item.stableKey ?? item.selector ?? label
      ),
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
    const described = (
      item.accessibleName ||
      item.textContent ||
      String(item.attributes?._containerTitle ?? "") ||
      String(item.attributes?.labelText ?? "") ||
      String(item.attributes?.placeholder ?? "")
    ).trim();
    if (described) return described;

    const selector = item.selector ?? "";
    if (selector.includes("data-tmnc-id")) {
      const role = item.role?.trim();
      const inputType = item.inputType?.trim();
      if (role) return role;
      if (inputType) return inputType;
      if (item.actionKind === "navigate") return "link";
      if (item.actionKind === "fill") return "input";
      if (item.actionKind === "select") return "select";
      return "control";
    }

    return selector || item.actionKind || "control";
  }

  private semanticText(item: ActionableItem): string {
    return [
      item.accessibleName || "",
      item.textContent || "",
      String(item.attributes?.labelText ?? ""),
      String(item.attributes?.placeholder ?? ""),
      String(item.attributes?.name ?? ""),
      String(item.attributes?.id ?? ""),
      String(item.attributes?._containerTitle ?? ""),
      String(item.attributes?._containerCtaStyle ?? ""),
      item.href || "",
      item.selector,
    ]
      .join(" ")
      .toLowerCase();
  }

  private selectRepresentativeItems(items: ActionableItem[]): ActionableItem[] {
    const groups = new Map<string, ActionableItem[]>();
    const passthrough: ActionableItem[] = [];

    for (const item of items) {
      const containerFingerprint = String(
        item.attributes?._containerFingerprint ?? ""
      ).trim();
      if (!containerFingerprint) {
        passthrough.push(item);
        continue;
      }

      const key = `${containerFingerprint}|${this.representativeActionStyle(item)}`;
      const bucket = groups.get(key) ?? [];
      bucket.push(item);
      groups.set(key, bucket);
    }

    const representatives = Array.from(groups.values()).map(group =>
      this.pickRepresentativeItem(group)
    );

    return [...passthrough, ...representatives];
  }

  private representativeActionStyle(item: ActionableItem): string {
    const text = this.semanticText(item);
    const sourceHints = String(
      item.attributes?._sourceHints ?? ""
    ).toLowerCase();
    const containerTitle = String(
      item.attributes?._containerTitle ?? ""
    ).toLowerCase();

    if (
      sourceHints.includes("promoted-target") ||
      sourceHints.includes("cursor-pointer")
    ) {
      return "tile-click";
    }

    if (
      item.actionKind === "navigate" &&
      containerTitle &&
      (text.includes(containerTitle) ||
        (item.href && !this.isCheckoutItem(item)))
    ) {
      return "tile-click";
    }

    if (this.isAddToCartItem(item)) return "cta:add-to-cart";
    if (/\blogin for pricing\b/.test(text)) return "cta:login-for-pricing";
    if (/\bselect options\b/.test(text)) return "cta:select-options";
    if (this.isCheckoutItem(item)) return "cta:checkout";
    if (this.isRemoveItemAction(item)) return "cta:remove";
    if (item.actionKind === "navigate") return "navigate";
    if (item.actionKind === "select") return "select";
    if (item.actionKind === "fill") return "fill";

    return `${item.actionKind}:${text
      .replace(/\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/g, "email")
      .replace(/\$\s?\d[\d,.]*/g, "price")
      .replace(/\d+/g, "n")
      .slice(0, 80)}`;
  }

  private pickRepresentativeItem(items: ActionableItem[]): ActionableItem {
    return [...items].sort((left, right) => {
      const leftScore = this.representativePriority(left);
      const rightScore = this.representativePriority(right);
      if (leftScore !== rightScore) return rightScore - leftScore;
      return (left.selector?.length ?? 0) - (right.selector?.length ?? 0);
    })[0] as ActionableItem;
  }

  private representativePriority(item: ActionableItem): number {
    let score = 0;
    const sourceHints = String(
      item.attributes?._sourceHints ?? ""
    ).toLowerCase();
    if (sourceHints.includes("promoted-target")) score += 4;
    if (sourceHints.includes("cursor-pointer")) score += 3;
    if (item.actionKind === "navigate") score += 2;
    if (item.actionKind === "click") score += 1;
    if (String(item.attributes?._testId ?? "")) score += 1;
    if (item.accessibleName) score += 1;
    return score;
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
    return /\b(remove|delete|trash|clear item|remove item|dismiss|archive|hide item|close item)\b/.test(
      this.semanticText(item)
    );
  }

  private estimateCollectionCount(html: string): number {
    const tableRows = (html.match(/<tr\b/gi) ?? []).length;
    if (tableRows > 0) return tableRows;

    const listItems = (html.match(/<li\b/gi) ?? []).length;
    if (listItems > 0) return listItems;

    const cards = (
      html.match(
        /<(?:article|section|div)\b[^>]*(?:product|card|result|item|row)[^>]*>/gi
      ) ?? []
    ).length;

    return cards;
  }

  private isAuthEntryItem(item: ActionableItem): boolean {
    return /\b(sign up|register|create account|sign in|log in|login)\b/.test(
      this.semanticText(item)
    );
  }

  private isProtectedActionItem(item: ActionableItem): boolean {
    return /\b(checkout|pricing|view price|account|settings|billing|subscription|dashboard|admin|manage account|saved items|favorites|download)\b/.test(
      this.semanticText(item)
    );
  }

  private isLogoutAction(item: ActionableItem): boolean {
    return /\b(log out|logout|sign out)\b/.test(this.semanticText(item));
  }

  private isRetryAction(item: ActionableItem): boolean {
    return /\b(retry|try again|resend|send again|reload|refresh|reconnect|resume)\b/.test(
      this.semanticText(item)
    );
  }

  private isCreateCollectionAction(item: ActionableItem): boolean {
    const text = this.semanticText(item);
    if (this.isAddToCartItem(item)) return false;
    return /\b(add row|add record|add item|new row|new record|create item|create record|add another|new item)\b/.test(
      text
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

  private inferQuantityDelta(item: ActionableItem): number | undefined {
    const text = this.semanticText(item);
    if (
      /\b(decrease|decrement|minus|remove one|lower qty|lower quantity)\b/.test(
        text
      )
    ) {
      return -1;
    }
    if (
      /\b(increase|increment|plus|add one|raise qty|raise quantity)\b/.test(
        text
      )
    ) {
      return 1;
    }
    return undefined;
  }

  private isFilterAction(item: ActionableItem): boolean {
    return /\b(filter|refine|apply filter|show results|category|brand|size|color|price)\b/.test(
      this.semanticText(item)
    );
  }

  private isSearchClearItem(item: ActionableItem): boolean {
    return /\b(clear search|clear results|reset search|reset filters|clear|reset)\b/.test(
      this.semanticText(item)
    );
  }

  private isSortAction(item: ActionableItem): boolean {
    return /\b(sort|order by|best selling|price low|price high|newest|featured)\b/.test(
      this.semanticText(item)
    );
  }

  private isPaginationAction(item: ActionableItem): boolean {
    return /\b(next|previous|prev|page \d+|load more|show more|older|newer)\b/.test(
      this.semanticText(item)
    );
  }

  private isVariantSelector(item: ActionableItem): boolean {
    if (item.actionKind !== "select") {
      return false;
    }

    return /\b(variant|option|size|color|colour|style|material|finish|width|length)\b/.test(
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
