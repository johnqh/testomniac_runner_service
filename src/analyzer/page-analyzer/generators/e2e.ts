import type { AnalyzerContext } from "../types";

export async function generateE2ETestElements(
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

  const { api, runnerId, sizeClass, uid, bundleRun } = context;
  const surface = await api.ensureTestSurface(runnerId, {
    title: surfaceTitle,
    description: `Dependency-derived journeys reaching ${context.currentPath}`,
    startingPageStateId: context.currentPageStateId,
    startingPath: context.currentPath,
    sizeClass,
    priority: 2,
    surface_tags: ["e2e"],
    uid,
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

  const e2e = analyzer.buildE2ETestElement(
    context.currentPath,
    sizeClass,
    uid,
    context.currentPageStateId,
    context.journeySteps
  );
  const tc = await api.ensureTestElement(runnerId, surface.id, e2e);
  await api.createTestElementRun({
    testElementId: tc.id,
    testSurfaceRunId: surfaceRun.id,
  });

  await analyzer.reconcileGeneratedSurfaceElements(context, {
    surfaceId: surface.id,
    surfaceTitle,
    desiredKeys: [analyzer.getGeneratedKey(e2e)],
  });
}
