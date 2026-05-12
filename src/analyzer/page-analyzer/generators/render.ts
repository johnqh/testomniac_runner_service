import type { AnalyzerContext } from "../types";

export async function generateRenderTestInteractions(
  analyzer: any,
  context: AnalyzerContext
): Promise<void> {
  const { api, runnerId, testEnvironmentId, sizeClass, uid, bundleRun } =
    context;
  const surfaceTitle = `Render: ${context.currentPath}`;

  const surface = await api.ensureTestSurface(
    runnerId,
    {
      title: surfaceTitle,
      description: `Render validation for ${context.currentPath}`,
      startingPageStateId: context.currentPageStateId,
      startingPath: context.currentPath,
      sizeClass,
      priority: 5,
      surface_tags: ["render"],
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
