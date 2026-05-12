import type { TestInteraction } from "@sudobility/testomniac_types";
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
    context.actionableItems.find(item => item.selector === selector) ?? null;
  const startingItem =
    beginningItems.find(item => item.selector === selector) ?? null;
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
    const clickCase = analyzer.buildClickTestInteraction(
      stableHoveredItem,
      context.currentPath,
      context.sizeClass,
      context.uid,
      context.currentPageStateId,
      context.currentTestInteractionId
    );
    console.info("[PageAnalyzer][hover-follow-up] generating-click", {
      testInteractionId: context.currentTestInteractionId,
      sourceTitle: testInteraction.title,
      selector,
      generatedKey: analyzer.getGeneratedKey(clickCase),
      clickTitle: clickCase.title,
      currentPageStateId: context.currentPageStateId,
      beginningPageStateId: context.beginningPageStateId,
      stayedOnSamePageState,
      revealedItemsCount: revealedItems.length,
    });
    await analyzer.reconcileGeneratedSurfaceElements(context, {
      surfaceId: context.currentTestSurfaceId,
      surfaceTitle: "",
      desiredKeys: [analyzer.getGeneratedKey(clickCase)],
      dependencyTestInteractionId: context.currentTestInteractionId,
    });
    const tc = await context.api.ensureTestInteraction(
      context.runnerId,
      context.currentTestSurfaceId,
      clickCase,
      context.testEnvironmentId
    );
    await context.api.createTestInteractionRun({
      testInteractionId: tc.id,
      testSurfaceRunId: context.currentSurfaceRunId ?? undefined,
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

  for (const item of revealedItems) {
    const nextHover = analyzer.buildHoverTestInteraction(
      item,
      context.currentPath,
      context.sizeClass,
      context.uid,
      context.currentPageStateId,
      context.currentTestInteractionId
    );
    const tc = await context.api.ensureTestInteraction(
      context.runnerId,
      context.currentTestSurfaceId,
      nextHover,
      context.testEnvironmentId
    );
    await context.api.createTestInteractionRun({
      testInteractionId: tc.id,
      testSurfaceRunId: context.currentSurfaceRunId ?? undefined,
    });
  }
}
