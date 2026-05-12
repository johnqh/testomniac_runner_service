import type { TestElement } from "@sudobility/testomniac_types";
import type { AnalyzerContext } from "../types";

export async function generateHoverFollowUpCases(
  analyzer: any,
  testElement: TestElement,
  context: AnalyzerContext
): Promise<void> {
  const selector = analyzer.getPrimarySelector(testElement);
  if (!selector || !context.currentPageStateId) {
    console.info("[PageAnalyzer][hover-follow-up] skipped", {
      reason: !selector ? "missing-selector" : "missing-current-page-state",
      testElementId: context.currentTestElementId,
      title: testElement.title,
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
    testElementId: context.currentTestElementId,
    title: testElement.title,
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
    const clickCase = analyzer.buildClickTestElement(
      stableHoveredItem,
      context.currentPath,
      context.sizeClass,
      context.uid,
      context.currentPageStateId,
      context.currentTestElementId
    );
    console.info("[PageAnalyzer][hover-follow-up] generating-click", {
      testElementId: context.currentTestElementId,
      sourceTitle: testElement.title,
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
      dependencyTestElementId: context.currentTestElementId,
    });
    const tc = await context.api.ensureTestElement(
      context.runnerId,
      context.currentTestSurfaceId,
      clickCase,
      context.testEnvironmentId
    );
    await context.api.createTestElementRun({
      testElementId: tc.id,
      testSurfaceRunId: context.currentSurfaceRunId ?? undefined,
    });
    return;
  }

  console.info("[PageAnalyzer][hover-follow-up] generating-hover-follow-ups", {
    testElementId: context.currentTestElementId,
    sourceTitle: testElement.title,
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
      analyzer.buildHoverTestElement(
        item,
        context.currentPath,
        context.sizeClass,
        context.uid,
        context.currentPageStateId,
        context.currentTestElementId
      )
    )
  );
  await analyzer.reconcileGeneratedSurfaceElements(context, {
    surfaceId: context.currentTestSurfaceId,
    surfaceTitle: "",
    desiredKeys,
    dependencyTestElementId: context.currentTestElementId,
  });

  for (const item of revealedItems) {
    const nextHover = analyzer.buildHoverTestElement(
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
      nextHover,
      context.testEnvironmentId
    );
    await context.api.createTestElementRun({
      testElementId: tc.id,
      testSurfaceRunId: context.currentSurfaceRunId ?? undefined,
    });
  }
}
