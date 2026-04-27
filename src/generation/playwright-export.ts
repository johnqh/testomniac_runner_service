export interface PlaywrightTestStep {
  action:
    | "navigate"
    | "fill"
    | "click"
    | "select"
    | "assertVisible"
    | "screenshot"
    | "waitForLoad";
  url?: string;
  playwrightLocator?: string;
  playwrightScopeChain?: string;
  value?: string;
  label?: string;
}

export interface PlaywrightTestInput {
  testName: string;
  baseUrl: string;
  steps: PlaywrightTestStep[];
}

export function exportAsPlaywrightScript(input: PlaywrightTestInput): string {
  const lines: string[] = [
    "import { test, expect } from '@playwright/test';",
    "",
    `test('${escapeSingleQuotes(input.testName)}', async ({ page }) => {`,
  ];

  for (const step of input.steps) {
    const locatorExpr = step.playwrightScopeChain
      ? `page.${step.playwrightScopeChain}.${step.playwrightLocator}`
      : step.playwrightLocator
        ? `page.${step.playwrightLocator}`
        : null;

    switch (step.action) {
      case "navigate":
        lines.push(
          `  await page.goto('${escapeSingleQuotes(step.url || input.baseUrl)}');`
        );
        break;
      case "waitForLoad":
        lines.push("  await page.waitForLoadState('networkidle');");
        break;
      case "fill":
        if (locatorExpr && step.value !== undefined) {
          lines.push(
            `  await ${locatorExpr}.fill('${escapeSingleQuotes(step.value)}');`
          );
        }
        break;
      case "click":
        if (locatorExpr) {
          lines.push(`  await ${locatorExpr}.click();`);
        }
        break;
      case "select":
        if (locatorExpr && step.value !== undefined) {
          lines.push(
            `  await ${locatorExpr}.selectOption('${escapeSingleQuotes(step.value)}');`
          );
        }
        break;
      case "assertVisible":
        if (locatorExpr) {
          lines.push(`  await expect(${locatorExpr}).toBeVisible();`);
        }
        break;
      case "screenshot":
        lines.push(
          `  await page.screenshot({ path: '${escapeSingleQuotes(step.label || "screenshot")}.png', fullPage: true });`
        );
        break;
    }
  }

  lines.push("});");
  lines.push("");
  return lines.join("\n");
}

function escapeSingleQuotes(s: string): string {
  return s.replace(/'/g, "\\'");
}
