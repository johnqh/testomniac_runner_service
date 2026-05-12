import type { AnalyzerContext } from "../types";

export async function generateContentTestElements(
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
      priority: 3,
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
    const testElement = analyzer.shouldUseDirectControlInteraction(item)
      ? analyzer.buildControlInteractionTestElement(
          item,
          context.currentPath,
          sizeClass,
          uid,
          context.currentPageStateId
        )
      : analyzer.buildHoverTestElement(
          item,
          context.currentPath,
          sizeClass,
          uid,
          context.currentPageStateId
        );
    desiredKeys.push(analyzer.getGeneratedKey(testElement));
    const tc = await api.ensureTestElement(
      runnerId,
      surface.id,
      testElement,
      testEnvironmentId
    );
    await api.createTestElementRun({
      testElementId: tc.id,
      testSurfaceRunId: surfaceRun.id,
    });
  }

  await analyzer.reconcileGeneratedSurfaceElements(context, {
    surfaceId: surface.id,
    surfaceTitle,
    desiredKeys,
  });
}
