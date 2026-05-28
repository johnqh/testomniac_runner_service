import type { BatchTestInteractionItem } from "@sudobility/testomniac_types";
import { buildReplaySelectorFromActionableItem } from "../../../browser/replay-selector";
import type { AnalyzerContext } from "../types";

export async function generateContentTestInteractions(
  analyzer: any,
  context: AnalyzerContext
): Promise<void> {
  const { api, runnerId, testEnvironmentId, sizeClass, uid, bundleRun } =
    context;

  const contentItems = analyzer.selectRepresentativeItems(
    context.actionableItems.filter(
      (item: any) =>
        item.scaffoldId == null && analyzer.isSurfaceCandidate(item)
    )
  );
  const surfaceTitle = `Page: ${context.currentPath}`;
  if (contentItems.length === 0) {
    await analyzer.reconcileGeneratedSurfaceElements(context, {
      surfaceTitle,
      desiredKeys: [],
      dependencyTestInteractionId: context.currentTestInteractionId,
    });
    return;
  }
  const surface = await api.ensureTestSurface(
    runnerId,
    {
      title: surfaceTitle,
      description: `Tests for page content at ${context.currentPath}`,
      startingPageStateId: context.currentPageStateId,
      startingPath: context.currentPath,
      sizeClass,
      priority: 1,
      surface_tags: ["page-content"],
      uid,
    },
    testEnvironmentId
  );
  context.events.onTestSurfaceCreated({
    surfaceId: surface.id,
    title: surface.title,
  });

  await api.ensureBundleSurfaceLink(bundleRun.testSurfaceBundleId, surface.id);
  const surfaceRun = await analyzer.ensureSurfaceRun(
    api,
    surface.id,
    bundleRun.id
  );

  const desiredKeys: string[] = [];
  const batchItems: BatchTestInteractionItem[] = [];
  for (const item of contentItems) {
    // Skip interactions for shared layout elements already tested under
    // a different URL variant of the same base path.
    const replaySelector = buildReplaySelectorFromActionableItem(item);
    const actionType = analyzer.shouldUseDirectControlInteraction(item)
      ? "control"
      : "hover";
    if (
      await analyzer.hasGeneratedSelectorForBasePath(
        context.currentPath,
        actionType,
        replaySelector
      )
    ) {
      continue;
    }

    const testInteraction =
      actionType === "control"
        ? analyzer.buildControlInteractionTestInteraction(
            item,
            context.currentPath,
            sizeClass,
            uid,
            context.currentPageStateId,
            context.currentTestInteractionId
          )
        : analyzer.buildHoverTestInteraction(
            item,
            context.currentPath,
            sizeClass,
            uid,
            context.currentPageStateId,
            context.currentTestInteractionId
          );
    desiredKeys.push(analyzer.getGeneratedKey(testInteraction));
    batchItems.push({
      runnerId,
      testSurfaceId: surface.id,
      testInteraction,
      testEnvironmentId,
      testSurfaceRunId: surfaceRun.id,
    });
    await analyzer.markGeneratedSelectorForBasePath(
      context.currentPath,
      actionType,
      replaySelector
    );
  }
  if (batchItems.length > 0) {
    await api.ensureTestInteractionBatch(batchItems);
  }

  await analyzer.reconcileGeneratedSurfaceElements(context, {
    surfaceId: surface.id,
    surfaceTitle,
    desiredKeys,
    dependencyTestInteractionId: context.currentTestInteractionId,
  });
}
