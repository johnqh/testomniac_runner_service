import type {
  GeneratorOutput,
  GenerateSurfaceInteractionItem,
  TestInteraction,
} from "@sudobility/testomniac_types";
import type { AnalyzerContext } from "../types";

export async function generateDialogLifecycleTestInteractions(
  analyzer: any,
  context: AnalyzerContext
): Promise<GeneratorOutput> {
  const surfaceTitle = `Dialogs: ${context.currentPath}`;
  if (!analyzer.pageHasOpenDialog(context.html)) {
    return {
      creates: [],
      reconciles: [{ surfaceTitle, desiredKeys: [] }],
    };
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

  const { runnerId, testEnvironmentId } = context;

  const desiredKeys = tests.map((test: TestInteraction) =>
    analyzer.getGeneratedKey(test)
  );
  const batchItems: GenerateSurfaceInteractionItem[] = tests.map(
    (test: TestInteraction) => ({
      runnerId,
      testSurfaceId: 0,
      testInteraction: test,
      testEnvironmentId,
    })
  );

  return {
    creates: [
      {
        testSurface: {
          title: surfaceTitle,
          description: `Dialog lifecycle checks for ${context.currentPath}`,
          startingPageStateId: context.currentPageStateId,
          startingPath: context.currentPath,
          sizeClass: context.sizeClass,
          priority: 4,
          surface_tags: ["dialog"],
          uid: context.uid,
        },
        interactions: batchItems,
        desiredKeys,
      },
    ],
    reconciles: [],
  };
}
