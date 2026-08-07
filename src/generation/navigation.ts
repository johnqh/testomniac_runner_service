import type { SizeClass } from "../domain/types.js";
import type { LegacyGeneratedTestInteraction } from "./render.js";
import { assignSurfaceTags } from "./surface-tagger.js";

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
): LegacyGeneratedTestInteraction {
  const pattern = new URL(input.toUrl).pathname;
  return {
    testInteraction: {
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
