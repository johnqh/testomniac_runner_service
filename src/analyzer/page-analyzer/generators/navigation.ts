import type { AnalyzerContext } from "../types";

export async function generateNavigationTestInteractions(
  analyzer: any,
  context: AnalyzerContext
): Promise<void> {
  await analyzer.reconcileGeneratedSurfaceElements(context, {
    surfaceId: context.navigationSurface.id,
    surfaceTitle: context.navigationSurface.title,
    desiredKeys: [],
  });
}
