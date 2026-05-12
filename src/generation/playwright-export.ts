import type { TestInteraction } from "../domain/types";

export function exportAsPlaywrightScript(
  testInteraction: TestInteraction
): string {
  const lines: string[] = [
    "import { test, expect } from '@playwright/test';",
    "",
    `test('${escapeSingleQuotes(testInteraction.title)}', async ({ page }) => {`,
  ];

  for (const step of testInteraction.steps) {
    // Emit the action
    lines.push(`  ${step.action.playwrightCode}`);

    // Emit expectations
    for (const exp of step.expectations) {
      lines.push(`  ${exp.playwrightCode}`);
    }
  }

  lines.push("});");
  lines.push("");
  return lines.join("\n");
}

function escapeSingleQuotes(s: string): string {
  return s.replace(/'/g, "\\'");
}
