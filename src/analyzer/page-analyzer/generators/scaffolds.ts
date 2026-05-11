import type { AnalyzerContext } from "../types";

export async function generateScaffoldTestElements(
  analyzer: any,
  context: AnalyzerContext
): Promise<void> {
  const { api, runnerId, sizeClass, uid, bundleRun } = context;

  for (const scaffold of context.scaffolds) {
    const scaffoldItems = analyzer.selectRepresentativeItems(
      analyzer.getScaffoldSurfaceItems(context, scaffold)
    );
    if (scaffoldItems.length === 0) continue;

    const surfaceTitle = `Scaffold: ${scaffold.type}`;
    const surface = await api.ensureTestSurface(runnerId, {
      title: surfaceTitle,
      description: `Tests for ${scaffold.type} scaffold`,
      startingPageStateId: context.currentPageStateId,
      startingPath: context.currentPath,
      sizeClass,
      priority: 3,
      surface_tags: ["scaffold", scaffold.type],
      uid,
    });
    context.events.onTestSurfaceCreated({
      surfaceId: surface.id,
      title: surface.title,
    });

    await api.ensureBundleSurfaceLink(
      bundleRun.testSurfaceBundleId,
      surface.id
    );
    const surfaceRun = await analyzer.ensureSurfaceRun(
      api,
      surface.id,
      bundleRun.id
    );

    for (const item of scaffoldItems) {
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
      const tc = await api.ensureTestElement(runnerId, surface.id, testElement);
      await api.createTestElementRun({
        testElementId: tc.id,
        testSurfaceRunId: surfaceRun.id,
      });
    }
  }
}
