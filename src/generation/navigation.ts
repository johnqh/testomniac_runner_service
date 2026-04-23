import type { SizeClass } from "../domain/types";
import type { GeneratedTestCase } from "./render";
import { assignSuiteTags } from "./suite-tagger";

interface NavigationInput {
  fromPageName: string;
  toPageName: string;
  fromUrl: string;
  toUrl: string;
  sizeClass: SizeClass;
  priority: string;
  triggerSelector: string;
}

export function generateNavigationTest(
  input: NavigationInput
): GeneratedTestCase {
  const pattern = new URL(input.toUrl).pathname;
  return {
    testCase: {
      name: `Navigation — ${input.fromPageName} → ${input.toPageName}`,
      type: "navigation",
      sizeClass: input.sizeClass,
      suite_tags: assignSuiteTags("navigation", input.priority),
      priority: input.priority,
    },
    actions: [
      { action: "navigate", url: input.fromUrl },
      { action: "waitForLoad" },
      { action: "click", selector: input.triggerSelector },
      { action: "waitForNavigation" },
      { action: "assertUrl", pattern },
    ],
  };
}
