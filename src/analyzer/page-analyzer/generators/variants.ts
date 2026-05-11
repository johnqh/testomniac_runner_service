import type { AnalyzerContext } from "../types";

export async function generateVariantTestElements(
  analyzer: any,
  context: AnalyzerContext
): Promise<void> {
  const tests = analyzer.buildVariantTestElements(context);
  const surfaceTitle = `Variants: ${context.currentPath}`;
  if (tests.length === 0) {
    await analyzer.reconcileGeneratedSurfaceElements(context, {
      surfaceTitle,
      desiredKeys: [],
    });
    return;
  }

  const { api, runnerId, bundleRun } = context;
  const surface = await api.ensureTestSurface(runnerId, {
    title: surfaceTitle,
    description: `Variant and option state checks for ${context.currentPath}`,
    startingPageStateId: context.currentPageStateId,
    startingPath: context.currentPath,
    sizeClass: context.sizeClass,
    priority: 2,
    surface_tags: ["variant", "option"],
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

  for (const test of tests) {
    const tc = await api.ensureTestElement(runnerId, surface.id, test);
    await api.createTestElementRun({
      testElementId: tc.id,
      testSurfaceRunId: surfaceRun.id,
    });
  }

  await analyzer.reconcileGeneratedSurfaceElements(context, {
    surfaceId: surface.id,
    surfaceTitle,
    desiredKeys: tests.map((test: any) => analyzer.getGeneratedKey(test)),
  });
}
