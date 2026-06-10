import type {
  TestInteraction,
  Expectation,
  ActionableItem,
  SizeClass,
  TestSurfaceResponse,
  ActionableItemResponse,
} from "@sudobility/testomniac_types";
import {
  PlaywrightAction,
  ExpectationType,
  ExpectationSeverity,
} from "@sudobility/testomniac_types";
import {
  buildReplaySelectorFromActionableItem,
  matchesActionableItemSelector,
} from "../../browser/replay-selector";
import { createHash } from "node:crypto";
import type { AnalyzerContext } from "./types";
import type { DedupStore } from "../../storage/dedup-store";
import { InMemoryDedupStore } from "../../storage/dedup-store";

export type { AnalyzerContext } from "./types";

type GeneratedTestInteraction = TestInteraction & {
  generatedKey?: string;
};

type AppendActionResult = {
  testInteraction: TestInteraction;
  appended: boolean;
};

function logAnalyzer(step: string, details?: Record<string, unknown>): void {
  console.info("[PageAnalyzer]", step, details ?? {});
}

/**
 * Normalize a URL path for dedup comparison:
 *  1. Remove query params with empty values (`foo=` or `foo`)
 *  2. Sort remaining params so order doesn't matter
 *
 * `/store/?b=2&a=1` and `/store/?a=1&b=2` → same key.
 * `/store/?filternum=0&pagenum=1` keeps both (non-empty values).
 * `/store/?foo=&bar` drops both (empty values).
 */
function normalizePathForDedup(raw: string): string {
  const qIndex = raw.indexOf("?");
  if (qIndex === -1) return raw;

  const base = raw.slice(0, qIndex);
  const search = raw.slice(qIndex + 1);
  if (!search) return base;

  const kept = search
    .split("&")
    .filter(pair => {
      const eqIndex = pair.indexOf("=");
      if (eqIndex === -1) return false; // bare key, no value
      return pair.slice(eqIndex + 1).length > 0; // non-empty value
    })
    .sort();

  return kept.length > 0 ? `${base}?${kept.join("&")}` : base;
}

/** Strip the query string entirely to get the base path. */
function basePathOf(raw: string): string {
  const qIndex = raw.indexOf("?");
  return qIndex === -1 ? raw : raw.slice(0, qIndex);
}

/**
 * PageAnalyzer generates expectations and discovers new test elements
 * during discovery mode.
 */
export class PageAnalyzer {
  private store: DedupStore;
  private surfacesCache: TestSurfaceResponse[] | null = null;

  constructor(dedupStore?: DedupStore) {
    this.store = dedupStore ?? new InMemoryDedupStore();
  }

  private async getCachedSurfaces(
    context: AnalyzerContext
  ): Promise<TestSurfaceResponse[]> {
    if (!this.surfacesCache) {
      this.surfacesCache = await context.api.getTestSurfacesByRunner(
        context.runnerId
      );
    }
    return this.surfacesCache;
  }

  private invalidateSurfacesCache(): void {
    this.surfacesCache = null;
  }

  /** Check whether generation already happened for a given path in this run. */
  hasGeneratedForPath(path: string): Promise<boolean> {
    return this.store.has("generatedPaths", normalizePathForDedup(path));
  }

  /**
   * Check whether a (actionType, replaySelector) pair has already been
   * generated for any URL variant of the same base path.
   */
  hasGeneratedSelectorForBasePath(
    path: string,
    actionType: string,
    replaySelector: string
  ): Promise<boolean> {
    const key = `${basePathOf(path)}\0${actionType}\0${replaySelector}`;
    return this.store.has("generatedSelectors", key);
  }

  /**
   * Record that a (actionType, replaySelector) was generated under a base
   * path so future URL variants can skip it.
   */
  markGeneratedSelectorForBasePath(
    path: string,
    actionType: string,
    replaySelector: string
  ): Promise<void> {
    const key = `${basePathOf(path)}\0${actionType}\0${replaySelector}`;
    return this.store.add("generatedSelectors", key);
  }

