import type { SizeClass } from "../domain/types";
import type { LegacyGeneratedTestElement } from "./render";
import { assignSurfaceTags } from "./surface-tagger";

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
): LegacyGeneratedTestElement {
  const pattern = new URL(input.toUrl).pathname;
  return {
    testElement: {
      name: `Navigation — ${input.fromPageName} → ${input.toPageName}`,
      type: "navigation",
      sizeClass: input.sizeClass,
      surface_tags: assignSurfaceTags("navigation", input.priority),
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
