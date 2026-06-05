import type {
  GeneratorOutput,
  GenerateSurfaceInteractionItem,
} from "@sudobility/testomniac_types";
import { buildReplaySelectorFromActionableItem } from "../../../browser/replay-selector";
import type { AnalyzerContext } from "../types";

export async function generateContentTestInteractions(
  analyzer: any,
  context: AnalyzerContext
): Promise<GeneratorOutput> {
  const { runnerId, testEnvironmentId, sizeClass, uid } = context;

  const contentItems = analyzer.selectRepresentativeItems(
    context.actionableItems.filter(
      (item: any) =>
        item.scaffoldId == null && analyzer.isSurfaceCandidate(item)
    )
  );
  const surfaceTitle = `Page: ${context.currentPath}`;
  if (contentItems.length === 0) {
    return {
      creates: [],
      reconciles: [
        {
          surfaceTitle,
          desiredKeys: [],
          dependencyTestInteractionId: context.currentTestInteractionId,
        },
      ],
    };
  }
  const desiredKeys: string[] = [];
  const batchItems: GenerateSurfaceInteractionItem[] = [];
  for (const item of contentItems) {
    // Skip interactions for shared layout elements already tested under
    // a different URL variant of the same base path.
    const replaySelector = buildReplaySelectorFromActionableItem(item);
    const actionType = analyzer.shouldUseDirectControlInteraction(item)
      ? "control"
      : "hover";
    if (
      await analyzer.hasGeneratedSelectorForBasePath(
        context.currentPath,
        actionType,
        replaySelector
      )
    ) {
      continue;
    }

    const testInteraction =
      actionType === "control"
        ? analyzer.buildControlInteractionTestInteraction(
            item,
            context.currentPath,
            sizeClass,
            uid,
            context.currentPageStateId,
            context.currentTestInteractionId
          )
        : analyzer.buildHoverTestInteraction(
            item,
            context.currentPath,
            sizeClass,
            uid,
            context.currentPageStateId,
            context.currentTestInteractionId
          );
    desiredKeys.push(analyzer.getGeneratedKey(testInteraction));
    batchItems.push({
      runnerId,
      testSurfaceId: 0,
      testInteraction,
      testEnvironmentId,
    });
    await analyzer.markGeneratedSelectorForBasePath(
      context.currentPath,
      actionType,
      replaySelector
    );
  }

  return {
    creates: [
      {
        testSurface: {
          title: surfaceTitle,
          description: `Tests for page content at ${context.currentPath}`,
          startingPageStateId: context.currentPageStateId,
          startingPath: context.currentPath,
          sizeClass,
          priority: 1,
          surface_tags: ["page-content"],
          uid,
        },
        interactions: batchItems,
        desiredKeys,
        dependencyTestInteractionId: context.currentTestInteractionId,
      },
    ],
    reconciles: [],
  };
}