  /**
   * Normalize finding text for dedup: strip leading count numbers that vary
   * between evaluations.  Preserves URLs, status codes, and other content.
   *
   *   "[page-health] 5 broken image(s)" → "[page-health] broken image(s)"
   *   "3 significant console warning(s)" → "significant console warning(s)"
   *   "Page returned HTTP 404 for …"    → unchanged
   */
  private static normalizeFindingText(text: string): string {
    return text.replace(/^(\[[^\]]+\]\s*)\d+\s+/, "$1").replace(/^\d+\s+/, "");
  }

  /**
   * Returns true if an equivalent page-scoped finding has already been
   * recorded during this run.
   */
  hasReportedPageFinding(
    _path: string,
    title: string,
    description: string
  ): Promise<boolean> {
    const key = `${PageAnalyzer.normalizeFindingText(title)}\0${PageAnalyzer.normalizeFindingText(description)}`;
    return this.store.has("reportedPageFindings", key);
  }

  /**
   * Mark a page-scoped finding as recorded so it is not duplicated.
   */
  markPageFindingReported(
    _path: string,
    title: string,
    description: string
  ): Promise<void> {
    const key = `${PageAnalyzer.normalizeFindingText(title)}\0${PageAnalyzer.normalizeFindingText(description)}`;
    return this.store.add("reportedPageFindings", key);
  }

  /** Check whether a finding with the given stable key has been reported. */
  hasReportedFindingByKey(key: string): Promise<boolean> {
    return this.store.has("reportedFindingKeys", key);
  }

  /** Mark a stable finding key as reported. */
  markReportedFindingByKey(key: string): Promise<void> {
    return this.store.add("reportedFindingKeys", key);
  }

  /**
   * Check if a finding with this description has already been reported.
   */
  hasReportedDescription(description: string): Promise<boolean> {
    return this.store.has(
      "reportedDescriptions",
      PageAnalyzer.normalizeFindingText(description)
    );
  }

  /** Mark a finding description as reported. */
  markReportedDescription(description: string): Promise<void> {
    return this.store.add(
      "reportedDescriptions",
      PageAnalyzer.normalizeFindingText(description)
    );
  }

  /**
   * Check whether full test generation already ran for a page state with the
   * same visible actionable items (by hash).
   */
  hasGeneratedForActionableHash(hash: string): Promise<boolean> {
    return this.store.has("generatedActionableHashes", hash);
  }

  /**
   * Generate baseline expectations for a test element.
   * Called BEFORE expertises evaluate.
   */
  generateExpectations(testInteraction: TestInteraction): Expectation[] {
    const steps = Array.isArray(testInteraction.steps)
      ? testInteraction.steps
      : [];
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

  async maybeAppendActionToInteraction(
    testInteraction: TestInteraction,
    context: Pick<
      AnalyzerContext,
      | "runnerId"
      | "testEnvironmentId"
      | "sizeClass"
      | "uid"
      | "currentTestInteractionId"
      | "currentTestSurfaceId"
      | "currentSurfaceRunId"
      | "beginningPageStateId"
      | "currentPath"
      | "actionableItems"
      | "api"
    >
  ): Promise<AppendActionResult> {
    if (!this.isHoverOnly(testInteraction)) {
      return { testInteraction, appended: false };
    }

    const selector = this.getPrimarySelector(testInteraction);
    if (!selector) {
      return { testInteraction, appended: false };
    }

    const beginningItems =
      context.beginningPageStateId > 0
        ? await context.api.getItemsByPageState(context.beginningPageStateId)
        : [];
    const beginningKeys = new Set(
      beginningItems.map(item => this.getItemKey(item)).filter(Boolean)
    );
    const revealedItems = this.selectRepresentativeItems(
      context.actionableItems.filter(item => {
        if (!this.isMouseActionable(item)) return false;
        const key = this.getItemKey(item);
        return Boolean(key) && !beginningKeys.has(key);
      })
    );
    const currentHoveredItem =
      context.actionableItems.find(item =>
        matchesActionableItemSelector(selector, item)
      ) ?? null;
    const stableHoveredItem =
      currentHoveredItem ??
      beginningItems.find(item =>
        matchesActionableItemSelector(selector, item)
      ) ??
      null;

    logAnalyzer("generate:hover-inline-evaluated", {
      sourceTitle: testInteraction.title,
      currentTestInteractionId: context.currentTestInteractionId,
      currentSurfaceRunId: context.currentSurfaceRunId ?? null,
      selector,
      beginningItemsCount: beginningItems.length,
      actionableItemsCount: context.actionableItems.length,
      revealedItemsCount: revealedItems.length,
      hasCurrentHoveredItem: Boolean(currentHoveredItem),
      hasStableHoveredItem: Boolean(stableHoveredItem),
    });

    if (!stableHoveredItem) {
      return { testInteraction, appended: false };
    }

    // Prefer currentHoveredItem (ActionableItem); fall back to converting
    // the ActionableItemResponse from beginning page state.
    const fallback = stableHoveredItem as ActionableItemResponse;
    const clickItem: ActionableItem = currentHoveredItem ?? {
      stableKey: fallback.stableKey ?? fallback.selector ?? "",
      selector: fallback.selector ?? "",
      tagName: fallback.tagName ?? "",
      role: fallback.role ?? undefined,
      inputType: undefined,
      actionKind:
        (fallback.actionKind as ActionableItem["actionKind"]) ?? "click",
      accessibleName: fallback.accessibleName ?? undefined,
      textContent: undefined,
      href: undefined,
      disabled: fallback.disabled ?? false,
      visible: fallback.visible ?? true,
      attributes: (typeof fallback.attributesJson === "object" &&
      fallback.attributesJson !== null
        ? fallback.attributesJson
        : {}) as Record<string, unknown>,
    };

    // Don't append click for non-browser links (mailto:, tel:, etc.)
    if (this.isNonBrowserLink(clickItem)) {
      logAnalyzer("generate:hover-inline-click-skipped-non-browser-link", {
        sourceTitle: testInteraction.title,
        selector,
        href: clickItem.href,
      });
      return { testInteraction, appended: false };
    }

    const clickStep =
      this.buildClickTestInteraction(
        clickItem,
        context.currentPath,
        context.sizeClass,
        context.uid,
        testInteraction.startingPageStateId,
        undefined
      ).steps?.[0] ?? null;
    if (!clickStep) {
      return { testInteraction, appended: false };
    }

    const updatedInteraction: TestInteraction = {
      ...testInteraction,
      steps: [
        ...(Array.isArray(testInteraction.steps) ? testInteraction.steps : []),
        clickStep,
      ],
    };

    await context.api.ensureTestInteraction(
      context.runnerId,
      context.currentTestSurfaceId,
      updatedInteraction,
      context.testEnvironmentId,
      context.currentTestInteractionId
    );
    logAnalyzer("generate:hover-inline-click-appended", {
      sourceTitle: testInteraction.title,
      currentTestInteractionId: context.currentTestInteractionId,
      currentSurfaceRunId: context.currentSurfaceRunId ?? null,
      selector,
      appendedActionType: clickStep.action.actionType,
    });

    return {
      testInteraction: updatedInteraction,
      appended: true,
    };
  }

  /**
   * Generate new test elements for scaffolds and page content.
   * Called AFTER expertises evaluate and the target page state is established.
   */
  /**
   * @deprecated Generators now run server-side in testomniac_api.
   * The executor calls api.combinedNext() which handles generation.
   * This method is kept as a no-op for backward compatibility.
   */
  async generateTestInteractions(
    _testInteraction: TestInteraction,
    _context: AnalyzerContext
  ): Promise<void> {
    // No-op: generators moved to testomniac_api /combined/next endpoint
  }

  private isMouseActionable(item: ActionableItem): boolean {
    return (
      item.visible &&
      !item.disabled &&
      (item.actionKind === "click" || item.actionKind === "navigate")
    );
  }

  private isNonBrowserLink(item: ActionableItem): boolean {
    if (!item.href) return false;
    const href = item.href.trim().toLowerCase();
    if (
      href.startsWith("http:") ||
      href.startsWith("https:") ||
      href.startsWith("/") ||
      href.startsWith("#") ||
      href.startsWith("?")
    ) {
      return false;
    }
    // Anything with a scheme that isn't http/https is non-browser
    return /^[a-z][a-z0-9+.-]*:/i.test(href);
  }

  private buildClickTestInteraction(
    item: ActionableItem,
    startingPath: string,
    sizeClass: SizeClass,
    uid?: string,
    startingPageStateId?: number,
    dependencyTestInteractionId?: number
  ): GeneratedTestInteraction {
    const label = this.describeActionableItem(item);
    const replaySelector = buildReplaySelectorFromActionableItem(item);
    return {
      title: `Click ${label}`,
      type: "interaction",
      sizeClass,
      surface_tags: ["interaction", "click"],
      priority: 5,
      dependencyTestInteractionId,
      startingPageStateId,
      startingPath,
      steps: [
        {
          action: {
            actionType: PlaywrightAction.Click,
            path: replaySelector,
            playwrightCode: `await page.click('${replaySelector}')`,
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
        dependencyTestInteractionId,
        replaySelector
      ),
    };
  }

  private isHoverOnly(testInteraction: TestInteraction): boolean {
    const steps = Array.isArray(testInteraction.steps)
      ? testInteraction.steps
      : [];
    return (
      steps.length === 1 &&
      steps[0]?.action?.actionType === PlaywrightAction.Hover
    );
  }

  private isHoverBased(testInteraction: TestInteraction): boolean {
    const steps = Array.isArray(testInteraction.steps)
      ? testInteraction.steps
      : [];
    return (
      steps.length > 0 &&
      steps[0]?.action?.actionType === PlaywrightAction.Hover
    );
  }

  private getPrimarySelector(testInteraction: TestInteraction): string | null {
    const steps = Array.isArray(testInteraction.steps)
      ? testInteraction.steps
      : [];
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
    testInteraction: GeneratedTestInteraction,
    ...parts: Array<string | number | null | undefined>
  ): GeneratedTestInteraction {
    return {
      ...testInteraction,
      generatedKey: this.buildGeneratedKey(...parts),
    };
  }

  getGeneratedKey(
    testInteraction: Pick<GeneratedTestInteraction, "generatedKey" | "title">
  ): string {
    return (
      testInteraction.generatedKey?.trim() || testInteraction.title
    ).trim();
  }

  private getPersistedGeneratedKey(
    testInteraction: Pick<TestInteraction, "title"> & {
      generatedKey?: string | null;
    }
  ): string | null {
    const generatedKey = testInteraction.generatedKey?.trim();
    if (generatedKey) return generatedKey;
    const title = testInteraction.title?.trim();
    return title || null;
  }

  private buildGeneratedKey(
    ...parts: Array<string | number | null | undefined>
  ): string {
    const normalized = parts
      .map(part => (part == null ? "" : String(part).trim()))
      .filter(Boolean);
    const raw = normalized.join("||");
    const digest = createHash("sha256").update(raw).digest("hex").slice(0, 16);
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

  /**
   * Max representatives per action style.  Product grids can have dozens of
   * cards each producing a unique container fingerprint (because the product
   * title differs), but the CTA buttons ("ADD TO CART", "Select Options") are
   * functionally identical.  Capping per style prevents 14× duplicate hover
   * tests for the same button type across different cards.
   */
  private static readonly MAX_REPS_PER_STYLE = 2;

  selectRepresentativeItems(
    items: ActionableItem[],
    maxPerStyle: number = PageAnalyzer.MAX_REPS_PER_STYLE
  ): ActionableItem[] {
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

    // Cap per action style: when many different containers share the same
    // functional action (e.g. 14 product cards each with "ADD TO CART"),
    // keep at most maxPerStyle representatives per style.
    // Include passthrough items in the cap — items without a container
    // fingerprint (e.g. product links in a grid that wasn't detected as a
    // repeated container) should still be deduplicated by functional style.
    const allCandidates = [...passthrough, ...representatives];
    const byStyle = new Map<string, ActionableItem[]>();
    for (const rep of allCandidates) {
      const style = this.representativeActionStyle(rep);
      const bucket = byStyle.get(style) ?? [];
      bucket.push(rep);
      byStyle.set(style, bucket);
    }
    return Array.from(byStyle.values()).flatMap(group =>
      group.length <= maxPerStyle ? group : group.slice(0, maxPerStyle)
    );
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
}
