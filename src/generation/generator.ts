import { generateRenderTest, type GeneratedTestInteraction } from "./render";
import { assignPriority } from "./surface-tagger";
import type { SizeClass } from "../domain/types";
import type { ApiClient } from "../api/client";
import type { ElementIdentityResponse } from "@sudobility/testomniac_types";

export interface GeneratorOptions {
  runnerId: number;
  runId: number;
  sizeClass: SizeClass;
  api: ApiClient;
  elementIdentities?: ElementIdentityResponse[];
}

export async function generateTestInteractions(
  options: GeneratorOptions
): Promise<GeneratedTestInteraction[]> {
  const { runnerId, sizeClass, api } = options;
  const results: GeneratedTestInteraction[] = [];
  const allPages = await api.getPagesByRunner(runnerId);

  // Load element identities if not provided
  const identities =
    options.elementIdentities ??
    (await api.getElementIdentitiesByRunner(runnerId));

  for (const page of allPages) {
    const priority = assignPriority(page.routeKey || "", page.relativePath);

    // Get page states for this page to find element identities
    const pageStates = await api.getPageStates(page.id);
    const pageState = pageStates[0]; // Use first page state

    // Map identities that were last seen in a state for this page
    const pageElements = identities
      .filter(id => id.computedName || id.labelText || id.testId)
      .slice(0, 10)
      .map(id => ({
        elementIdentityId: id.id,
        playwrightLocator: id.playwrightLocator,
        playwrightScopeChain: id.playwrightScopeChain ?? undefined,
        computedName: id.computedName || id.labelText || id.cssSelector,
        role: id.role,
        visible: true,
      }));

    results.push(
      generateRenderTest({
        pageId: page.id,
        pageStateId: pageState?.id ?? 0,
        pageName: page.routeKey || page.relativePath,
        url: page.relativePath,
        sizeClass,
        priority,
        elements: pageElements,
      })
    );
  }

  return results;
}
