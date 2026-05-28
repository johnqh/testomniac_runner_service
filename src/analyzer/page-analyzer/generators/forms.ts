import type { BatchTestInteractionItem } from "@sudobility/testomniac_types";
import type { AnalyzerContext } from "../types";

export async function generateFormTestInteractions(
  analyzer: any,
  context: AnalyzerContext
): Promise<void> {
  const surfaceTitle = `Forms: ${context.currentPath}`;
  if (context.forms.length === 0) {
    await analyzer.reconcileGeneratedSurfaceElements(context, {
      surfaceTitle,
      desiredKeys: [],
    });
    return;
  }

  const { api, runnerId, testEnvironmentId, sizeClass, uid, bundleRun } =
    context;
  const { surface, surfaceRun } = await api.ensureTestSurfaceWithRun({
    runnerId,
    testEnvironmentId,
    testSurface: {
      title: surfaceTitle,
      description: `Form workflows for ${context.currentPath}`,
      startingPageStateId: context.currentPageStateId,
      startingPath: context.currentPath,
      sizeClass,
      priority: 2,
      surface_tags: ["form"],
      uid,
    },
    testSurfaceBundleId: bundleRun.testSurfaceBundleId,
    testSurfaceBundleRunId: bundleRun.id,
  });
  analyzer.invalidateSurfacesCache();
  context.events.onTestSurfaceCreated({
    surfaceId: surface.id,
    title: surface.title,
  });

  const desiredKeys: string[] = [];
  const batchItems: BatchTestInteractionItem[] = [];
  for (let index = 0; index < context.forms.length; index++) {
    const form = context.forms[index];
    const formType = analyzer.identifyFormType(form, context.currentPath);
    const formLabel = analyzer.describeForm(form, index);

    // Skip forms already tested under a different URL variant of the same
    // base path (e.g. login sidebar form on /store/ vs /store/?pricepoint=3).
    if (
      await analyzer.hasGeneratedSelectorForBasePath(
        context.currentPath,
        "form",
        formLabel
      )
    ) {
      continue;
    }

    const validValues = analyzer.planFormValues(form, context.actionableItems);
    if (analyzer.isSearchForm(form)) {
      const searchTests = analyzer.buildSearchTestInteractions(
        form,
        formLabel,
        context.currentPath,
        sizeClass,
        uid,
        context.currentPageStateId,
        validValues,
        context.actionableItems
      );

      for (const searchTest of searchTests) {
        desiredKeys.push(analyzer.getGeneratedKey(searchTest));
        batchItems.push({
          runnerId,
          testSurfaceId: surface.id,
          testInteraction: searchTest,
          testEnvironmentId,
          testSurfaceRunId: surfaceRun.id,
        });
      }
      continue;
    }

    const positive = analyzer.buildFormTestInteraction(
      form,
      formLabel,
      formType,
      context.currentPath,
      sizeClass,
      uid,
      context.currentPageStateId,
      validValues
    );
    desiredKeys.push(analyzer.getGeneratedKey(positive));
    batchItems.push({
      runnerId,
      testSurfaceId: surface.id,
      testInteraction: positive,
      testEnvironmentId,
      testSurfaceRunId: surfaceRun.id,
    });

    for (const field of form.fields.filter((field: any) =>
      analyzer.isNegativeCandidateField(field)
    )) {
      const negative = analyzer.buildNegativeFormTestInteraction(
        form,
        formLabel,
        formType,
        field,
        context.currentPath,
        sizeClass,
        uid,
        context.currentPageStateId,
        validValues
      );
      desiredKeys.push(analyzer.getGeneratedKey(negative));
      batchItems.push({
        runnerId,
        testSurfaceId: surface.id,
        testInteraction: negative,
        testEnvironmentId,
        testSurfaceRunId: surfaceRun.id,
      });

      const correction = analyzer.buildFormCorrectionTestInteraction(
        form,
        formLabel,
        formType,
        field,
        context.currentPath,
        sizeClass,
        uid,
        context.currentPageStateId,
        validValues
      );
      desiredKeys.push(analyzer.getGeneratedKey(correction));
      batchItems.push({
        runnerId,
        testSurfaceId: surface.id,
        testInteraction: correction,
        testEnvironmentId,
        testSurfaceRunId: surfaceRun.id,
      });
    }

    if (analyzer.isPasswordScenario(formType, form)) {
      const passwordTests = analyzer.buildPasswordTestInteractions(
        form,
        formLabel,
        formType,
        context.currentPath,
        sizeClass,
        uid,
        context.currentPageStateId,
        validValues,
        analyzer.detectPasswordRequirements(
          analyzer.extractVisibleText(context.html)
        )
      );

      for (const passwordTest of passwordTests) {
        desiredKeys.push(analyzer.getGeneratedKey(passwordTest));
        batchItems.push({
          runnerId,
          testSurfaceId: surface.id,
          testInteraction: passwordTest,
          testEnvironmentId,
          testSurfaceRunId: surfaceRun.id,
        });
      }
    }

    await analyzer.markGeneratedSelectorForBasePath(
      context.currentPath,
      "form",
      formLabel
    );
  }
  if (batchItems.length > 0) {
    await api.ensureTestInteractionBatch(batchItems);
  }

  await analyzer.reconcileGeneratedSurfaceElements(context, {
    surfaceId: surface.id,
    surfaceTitle,
    desiredKeys,
  });
}
