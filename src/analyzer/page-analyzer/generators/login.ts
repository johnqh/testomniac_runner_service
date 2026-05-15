import type { AnalyzerContext } from "../types";
import type { LoginDetectionResult } from "../../../scanner/login-detector";
import type { LoginConfig } from "../../../orchestrator/login-manager";

/**
 * Generate login-specific test interactions when a login page is detected.
 *
 * Creates a `Login: {path}` surface with:
 * 1. Invalid email format test
 * 2. Empty password test
 * 3. Wrong password test
 * 4. Correct email/password login test
 * 5. SSO button click tests (per detected provider)
 */
export async function generateLoginTestInteractions(
  analyzer: any,
  context: AnalyzerContext,
  loginDetection: LoginDetectionResult,
  loginConfig?: LoginConfig
): Promise<void> {
  if (!loginDetection.isLoginPage) return;

  const surfaceTitle = `Login: ${context.currentPath}`;
  const { api, runnerId, testEnvironmentId, sizeClass, uid, bundleRun } =
    context;

  const surface = await api.ensureTestSurface(
    runnerId,
    {
      title: surfaceTitle,
      description: `Login flow tests for ${context.currentPath}`,
      startingPageStateId: context.currentPageStateId,
      startingPath: context.currentPath,
      sizeClass,
      priority: 0, // High priority — login tests should run early
      surface_tags: ["login", "auth"],
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
  let previousInteractionId: number | undefined;

  // -------------------------------------------------------------------------
  // Email/password form tests
  // -------------------------------------------------------------------------
  if (loginDetection.loginForm && loginConfig?.password) {
    const form = loginDetection.loginForm;
    const emailField = form.fields.find(
      f =>
        f.type === "email" ||
        f.name?.toLowerCase().includes("email") ||
        f.name?.toLowerCase().includes("user")
    );
    const passwordField = form.fields.find(f => f.type === "password");

    // Test 1: Invalid email format
    if (emailField?.selector) {
      const key = `login-invalid-email:${context.currentPath}`;
      desiredKeys.push(key);
      const interaction = await analyzer.ensureTestInteraction(api, {
        runnerId,
        testSurfaceId: surface.id,
        title: `Login: invalid email format`,
        testType: "form",
        sizeClass,
        startingPath: context.currentPath,
        startingPageStateId: context.currentPageStateId,
        uid,
        generatedKey: key,
        dependencyTestInteractionId: undefined,
        surfaceTags: ["login", "negative"],
        steps: [
          {
            action: "type",
            selector: emailField.selector,
            value: "not-an-email",
          },
          ...(passwordField?.selector
            ? [
                {
                  action: "type" as const,
                  selector: passwordField.selector,
                  value: "anypassword123",
                },
              ]
            : []),
          { action: "pressKey", key: "Enter" },
        ],
        globalExpectations: [
          {
            type: "error_visible",
            description:
              "An error message should be displayed for invalid email format",
            severity: "warning",
            priority: 2,
          },
        ],
      });
      await analyzer.ensureInteractionRun(
        api,
        interaction.id,
        surfaceRun.id,
        bundleRun.id
      );
      previousInteractionId = interaction.id;
    }

    // Test 2: Wrong password
    if (emailField?.selector && passwordField?.selector && loginConfig.email) {
      const key = `login-wrong-password:${context.currentPath}`;
      desiredKeys.push(key);
      const interaction = await analyzer.ensureTestInteraction(api, {
        runnerId,
        testSurfaceId: surface.id,
        title: `Login: wrong password`,
        testType: "form",
        sizeClass,
        startingPath: context.currentPath,
        startingPageStateId: context.currentPageStateId,
        uid,
        generatedKey: key,
        dependencyTestInteractionId: previousInteractionId,
        surfaceTags: ["login", "negative"],
        steps: [
          {
            action: "type",
            selector: emailField.selector,
            value: loginConfig.email,
          },
          {
            action: "type",
            selector: passwordField.selector,
            value: "incorrect_password_" + Date.now(),
          },
          { action: "pressKey", key: "Enter" },
        ],
        globalExpectations: [
          {
            type: "error_visible",
            description:
              "An authentication error message should be displayed for incorrect credentials",
            severity: "warning",
            priority: 2,
          },
        ],
      });
      await analyzer.ensureInteractionRun(
        api,
        interaction.id,
        surfaceRun.id,
        bundleRun.id
      );
      previousInteractionId = interaction.id;
    }

    // Test 3: Correct login (depends on the negative tests completing first)
    if (emailField?.selector && passwordField?.selector && loginConfig.email) {
      const key = `login-correct:${context.currentPath}`;
      desiredKeys.push(key);
      const interaction = await analyzer.ensureTestInteraction(api, {
        runnerId,
        testSurfaceId: surface.id,
        title: `Login: correct credentials`,
        testType: "form",
        sizeClass,
        startingPath: context.currentPath,
        startingPageStateId: context.currentPageStateId,
        uid,
        generatedKey: key,
        dependencyTestInteractionId: previousInteractionId,
        surfaceTags: ["login", "positive"],
        steps: [
          {
            action: "type",
            selector: emailField.selector,
            value: loginConfig.email,
          },
          {
            action: "type",
            selector: passwordField.selector,
            value: loginConfig.password,
          },
          { action: "pressKey", key: "Enter" },
        ],
        globalExpectations: [
          {
            type: "navigation_away",
            description:
              "Should navigate away from login page after successful authentication",
            severity: "error",
            priority: 1,
          },
        ],
      });
      await analyzer.ensureInteractionRun(
        api,
        interaction.id,
        surfaceRun.id,
        bundleRun.id
      );
      previousInteractionId = interaction.id;
    }
  }

  // -------------------------------------------------------------------------
  // SSO button tests
  // -------------------------------------------------------------------------
  for (const ssoButton of loginDetection.ssoButtons) {
    const key = `login-sso-${ssoButton.provider}:${context.currentPath}`;
    desiredKeys.push(key);
    const interaction = await analyzer.ensureTestInteraction(api, {
      runnerId,
      testSurfaceId: surface.id,
      title: `Login: ${ssoButton.provider} SSO`,
      testType: "interaction",
      sizeClass,
      startingPath: context.currentPath,
      startingPageStateId: context.currentPageStateId,
      uid,
      generatedKey: key,
      dependencyTestInteractionId: undefined,
      surfaceTags: ["login", "sso", ssoButton.provider],
      steps: [
        {
          action: "click",
          selector: ssoButton.selector,
        },
      ],
      globalExpectations: [
        {
          type: "navigation_away",
          description: `Should navigate to ${ssoButton.provider} SSO provider page`,
          severity: "warning",
          priority: 2,
        },
      ],
    });
    await analyzer.ensureInteractionRun(
      api,
      interaction.id,
      surfaceRun.id,
      bundleRun.id
    );
  }

  // Reconcile: mark any previously generated login interactions that are
  // no longer desired as inactive
  await analyzer.reconcileGeneratedSurfaceElements(context, {
    surfaceTitle,
    desiredKeys,
  });
}
