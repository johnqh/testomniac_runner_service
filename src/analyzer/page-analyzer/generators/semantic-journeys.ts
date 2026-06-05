import type {
  GeneratorOutput,
  GenerateSurfaceInteractionItem,
} from "@sudobility/testomniac_types";
import type { AnalyzerContext } from "../types";

export async function generateSemanticJourneyTestInteractions(
  analyzer: any,
  context: AnalyzerContext
): Promise<GeneratorOutput> {
  const journeys = analyzer.buildSemanticJourneyTestInteractions(context);
  const surfaceTitle = `Journeys: ${context.currentPath}`;
  if (journeys.length === 0) {
    return {
      creates: [],
      reconciles: [{ surfaceTitle, desiredKeys: [] }],
    };
  }

  const { runnerId, testEnvironmentId } = context;

  const batchItems: GenerateSurfaceInteractionItem[] = journeys.map(
    (journey: any) => ({
      runnerId,
      testSurfaceId: 0,
      testInteraction: journey,
      testEnvironmentId,
    })
  );

  return {
    creates: [
      {
        testSurface: {
          title: surfaceTitle,
          description: `Semantic multi-step journeys from ${context.currentPath}`,
          startingPageStateId: context.currentPageStateId,
          startingPath: context.currentPath,
          sizeClass: context.sizeClass,
          priority: 6,
          surface_tags: ["e2e", "semantic-journey"],
          uid: context.uid,
        },
        interactions: batchItems,
        desiredKeys: journeys.map((journey: any) =>
          analyzer.getGeneratedKey(journey)
        ),
      },
    ],
    reconciles: [],
  };
}
