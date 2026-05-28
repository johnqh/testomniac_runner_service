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
  const surface = await api.ensureTestSurface(
    runnerId,
    {
      title: surfaceTitle,
      description: `Semantic multi-step journeys from ${context.currentPath}`,
      startingPageStateId: context.currentPageStateId,
      startingPath: context.currentPath,
      sizeClass: context.sizeClass,
      priority: 6,
      surface_tags: ["e2e", "semantic-journey"],
      uid: context.uid,
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
