import type { GeneratorOutput } from "@sudobility/testomniac_types";
import type { AnalyzerContext } from "../types";

export async function generateE2ETestInteractions(
  analyzer: any,
  context: AnalyzerContext
): Promise<GeneratorOutput> {
  const surfaceTitle = `Dependency Journeys: ${context.currentPath}`;
  if (context.journeySteps.length < 2) {
    return {
      creates: [],
      reconciles: [{ surfaceTitle, desiredKeys: [] }],
    };
  }

  const { runnerId, testEnvironmentId, sizeClass, uid } = context;

  const e2e = analyzer.buildE2ETestInteraction(
    context.currentPath,
    sizeClass,
    uid,
    context.currentPageStateId,
    context.journeySteps
  );

  return {
    creates: [
      {
        testSurface: {
          title: surfaceTitle,
          description: `Dependency-derived journeys reaching ${context.currentPath}`,
          startingPageStateId: context.currentPageStateId,
          startingPath: context.currentPath,
          sizeClass,
          priority: 2,
          surface_tags: ["e2e"],
          uid,
        },
        interactions: [
          {
            runnerId,
            testInteraction: e2e,
            testEnvironmentId,
          },
        ],
        desiredKeys: [analyzer.getGeneratedKey(e2e)],
      },
    ],
    reconciles: [],
  };
}
