import type { AnalyzerContext } from "../types";

export async function generateNavigationTestElements(
  analyzer: any,
  context: AnalyzerContext
): Promise<void> {
  if (context.pageRequiresLogin) {
    await analyzer.reconcileGeneratedSurfaceElements(context, {
      surfaceId: context.navigationSurface.id,
      surfaceTitle: context.navigationSurface.title,
      desiredTitles: [],
    });
    return;
  }

  const { api, runnerId, sizeClass, uid, navigationSurface, bundleRun } =
    context;
  const links = analyzer.selectRepresentativeItems(
    context.actionableItems.filter(
      (item: any) => item.actionKind === "navigate" && item.href && item.visible
    )
  );

  await api.ensureBundleSurfaceLink(
    bundleRun.testSurfaceBundleId,
    navigationSurface.id
  );

  const surfaceRun = await analyzer.ensureSurfaceRun(
    api,
    navigationSurface.id,
    bundleRun.id
  );

  const desiredTitles: string[] = [];
  for (const link of links) {
    if (!link.href) continue;
    const path = analyzer.extractRelativePath(link.href);
    if (!path) continue;

    const testElement = analyzer.buildNavigationTestElement(
      path,
      sizeClass,
      uid,
      context.currentPageStateId
    );
    desiredTitles.push(testElement.title);
    const tc = await api.ensureTestElement(
      runnerId,
      navigationSurface.id,
      testElement
    );
    await api.createTestElementRun({
      testElementId: tc.id,
      testSurfaceRunId: surfaceRun.id,
    });
  }

  await analyzer.reconcileGeneratedSurfaceElements(context, {
    surfaceId: navigationSurface.id,
    surfaceTitle: navigationSurface.title,
    desiredTitles,
  });
}
