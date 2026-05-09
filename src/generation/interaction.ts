import type { LegacyTestAction, SizeClass } from "../domain/types";
import type { LegacyGeneratedTestElement } from "./render";
import { assignSurfaceTags } from "./surface-tagger";

interface InteractionInput {
  pageName: string;
  url: string;
  sizeClass: SizeClass;
  priority: string;
  mouseoverSelectors: string[];
  clickSelector: string;
  expectedUrl?: string;
}

export function generateInteractionTest(
  input: InteractionInput
): LegacyGeneratedTestElement {
  const actions: LegacyTestAction[] = [
    { action: "navigate", url: input.url },
    { action: "waitForLoad" },
  ];
  for (const sel of input.mouseoverSelectors) {
    actions.push({ action: "mouseover", selector: sel });
  }
  actions.push({ action: "click", selector: input.clickSelector });
  if (input.expectedUrl) {
    actions.push({ action: "waitForNavigation" });
    actions.push({ action: "assertUrl", pattern: input.expectedUrl });
  }
  return {
    testElement: {
      name: `Interaction — ${input.pageName}`,
      type: "interaction",
      sizeClass: input.sizeClass,
      surface_tags: assignSurfaceTags("interaction", input.priority),
      priority: input.priority,
    },
    actions,
  };
}
