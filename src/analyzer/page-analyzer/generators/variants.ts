import type {
  GeneratorOutput,
  GenerateSurfaceInteractionItem,
} from "@sudobility/testomniac_types";
import type { AnalyzerContext } from "../types";

export async function generateVariantTestInteractions(
  analyzer: any,
  context: AnalyzerContext
): Promise<GeneratorOutput> {
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
    return {
      creates: [],
      reconciles: [{ surfaceTitle, desiredKeys: [] }],
    };
  }

  const { runnerId, testEnvironmentId } = context;

  const batchItems: GenerateSurfaceInteractionItem[] = [];
  for (const test of tests) {
    batchItems.push({
      runnerId,
      testSurfaceId: 0,
      testInteraction: test,
      testEnvironmentId,
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

  return {
    creates: [
      {
        testSurface: {
          title: surfaceTitle,
          description: `Variant and option state checks for ${context.currentPath}`,
          startingPageStateId: context.currentPageStateId,
          startingPath: context.currentPath,
          sizeClass: context.sizeClass,
          priority: 2,
          surface_tags: ["variant", "option"],
          uid: context.uid,
        },
        interactions: batchItems,
        desiredKeys: tests.map((test: any) => analyzer.getGeneratedKey(test)),
      },
    ],
    reconciles: [],
  };
}
