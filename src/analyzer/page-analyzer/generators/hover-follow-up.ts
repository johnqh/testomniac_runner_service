import type {
  BatchTestInteractionItem,
  TestInteraction,
} from "@sudobility/testomniac_types";
import { matchesActionableItemSelector } from "../../../browser/replay-selector";
import { computeActionableHash } from "../../../browser/page-utils";
import type { AnalyzerContext } from "../types";

export async function generateHoverFollowUpCases(
  analyzer: any,
  testInteraction: TestInteraction,
  context: AnalyzerContext
): Promise<void> {
  const selector = analyzer.getPrimarySelector(testInteraction);
  if (!selector || !context.currentPageStateId) {
    console.info("[PageAnalyzer][hover-follow-up] skipped", {
      reason: !selector ? "missing-selector" : "missing-current-page-state",
      testInteractionId: context.currentTestInteractionId,
      title: testInteraction.title,
      selector,
      currentPageStateId: context.currentPageStateId,
      beginningPageStateId: context.beginningPageStateId,
      currentPath: context.currentPath,
    });
    return;
  }

  const beginningItems =
    context.beginningPageStateId > 0
      ? await context.api.getItemsByPageState(context.beginningPageStateId)
      : [];
  const beginningKeys = new Set(
    beginningItems.map(item => analyzer.getItemKey(item)).filter(Boolean)
  );

  const revealedItems = analyzer.selectRepresentativeItems(
    context.actionableItems.filter((item: any) => {
      if (!analyzer.isMouseActionable(item)) return false;
      const key = analyzer.getItemKey(item);
      return Boolean(key) && !beginningKeys.has(key);
    })
  );

  const hoveredItem =
    context.actionableItems.find(item =>
      matchesActionableItemSelector(selector, item)
    ) ?? null;
  const startingItem =
    beginningItems.find(item =>
      matchesActionableItemSelector(selector, item)
    ) ?? null;
  const stableHoveredItem = hoveredItem ?? startingItem;
  const stayedOnSamePageState =
    context.beginningPageStateId > 0 &&
    context.currentPageStateId === context.beginningPageStateId;

  console.info("[PageAnalyzer][hover-follow-up] evaluated", {
    testInteractionId: context.currentTestInteractionId,
    title: testInteraction.title,
    selector,
    currentPath: context.currentPath,
    currentPageStateId: context.currentPageStateId,
    beginningPageStateId: context.beginningPageStateId,
    stayedOnSamePageState,
    beginningItemsCount: beginningItems.length,
    actionableItemsCount: context.actionableItems.length,
    revealedItemsCount: revealedItems.length,
    hasHoveredItem: Boolean(hoveredItem),
    hasStartingItem: Boolean(startingItem),
    hasStableHoveredItem: Boolean(stableHoveredItem),
  });

  if (
    (stayedOnSamePageState || revealedItems.length === 0) &&
    stableHoveredItem
  ) {
    console.info(
      "[PageAnalyzer][hover-follow-up] inline-click-already-required",
      {
        testInteractionId: context.currentTestInteractionId,
        sourceTitle: testInteraction.title,
        selector,
        currentPageStateId: context.currentPageStateId,
        beginningPageStateId: context.beginningPageStateId,
        stayedOnSamePageState,
        revealedItemsCount: revealedItems.length,
      }
    );
    await analyzer.reconcileGeneratedSurfaceElements(context, {
      surfaceId: context.currentTestSurfaceId,
      surfaceTitle: "",
      desiredKeys: [],
      dependencyTestInteractionId: context.currentTestInteractionId,
    });
    return;
  }

  // Skip follow-up generation if this page path was already generated for in
  // this run (the analyzer instance tracks covered paths per run)
  const currentPath = context.currentPath.trim();
  const pageAlreadyCovered = await analyzer.hasGeneratedForPath(currentPath);
  if (pageAlreadyCovered) {
    console.info("[PageAnalyzer][hover-follow-up] page-already-covered", {
      testInteractionId: context.currentTestInteractionId,
      sourceTitle: testInteraction.title,
      currentPath,
      currentPageStateId: context.currentPageStateId,
    });
    await analyzer.reconcileGeneratedSurfaceElements(context, {
      surfaceId: context.currentTestSurfaceId,
      surfaceTitle: "",
      desiredKeys: [],
      dependencyTestInteractionId: context.currentTestInteractionId,
    });
    return;
  }

  // Skip if a different path already produced the same interactive elements.
  // Note: we check the hash but don't register it — registration happens in
  // the full generateTestInteractions pass.  Registering here would
  // incorrectly block full generation for a page reached via non-hover.
  const actionableHash = await computeActionableHash(context.actionableItems);
  if (await analyzer.hasGeneratedForActionableHash(actionableHash)) {
    console.info(
      "[PageAnalyzer][hover-follow-up] actionable-items-already-covered",
      {
        testInteractionId: context.currentTestInteractionId,
        sourceTitle: testInteraction.title,
        currentPath,
        actionableHash,
      }
    );
    await analyzer.reconcileGeneratedSurfaceElements(context, {
      surfaceId: context.currentTestSurfaceId,
      surfaceTitle: "",
      desiredKeys: [],
      dependencyTestInteractionId: context.currentTestInteractionId,
    });
    return;
  }

  console.info("[PageAnalyzer][hover-follow-up] generating-hover-follow-ups", {
    testInteractionId: context.currentTestInteractionId,
    sourceTitle: testInteraction.title,
    selector,
    currentPageStateId: context.currentPageStateId,
    beginningPageStateId: context.beginningPageStateId,
    stayedOnSamePageState,
    revealedItemsCount: revealedItems.length,
    revealedSelectors: revealedItems
      .map((item: any) => item.selector)
      .filter(Boolean)
      .slice(0, 10),
  });

  const desiredKeys = revealedItems.map((item: any) =>
    analyzer.getGeneratedKey(
      analyzer.buildHoverTestInteraction(
        item,
        context.currentPath,
        context.sizeClass,
        context.uid,
        context.currentPageStateId,
        context.currentTestInteractionId
      )
    )
  );
  await analyzer.reconcileGeneratedSurfaceElements(context, {
    surfaceId: context.currentTestSurfaceId,
    surfaceTitle: "",
    desiredKeys,
    dependencyTestInteractionId: context.currentTestInteractionId,
  });

  const batchItems: BatchTestInteractionItem[] = [];
  for (const item of revealedItems) {
    const nextHover = analyzer.buildHoverTestInteraction(
      item,
      context.currentPath,
      context.sizeClass,
      context.uid,
      context.currentPageStateId,
      context.currentTestInteractionId
    );
    batchItems.push({
      runnerId: context.runnerId,
      testSurfaceId: context.currentTestSurfaceId,
      testInteraction: nextHover,
      testEnvironmentId: context.testEnvironmentId,
      testSurfaceRunId: context.currentSurfaceRunId ?? 0,
    });
  }
  if (batchItems.length > 0) {
    await context.api.ensureTestInteractionBatch(batchItems);
  }
}
