import type { AnalyzerContext } from "../types";

export async function generateScaffoldTestElements(
  analyzer: any,
  context: AnalyzerContext
): Promise<void> {
  const { api, runnerId, sizeClass, uid, bundleRun } = context;
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

    const desiredKeys: string[] = [];
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
      desiredKeys.push(analyzer.getGeneratedKey(testElement));
      const tc = await api.ensureTestElement(runnerId, surface.id, testElement);
      await api.createTestElementRun({
        testElementId: tc.id,
        testSurfaceRunId: surfaceRun.id,
      });
    }

    desiredKeysBySurface.set(surfaceTitle, desiredKeys);
    await analyzer.reconcileGeneratedSurfaceElements(context, {
      surfaceId: surface.id,
      surfaceTitle,
      desiredKeys,
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
      });
    }
  }

  for (const [surfaceTitle, desiredKeys] of desiredKeysBySurface) {
    if (desiredKeys.length > 0) continue;
    await analyzer.reconcileGeneratedSurfaceElements(context, {
      surfaceTitle,
      desiredKeys,
    });
  }
}
