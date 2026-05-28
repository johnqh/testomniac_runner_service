import type { BatchTestInteractionItem } from "@sudobility/testomniac_types";
import type { AnalyzerContext } from "../types";

export async function generateVariantTestInteractions(
  analyzer: any,
  context: AnalyzerContext
): Promise<void> {
  const allTests = analyzer.buildVariantTestInteractions(context);

  // Filter out interactions whose replay selector was already generated
  // under a different URL variant of the same base path.
  const tests: any[] = [];
  for (const test of allTests) {
    const selector = test.steps?.[0]?.action?.path;
    const actionType = test.steps?.[0]?.action?.actionType;
    if (!selector || !actionType) {
      tests.push(test);
      continue;
    }
    const alreadyGenerated = await analyzer.hasGeneratedSelectorForBasePath(
      context.currentPath,
      actionType,
      selector
    );
    if (!alreadyGenerated) {
      tests.push(test);
    }
  }

  const surfaceTitle = `Variants: ${context.currentPath}`;
  if (tests.length === 0) {
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
      description: `Variant and option state checks for ${context.currentPath}`,
      startingPageStateId: context.currentPageStateId,
      startingPath: context.currentPath,
      sizeClass: context.sizeClass,
      priority: 2,
      surface_tags: ["variant", "option"],
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

  const batchItems: BatchTestInteractionItem[] = [];
  for (const test of tests) {
    batchItems.push({
      runnerId,
      testSurfaceId: surface.id,
      testInteraction: test,
      testEnvironmentId,
      testSurfaceRunId: surfaceRun.id,
    });

    const selector = test.steps?.[0]?.action?.path;
    const actionType = test.steps?.[0]?.action?.actionType;
    if (selector && actionType) {
      await analyzer.markGeneratedSelectorForBasePath(
        context.currentPath,
        actionType,
        selector
      );
    }
  }
  if (batchItems.length > 0) {
    await api.ensureTestInteractionBatch(batchItems);
  }

  await analyzer.reconcileGeneratedSurfaceElements(context, {
    surfaceId: surface.id,
    surfaceTitle,
    desiredKeys: tests.map((test: any) => analyzer.getGeneratedKey(test)),
  });
}
