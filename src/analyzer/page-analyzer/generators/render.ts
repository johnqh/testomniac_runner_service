import type { AnalyzerContext } from "../types";

export async function generateRenderTestElements(
  analyzer: any,
  context: AnalyzerContext
): Promise<void> {
  const { api, runnerId, sizeClass, uid, bundleRun } = context;

  const surface = await api.ensureTestSurface(runnerId, {
    title: `Render: ${context.currentPath}`,
    description: `Render validation for ${context.currentPath}`,
    startingPageStateId: context.currentPageStateId,
    startingPath: context.currentPath,
    sizeClass,
    priority: 2,
    surface_tags: ["render"],
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

  const testElement = analyzer.buildRenderTestElement(
    context.currentPath,
    sizeClass,
    uid,
    context.currentPageStateId,
    context.pageId
  );
  const tc = await api.ensureTestElement(runnerId, surface.id, testElement);
  await api.createTestElementRun({
    testElementId: tc.id,
    testSurfaceRunId: surfaceRun.id,
  });
}
