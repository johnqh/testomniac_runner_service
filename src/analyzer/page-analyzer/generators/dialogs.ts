import type {
  BatchTestInteractionItem,
  TestInteraction,
} from "@sudobility/testomniac_types";
import type { AnalyzerContext } from "../types";

export async function generateDialogLifecycleTestInteractions(
  analyzer: any,
  context: AnalyzerContext
): Promise<void> {
  const surfaceTitle = `Dialogs: ${context.currentPath}`;
  if (!analyzer.pageHasOpenDialog(context.html)) {
    await analyzer.reconcileGeneratedSurfaceElements(context, {
      surfaceTitle,
      desiredKeys: [],
    });
    return;
  }

  const closeCandidates = analyzer.selectRepresentativeItems(
    context.actionableItems.filter(
      (item: any) =>
        item.visible &&
        !item.disabled &&
        item.selector &&
        analyzer.isDialogCloseItem(item)
    )
  );

  const tests: TestInteraction[] = [];
  for (const item of closeCandidates) {
    tests.push(
      analyzer.buildDialogCloseTestInteraction(
        item,
        context.currentPath,
        context.sizeClass,
        context.uid,
        context.currentPageStateId
      )
    );
  }
  tests.push(
    analyzer.buildEscapeDialogTestInteraction(
      context.currentPath,
      context.sizeClass,
      context.uid,
      context.currentPageStateId
    )
  );

  const { api, runnerId, testEnvironmentId, bundleRun } = context;
  const surface = await api.ensureTestSurface(
    runnerId,
    {
      title: surfaceTitle,
      description: `Dialog lifecycle checks for ${context.currentPath}`,
      startingPageStateId: context.currentPageStateId,
      startingPath: context.currentPath,
      sizeClass: context.sizeClass,
      priority: 4,
      surface_tags: ["dialog"],
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

  const desiredKeys = tests.map((test: TestInteraction) =>
    analyzer.getGeneratedKey(test)
  );
  const batchItems: BatchTestInteractionItem[] = tests.map(
    (test: TestInteraction) => ({
      runnerId,
      testSurfaceId: surface.id,
      testInteraction: test,
      testEnvironmentId,
      testSurfaceRunId: surfaceRun.id,
    })
  );
  if (batchItems.length > 0) {
    await api.ensureTestInteractionBatch(batchItems);
  }

  await analyzer.reconcileGeneratedSurfaceElements(context, {
    surfaceId: surface.id,
    surfaceTitle,
    desiredKeys,
  });
}
