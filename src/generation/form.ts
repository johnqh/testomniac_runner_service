import type { LegacyTestAction, SizeClass } from "../domain/types";
import type { LegacyGeneratedTestInteraction } from "./render";
import { assignSurfaceTags } from "./surface-tagger";

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

export function generateFormTest(
  input: FormInput
): LegacyGeneratedTestInteraction {
  const actions: LegacyTestAction[] = [
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
    testInteraction: {
      name: `Form — ${input.pageName}`,
      type: "form",
      sizeClass: input.sizeClass,
      surface_tags: assignSurfaceTags("form", input.priority),
      persona_id: input.personaId,
      use_case_id: input.useCaseId,
      priority: input.priority,
    },
    actions,
  };
}
