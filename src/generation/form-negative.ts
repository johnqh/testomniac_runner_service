import type { TestAction, SizeClass, FormField } from "../domain/types";
import type { GeneratedTestCase } from "./render";
import { assignSuiteTags } from "./suite-tagger";

interface FormNegativeInput {
  pageName: string;
  url: string;
  sizeClass: SizeClass;
  priority: string;
  fields: FormField[];
  submitSelector?: string;
  validValues: Record<string, string>;
}

export function generateFormNegativeTests(
  input: FormNegativeInput
): GeneratedTestCase[] {
  const requiredFields = input.fields.filter(f => f.required);
  if (requiredFields.length === 0) return [];

  return requiredFields.map(skippedField => {
    const actions: TestAction[] = [
      { action: "navigate", url: input.url },
      { action: "waitForLoad" },
    ];

    for (const field of input.fields) {
      if (field.selector === skippedField.selector) continue;
      const value = input.validValues[field.name] || "test";
      actions.push({ action: "fill", selector: field.selector, value });
    }

    if (input.submitSelector) {
      actions.push({ action: "click", selector: input.submitSelector });
    }

    actions.push({
      action: "assertUrl",
      pattern: new URL(input.url).pathname,
    });

    return {
      testCase: {
        name: `Form Negative — ${input.pageName} (missing ${skippedField.name})`,
        type: "form" as const,
        sizeClass: input.sizeClass,
        suite_tags: assignSuiteTags("form", input.priority),
        priority: input.priority,
      },
      actions,
    };
  });
}
