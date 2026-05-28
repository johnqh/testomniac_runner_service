import type { AnalyzerContext } from "../types";

export async function generateRenderTestInteractions(
  analyzer: any,
  context: AnalyzerContext
): Promise<void> {
  const { api, runnerId, testEnvironmentId, sizeClass, uid, bundleRun } =
    context;
  const surfaceTitle = `Render: ${context.currentPath}`;

  const { surface, surfaceRun } = await api.ensureTestSurfaceWithRun({
    runnerId,
    testEnvironmentId,
    testSurface: {
      title: surfaceTitle,
      description: `Render validation for ${context.currentPath}`,
      startingPageStateId: context.currentPageStateId,
      startingPath: context.currentPath,
      sizeClass,
      priority: 5,
      surface_tags: ["render"],
      uid,
    },
    testSurfaceBundleId: bundleRun.testSurfaceBundleId,
    testSurfaceBundleRunId: bundleRun.id,
  });
  analyzer.invalidateSurfacesCache();
  context.events.onTestSurfaceCreated({
    surfaceId: surface.id,
    title: surface.title,
  });

  const testInteraction = analyzer.buildRenderTestInteraction(
    context.currentPath,
    sizeClass,
    uid,
    context.currentPageStateId,
    context.pageId
  );
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

  await analyzer.reconcileGeneratedSurfaceElements(context, {
    surfaceId: surface.id,
    surfaceTitle,
    desiredKeys: [analyzer.getGeneratedKey(testInteraction)],
  });
}
