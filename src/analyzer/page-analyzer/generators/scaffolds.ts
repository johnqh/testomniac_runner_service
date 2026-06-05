import type {
  GeneratorOutput,
  GeneratorSurfaceOutput,
  GeneratorReconcileOutput,
  GenerateSurfaceInteractionItem,
} from "@sudobility/testomniac_types";
import type { AnalyzerContext } from "../types";

export async function generateScaffoldTestInteractions(
  analyzer: any,
  context: AnalyzerContext
): Promise<GeneratorOutput> {
  const { api, runnerId, testEnvironmentId, sizeClass, uid } = context;
  const processedSurfaceTitles = new Set<string>();
  const creates: GeneratorSurfaceOutput[] = [];
  const reconciles: GeneratorReconcileOutput[] = [];

  for (const scaffold of context.scaffolds) {
    const scaffoldItems = analyzer.selectRepresentativeItems(
      analyzer.getScaffoldSurfaceItems(context, scaffold)
    );

    const surfaceTitle = `Scaffold: ${scaffold.type}`;
    processedSurfaceTitles.add(surfaceTitle);
    if (scaffoldItems.length === 0) {
      // Empty scaffold — reconcile-only with no desired keys
      reconciles.push({
        surfaceTitle,
        desiredKeys: [],
        dependencyTestInteractionId: context.currentTestInteractionId,
      });
      continue;
    }

    const desiredKeys: string[] = [];
    const batchItems: GenerateSurfaceInteractionItem[] = [];
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
      batchItems.push({
        runnerId,
        testSurfaceId: 0,
        testInteraction,
        testEnvironmentId,
      });
    }

    creates.push({
      testSurface: {
        title: surfaceTitle,
        description: `Tests for ${scaffold.type} scaffold`,
        startingPageStateId: context.currentPageStateId,
        startingPath: context.currentPath,
        sizeClass,
        priority: 3,
        surface_tags: ["scaffold", scaffold.type],
        uid,
      },
      interactions: batchItems,
      desiredKeys,
      dependencyTestInteractionId: context.currentTestInteractionId,
    });
  }

  // Find existing scaffold surfaces not present on the current page and
  // add reconcile-only entries so their stale interactions get retired.
  const existingSurfaces = await api.getTestSurfacesByRunner(runnerId);
  for (const surface of existingSurfaces.filter((item: any) =>
    item.title.startsWith("Scaffold: ")
  )) {
    if (!processedSurfaceTitles.has(surface.title)) {
      reconciles.push({
        surfaceTitle: surface.title,
        surfaceId: surface.id,
        desiredKeys: [],
        dependencyTestInteractionId: context.currentTestInteractionId,
      });
    }
  }

  return { creates, reconciles };
}
