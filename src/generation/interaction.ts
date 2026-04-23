import type { TestAction, SizeClass } from "../domain/types";
import type { GeneratedTestCase } from "./render";
import { assignSuiteTags } from "./suite-tagger";

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
): GeneratedTestCase {
  const actions: TestAction[] = [
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
    testCase: {
      name: `Interaction — ${input.pageName}`,
      type: "interaction",
      sizeClass: input.sizeClass,
      suite_tags: assignSuiteTags("interaction", input.priority),
      priority: input.priority,
    },
    actions,
  };
}
