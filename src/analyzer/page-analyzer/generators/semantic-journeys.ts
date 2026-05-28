import type { BatchTestInteractionItem } from "@sudobility/testomniac_types";
import type { AnalyzerContext } from "../types";

export async function generateSemanticJourneyTestInteractions(
  analyzer: any,
  context: AnalyzerContext
): Promise<void> {
  const journeys = analyzer.buildSemanticJourneyTestInteractions(context);
  const surfaceTitle = `Journeys: ${context.currentPath}`;
  if (journeys.length === 0) {
    await analyzer.reconcileGeneratedSurfaceElements(context, {
      surfaceTitle,
      desiredKeys: [],
    });
    return;
  }

  const { api, runnerId, testEnvironmentId, bundleRun } = context;
  const { surface, surfaceRun } = await api.ensureTestSurfaceWithRun({
    runnerId,
    testEnvironmentId,
    testSurface: {
      title: surfaceTitle,
      description: `Semantic multi-step journeys from ${context.currentPath}`,
      startingPageStateId: context.currentPageStateId,
      startingPath: context.currentPath,
      sizeClass: context.sizeClass,
      priority: 6,
      surface_tags: ["e2e", "semantic-journey"],
      uid: context.uid,
    },
    testSurfaceBundleId: bundleRun.testSurfaceBundleId,
    testSurfaceBundleRunId: bundleRun.id,
  });
  analyzer.invalidateSurfacesCache();
  context.events.onTestSurfaceCreated({
    surfaceId: surface.id,
    title: surface.title,
  });

  const batchItems: BatchTestInteractionItem[] = journeys.map(
    (journey: any) => ({
      runnerId,
      testSurfaceId: surface.id,
      testInteraction: journey,
      testEnvironmentId,
      testSurfaceRunId: surfaceRun.id,
    })
  );
  if (batchItems.length > 0) {
    await api.ensureTestInteractionBatch(batchItems);
  }

  await analyzer.reconcileGeneratedSurfaceElements(context, {
    surfaceId: surface.id,
    surfaceTitle,
    desiredKeys: journeys.map((journey: any) =>
      analyzer.getGeneratedKey(journey)
    ),
  });
}
