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
  const surface = await api.ensureTestSurface(
    runnerId,
    {
      title: surfaceTitle,
      description: `Form workflows for ${context.currentPath}`,
      startingPageStateId: context.currentPageStateId,
      startingPath: context.currentPath,
      sizeClass,
      priority: 2,
      surface_tags: ["form"],
      uid,
    },
    testEnvironmentId
  );
  context.events.onTestSurfaceCreated({
    surfaceId: surface.id,
    title: surface.title,
  });

  await api.ensureBundleSurfaceLink(bundleRun.testSurfaceBundleId, surface.id);
  const surfaceRun = await analyzer.ensureSurfaceRun(
    api,
    surface.id,
    bundleRun.id
  );

  const desiredKeys: string[] = [];
  for (let index = 0; index < context.forms.length; index++) {
    const form = context.forms[index];
    const formType = analyzer.identifyFormType(form, context.currentPath);
    const formLabel = analyzer.describeForm(form, index);

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
        const searchElement = await api.ensureTestInteraction(
          runnerId,
          surface.id,
          searchTest,
          testEnvironmentId
        );
        await api.createTestInteractionRun({
          testInteractionId: searchElement.id,
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
    const positiveElement = await api.ensureTestInteraction(
      runnerId,
      surface.id,
      positive,
      testEnvironmentId
    );
    await api.createTestInteractionRun({
      testInteractionId: positiveElement.id,
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
      const negativeElement = await api.ensureTestInteraction(
        runnerId,
        surface.id,
        negative,
        testEnvironmentId
      );
      await api.createTestInteractionRun({
        testInteractionId: negativeElement.id,
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
      const correctionElement = await api.ensureTestInteraction(
        runnerId,
        surface.id,
        correction,
        testEnvironmentId
      );
      await api.createTestInteractionRun({
        testInteractionId: correctionElement.id,
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
        const passwordElement = await api.ensureTestInteraction(
          runnerId,
          surface.id,
          passwordTest,
          testEnvironmentId
        );
        await api.createTestInteractionRun({
          testInteractionId: passwordElement.id,
          testSurfaceRunId: surfaceRun.id,
        });
      }
    }
  }

  await analyzer.reconcileGeneratedSurfaceElements(context, {
    surfaceId: surface.id,
    surfaceTitle,
    desiredKeys,
  });
}
