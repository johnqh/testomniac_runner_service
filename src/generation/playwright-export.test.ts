import { describe, it, expect } from "vitest";
import { exportAsPlaywrightScript } from "./playwright-export";

describe("exportAsPlaywrightScript", () => {
  it("generates a valid Playwright test script for a render test", () => {
    const script = exportAsPlaywrightScript({
      testName: "Render — Home Page",
      baseUrl: "https://example.com",
      steps: [
        { action: "navigate", url: "https://example.com" },
        {
          action: "assertVisible",
          playwrightLocator: "getByRole('heading', { name: 'Welcome' })",
        },
        { action: "screenshot", label: "render-home" },
      ],
    });
    expect(script).toContain("import { test, expect } from '@playwright/test'");
    expect(script).toContain("test('Render — Home Page'");
    expect(script).toContain("await page.goto('https://example.com')");
    expect(script).toContain(
      "await expect(page.getByRole('heading', { name: 'Welcome' })).toBeVisible()"
    );
    expect(script).toContain("await page.screenshot(");
  });

  it("generates fill steps with Playwright locators", () => {
    const script = exportAsPlaywrightScript({
      testName: "Login flow",
      baseUrl: "https://example.com/login",
      steps: [
        { action: "navigate", url: "https://example.com/login" },
        {
          action: "fill",
          playwrightLocator: "getByLabel('Email')",
          value: "jane@example.com",
        },
        {
          action: "fill",
          playwrightLocator: "getByLabel('Password')",
          value: "secret123",
        },
        {
          action: "click",
          playwrightLocator: "getByRole('button', { name: 'Sign In' })",
        },
      ],
    });
    expect(script).toContain(
      "await page.getByLabel('Email').fill('jane@example.com')"
    );
    expect(script).toContain(
      "await page.getByLabel('Password').fill('secret123')"
    );
    expect(script).toContain(
      "await page.getByRole('button', { name: 'Sign In' }).click()"
    );
  });

  it("handles scoped locators", () => {
    const script = exportAsPlaywrightScript({
      testName: "Radio selection",
      baseUrl: "https://example.com",
      steps: [
        { action: "navigate", url: "https://example.com" },
        {
          action: "click",
          playwrightLocator: "getByRole('radio', { name: 'Express' })",
          playwrightScopeChain: "getByRole('group', { name: 'Shipping' })",
        },
      ],
    });
    expect(script).toContain(
      "await page.getByRole('group', { name: 'Shipping' }).getByRole('radio', { name: 'Express' }).click()"
    );
  });

  it("generates waitForLoad steps", () => {
    const script = exportAsPlaywrightScript({
      testName: "Load test",
      baseUrl: "https://example.com",
      steps: [
        { action: "navigate", url: "https://example.com" },
        { action: "waitForLoad" },
      ],
    });
    expect(script).toContain("await page.waitForLoadState('networkidle')");
  });

  it("generates select steps", () => {
    const script = exportAsPlaywrightScript({
      testName: "Select test",
      baseUrl: "https://example.com",
      steps: [
        {
          action: "select",
          playwrightLocator: "getByLabel('Country')",
          value: "US",
        },
      ],
    });
    expect(script).toContain(
      "await page.getByLabel('Country').selectOption('US')"
    );
  });
});
