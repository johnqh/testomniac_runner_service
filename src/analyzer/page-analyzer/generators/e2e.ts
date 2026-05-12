import type { AnalyzerContext } from "../types";

export async function generateE2ETestInteractions(
  analyzer: any,
  context: AnalyzerContext
): Promise<void> {
  const surfaceTitle = `Dependency Journeys: ${context.currentPath}`;
  if (context.journeySteps.length < 2) {
    await analyzer.reconcileGeneratedSurfaceElements(context, {
      surfaceTitle,
      desiredKeys: [],
    });
    return;
  }

  const { api, runnerId, testEnvironmentId, sizeClass, uid, bundleRun } =
    context;
  const surface = await api.ensureTestSurface(
    runnerId,
    {
      title: surfaceTitle,
      description: `Dependency-derived journeys reaching ${context.currentPath}`,
      startingPageStateId: context.currentPageStateId,
      startingPath: context.currentPath,
      sizeClass,
      priority: 2,
      surface_tags: ["e2e"],
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

  const e2e = analyzer.buildE2ETestInteraction(
    context.currentPath,
    sizeClass,
    uid,
    context.currentPageStateId,
    context.journeySteps
  );
  const tc = await api.ensureTestInteraction(
    runnerId,
    surface.id,
    e2e,
    testEnvironmentId
  );
  await api.createTestInteractionRun({
    testInteractionId: tc.id,
    testSurfaceRunId: surfaceRun.id,
  });

  await analyzer.reconcileGeneratedSurfaceElements(context, {
    surfaceId: surface.id,
    surfaceTitle,
    desiredKeys: [analyzer.getGeneratedKey(e2e)],
  });
}
