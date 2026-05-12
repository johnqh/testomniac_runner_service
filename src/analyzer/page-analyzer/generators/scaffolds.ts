import type { AnalyzerContext } from "../types";

export async function generateScaffoldTestInteractions(
  analyzer: any,
  context: AnalyzerContext
): Promise<void> {
  const { api, runnerId, testEnvironmentId, sizeClass, uid, bundleRun } =
    context;
  const processedSurfaceTitles = new Set<string>();
  const desiredKeysBySurface = new Map<string, string[]>();

  for (const scaffold of context.scaffolds) {
    const scaffoldItems = analyzer.selectRepresentativeItems(
      analyzer.getScaffoldSurfaceItems(context, scaffold)
    );

    const surfaceTitle = `Scaffold: ${scaffold.type}`;
    processedSurfaceTitles.add(surfaceTitle);
    if (scaffoldItems.length === 0) {
      desiredKeysBySurface.set(surfaceTitle, []);
      continue;
    }
    const surface = await api.ensureTestSurface(
      runnerId,
      {
        title: surfaceTitle,
        description: `Tests for ${scaffold.type} scaffold`,
        startingPageStateId: context.currentPageStateId,
        startingPath: context.currentPath,
        sizeClass,
        priority: 3,
        surface_tags: ["scaffold", scaffold.type],
        uid,
      },
      testEnvironmentId
    );
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

    const desiredKeys: string[] = [];
    for (const item of scaffoldItems) {
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

    desiredKeysBySurface.set(surfaceTitle, desiredKeys);
    await analyzer.reconcileGeneratedSurfaceElements(context, {
      surfaceId: surface.id,
      surfaceTitle,
      desiredKeys,
      dependencyTestInteractionId: context.currentTestInteractionId,
    });
  }

  const existingSurfaces = await api.getTestSurfacesByRunner(runnerId);
  for (const surface of existingSurfaces.filter((item: any) =>
    item.title.startsWith("Scaffold: ")
  )) {
    if (!processedSurfaceTitles.has(surface.title)) {
      await analyzer.reconcileGeneratedSurfaceElements(context, {
        surfaceId: surface.id,
        surfaceTitle: surface.title,
        desiredKeys: [],
        dependencyTestInteractionId: context.currentTestInteractionId,
      });
    }
  }

  for (const [surfaceTitle, desiredKeys] of desiredKeysBySurface) {
    if (desiredKeys.length > 0) continue;
    await analyzer.reconcileGeneratedSurfaceElements(context, {
      surfaceTitle,
      desiredKeys,
      dependencyTestInteractionId: context.currentTestInteractionId,
    });
  }
}
