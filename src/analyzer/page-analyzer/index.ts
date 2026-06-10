import type {
  TestInteraction,
  Expectation,
  ActionableItem,
  SizeClass,
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
 * PageAnalyzer provides finding dedup, expectation generation, and
 * hover-to-click transformation during discovery mode.
 *
 * Test generators have been moved server-side to testomniac_api.
 */
export class PageAnalyzer {
  private store: DedupStore;

  constructor(dedupStore?: DedupStore) {
    this.store = dedupStore ?? new InMemoryDedupStore();
  }

  private static normalizeFindingText(text: string): string {
    return text.replace(/^(\[[^\]]+\]\s*)\d+\s+/, "$1").replace(/^\d+\s+/, "");
  }

  hasReportedPageFinding(
    _path: string,
    title: string,
    description: string
  ): Promise<boolean> {
    const key = `${PageAnalyzer.normalizeFindingText(title)}\0${PageAnalyzer.normalizeFindingText(description)}`;
    return this.store.has("reportedPageFindings", key);
  }

  markPageFindingReported(
    _path: string,
    title: string,
    description: string
  ): Promise<void> {
    const key = `${PageAnalyzer.normalizeFindingText(title)}\0${PageAnalyzer.normalizeFindingText(description)}`;
    return this.store.add("reportedPageFindings", key);
  }

  hasReportedFindingByKey(key: string): Promise<boolean> {
    return this.store.has("reportedFindingKeys", key);
  }

  markReportedFindingByKey(key: string): Promise<void> {
    return this.store.add("reportedFindingKeys", key);
  }

  hasReportedDescription(description: string): Promise<boolean> {
    return this.store.has(
      "reportedDescriptions",
      PageAnalyzer.normalizeFindingText(description)
    );
  }

  markReportedDescription(description: string): Promise<void> {
    return this.store.add(
      "reportedDescriptions",
      PageAnalyzer.normalizeFindingText(description)
    );
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
