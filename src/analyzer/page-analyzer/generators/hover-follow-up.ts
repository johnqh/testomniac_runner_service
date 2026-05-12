import type { TestElement } from "@sudobility/testomniac_types";
import type { AnalyzerContext } from "../types";

export async function generateHoverFollowUpCases(
  analyzer: any,
  testElement: TestElement,
  context: AnalyzerContext
): Promise<void> {
  const selector = analyzer.getPrimarySelector(testElement);
  if (!selector || !context.currentPageStateId) return;

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

  if (revealedItems.length === 0 && hoveredItem) {
    const clickCase = analyzer.buildClickTestElement(
      hoveredItem,
      context.currentPath,
      context.sizeClass,
      context.uid,
      context.currentPageStateId,
      context.currentTestElementId
    );
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
