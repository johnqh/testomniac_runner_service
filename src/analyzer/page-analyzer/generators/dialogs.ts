import type { TestElement } from "@sudobility/testomniac_types";
import type { AnalyzerContext } from "../types";

export async function generateDialogLifecycleTestElements(
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

  const tests: TestElement[] = [];
  for (const item of closeCandidates) {
    tests.push(
      analyzer.buildDialogCloseTestElement(
        item,
        context.currentPath,
        context.sizeClass,
        context.uid,
        context.currentPageStateId
      )
    );
  }
  tests.push(
    analyzer.buildEscapeDialogTestElement(
      context.currentPath,
      context.sizeClass,
      context.uid,
      context.currentPageStateId
    )
  );

  const { api, runnerId, bundleRun } = context;
  const surface = await api.ensureTestSurface(runnerId, {
    title: surfaceTitle,
    description: `Dialog lifecycle checks for ${context.currentPath}`,
    startingPageStateId: context.currentPageStateId,
    startingPath: context.currentPath,
    sizeClass: context.sizeClass,
    priority: 2,
    surface_tags: ["dialog"],
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

  const desiredKeys = tests.map((test: TestElement) =>
    analyzer.getGeneratedKey(test)
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
    desiredKeys,
  });
}
