import type { AnalyzerContext } from "../types";

export async function generateKeyboardAndDisclosureTestElements(
  analyzer: any,
  context: AnalyzerContext
): Promise<void> {
  const tests = analyzer.buildKeyboardAndDisclosureTestElements(context);
  const surfaceTitle = `Keyboard: ${context.currentPath}`;
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
    description: `Keyboard parity and disclosure checks for ${context.currentPath}`,
    startingPageStateId: context.currentPageStateId,
    startingPath: context.currentPath,
    sizeClass: context.sizeClass,
    priority: 3,
    surface_tags: ["keyboard", "disclosure"],
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
