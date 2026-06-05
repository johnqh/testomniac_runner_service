import type { GeneratorOutput } from "@sudobility/testomniac_types";
import type { AnalyzerContext } from "../types";

export async function generateRenderTestInteractions(
  analyzer: any,
  context: AnalyzerContext
): Promise<GeneratorOutput> {
  const { runnerId, testEnvironmentId, sizeClass, uid } = context;
  const surfaceTitle = `Render: ${context.currentPath}`;

  const testInteraction = analyzer.buildRenderTestInteraction(
    context.currentPath,
    sizeClass,
    uid,
    context.currentPageStateId,
    context.pageId
  );

  return {
    creates: [
      {
        testSurface: {
          title: surfaceTitle,
          description: `Render validation for ${context.currentPath}`,
          startingPageStateId: context.currentPageStateId,
          startingPath: context.currentPath,
          sizeClass,
          priority: 5,
          surface_tags: ["render"],
          uid,
        },
        interactions: [
          {
            runnerId,
            testInteraction,
            testEnvironmentId,
          },
        ],
        desiredKeys: [analyzer.getGeneratedKey(testInteraction)],
      },
    ],
    reconciles: [],
  };
}
