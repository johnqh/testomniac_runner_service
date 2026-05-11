import type { AnalyzerContext } from "../types";

export async function generateSemanticJourneyTestElements(
  analyzer: any,
  context: AnalyzerContext
): Promise<void> {
  const journeys = analyzer.buildSemanticJourneyTestElements(context);
  const surfaceTitle = `Journeys: ${context.currentPath}`;
  if (journeys.length === 0) {
    await analyzer.reconcileGeneratedSurfaceElements(context, {
      surfaceTitle,
      desiredKeys: [],
    });
    return;
  }

  const { api, runnerId, bundleRun } = context;
  const surface = await api.ensureTestSurface(runnerId, {
    title: surfaceTitle,
    description: `Semantic multi-step journeys from ${context.currentPath}`,
    startingPageStateId: context.currentPageStateId,
    startingPath: context.currentPath,
    sizeClass: context.sizeClass,
    priority: 2,
    surface_tags: ["e2e", "semantic-journey"],
    uid: context.uid,
  });
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

  for (const journey of journeys) {
    const tc = await api.ensureTestElement(runnerId, surface.id, journey);
    await api.createTestElementRun({
      testElementId: tc.id,
      testSurfaceRunId: surfaceRun.id,
    });
  }

  await analyzer.reconcileGeneratedSurfaceElements(context, {
    surfaceId: surface.id,
    surfaceTitle,
    desiredKeys: journeys.map((journey: any) =>
      analyzer.getGeneratedKey(journey)
    ),
  });
}
