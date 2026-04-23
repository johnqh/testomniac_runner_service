import type { TestAction, SizeClass } from "../domain/types";
import type { GeneratedTestCase } from "./render";
import { assignSuiteTags } from "./suite-tagger";

interface FormInput {
  pageName: string;
  url: string;
  sizeClass: SizeClass;
  priority: string;
  personaId: number;
  useCaseId: number;
  fills: Array<{ selector: string; value: string }>;
  discreteControls: Array<{ selector: string; type: string; value: string }>;
  submitSelector?: string;
}

export function generateFormTest(input: FormInput): GeneratedTestCase {
  const actions: TestAction[] = [
    { action: "navigate", url: input.url },
    { action: "waitForLoad" },
  ];
  for (const fill of input.fills) {
    actions.push({
      action: "fill",
      selector: fill.selector,
      value: fill.value,
    });
  }
  for (const ctrl of input.discreteControls) {
    if (ctrl.type === "checkbox" || ctrl.type === "radio_select") {
      actions.push({
        action: "check",
        selector: ctrl.selector,
        value: ctrl.value,
      });
    } else if (ctrl.type === "select" || ctrl.type === "select-one") {
      actions.push({
        action: "select",
        selector: ctrl.selector,
        value: ctrl.value,
      });
    }
  }
  if (input.submitSelector) {
    actions.push({ action: "click", selector: input.submitSelector });
  }
  actions.push({ action: "waitForNavigation" });
  actions.push({ action: "assertUrlChanged" });
  return {
    testCase: {
      name: `Form — ${input.pageName}`,
      type: "form",
      sizeClass: input.sizeClass,
      suite_tags: assignSuiteTags("form", input.priority),
      persona_id: input.personaId,
      use_case_id: input.useCaseId,
      priority: input.priority,
    },
    actions,
  };
}
