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
  for (const item of contentItems) {
    const testInteraction = analyzer.shouldUseDirectControlInteraction(item)
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
    const tc = await api.ensureTestInteraction(
      runnerId,
      surface.id,
      testInteraction,
      testEnvironmentId
    );
    await api.createTestInteractionRun({
      testInteractionId: tc.id,
      testSurfaceRunId: surfaceRun.id,
    });
  }

  await analyzer.reconcileGeneratedSurfaceElements(context, {
    surfaceId: surface.id,
    surfaceTitle,
    desiredKeys,
    dependencyTestInteractionId: context.currentTestInteractionId,
  });
}
