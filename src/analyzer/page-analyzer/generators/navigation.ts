import type { AnalyzerContext } from "../types";

export async function generateNavigationTestElements(
  analyzer: any,
  context: AnalyzerContext
): Promise<void> {
  if (context.pageRequiresLogin) {
    await analyzer.reconcileGeneratedSurfaceElements(context, {
      surfaceId: context.navigationSurface.id,
      surfaceTitle: context.navigationSurface.title,
      desiredKeys: [],
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

  const desiredKeys: string[] = [];
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
    desiredKeys.push(analyzer.getGeneratedKey(testElement));
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
    desiredKeys,
  });
}
