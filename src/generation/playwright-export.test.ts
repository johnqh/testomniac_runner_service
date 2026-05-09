import { describe, it, expect } from "vitest";
import { exportAsPlaywrightScript } from "./playwright-export";
import {
  PlaywrightAction,
  ExpectationType,
  ExpectationSeverity,
} from "../domain/types";
import type { TestElement } from "../domain/types";

function makeTestElement(overrides: Partial<TestElement>): TestElement {
  return {
    title: "Test",
    type: "render",
    sizeClass: "desktop",
    surface_tags: [],
    priority: 3,
    startingPageStateId: 1,
    startingPath: "/",
    steps: [],
    globalExpectations: [],
    ...overrides,
  };
}

describe("exportAsPlaywrightScript", () => {
  it("generates a render test with steps and expectations", () => {
    const tc = makeTestElement({
      title: "Render — Home Page",
      steps: [
        {
          action: {
            actionType: PlaywrightAction.Goto,
            path: "/",
            playwrightCode: "await page.goto('https://example.com');",
            description: "Navigate",
          },
          expectations: [
            {
              expectationType: ExpectationType.PageLoaded,
              severity: ExpectationSeverity.MustPass,
              description: "Page loaded",
              playwrightCode: "await page.waitForLoadState('networkidle');",
            },
          ],
          description: "Navigate to home",
          continueOnFailure: false,
        },
        {
          action: {
            actionType: PlaywrightAction.WaitForLoadState,
            playwrightCode: "await page.waitForLoadState('networkidle');",
            description: "Wait",
          },
          expectations: [
            {
              expectationType: ExpectationType.ElementVisible,
              elementIdentityId: 5,
              severity: ExpectationSeverity.ShouldPass,
              description: "'Welcome' heading visible",
              playwrightCode:
                "await expect(page.getByRole('heading', { name: 'Welcome' })).toBeVisible();",
            },
          ],
          description: "Verify elements",
          continueOnFailure: true,
        },
      ],
    });

    const script = exportAsPlaywrightScript(tc);
    expect(script).toContain("import { test, expect } from '@playwright/test'");
    expect(script).toContain("test('Render — Home Page'");
    expect(script).toContain("await page.goto('https://example.com');");
    expect(script).toContain(
      "await expect(page.getByRole('heading', { name: 'Welcome' })).toBeVisible();"
    );
  });

  it("generates steps with fill + click and expectations", () => {
    const tc = makeTestElement({
      title: "Login flow",
      steps: [
        {
          action: {
            actionType: PlaywrightAction.Fill,
            elementIdentityId: 15,
            value: "jane@example.com",
            playwrightCode:
              "await page.getByLabel('Email').fill('jane@example.com');",
            description: "Fill email",
          },
          expectations: [
            {
              expectationType: ExpectationType.InputValue,
              elementIdentityId: 15,
              expectedValue: "jane@example.com",
              severity: ExpectationSeverity.MustPass,
              description: "Email has value",
              playwrightCode:
                "await expect(page.getByLabel('Email')).toHaveValue('jane@example.com');",
            },
          ],
          description: "Fill email",
          continueOnFailure: false,
        },
        {
          action: {
            actionType: PlaywrightAction.Click,
            elementIdentityId: 42,
            playwrightCode:
              "await page.getByRole('button', { name: 'Sign In' }).click();",
            description: "Click sign in",
          },
          expectations: [
            {
              expectationType: ExpectationType.UrlChanged,
              severity: ExpectationSeverity.MustPass,
              description: "URL changed",
              playwrightCode: "expect(page.url()).not.toBe(urlBefore);",
            },
            {
              expectationType: ExpectationType.NoConsoleErrors,
              severity: ExpectationSeverity.ShouldPass,
              description: "No console errors",
              playwrightCode: "expect(consoleErrors).toHaveLength(0);",
            },
          ],
          description: "Submit and verify",
          continueOnFailure: false,
        },
      ],
    });

    const script = exportAsPlaywrightScript(tc);
    expect(script).toContain(
      "await page.getByLabel('Email').fill('jane@example.com');"
    );
    expect(script).toContain(
      "await expect(page.getByLabel('Email')).toHaveValue('jane@example.com');"
    );
    expect(script).toContain(
      "await page.getByRole('button', { name: 'Sign In' }).click();"
    );
    expect(script).toContain("expect(consoleErrors).toHaveLength(0);");
  });
});
