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
  const surface = await api.ensureTestSurface(
    runnerId,
    {
      title: surfaceTitle,
      description: `Variant and option state checks for ${context.currentPath}`,
      startingPageStateId: context.currentPageStateId,
      startingPath: context.currentPath,
      sizeClass: context.sizeClass,
      priority: 2,
      surface_tags: ["variant", "option"],
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
