import type { ActionableItem } from "@sudobility/testomniac_types";
import type { BrowserAdapter } from "../adapter.js";
import { buildDomSnapshot } from "../browser/dom-snapshot.js";
import { buttonExtractor } from "./buttons.js";
import { clickableExtractor } from "./clickables.js";
import { productActionExtractor } from "./product-actions.js";
import { resolveSelectors } from "./selectors.js";
import { selectExtractor } from "./selects.js";
import { textInputExtractor } from "./text-inputs.js";
import { toggleExtractor } from "./toggles.js";
import type { ItemExtractor } from "./types.js";

const extractorRegistry: ItemExtractor[] = [
  textInputExtractor,
  selectExtractor,
  toggleExtractor,
  productActionExtractor,
  buttonExtractor,
  clickableExtractor,
];

export async function extractActionableItems(
  adapter: BrowserAdapter
): Promise<ActionableItem[]> {
  const snapshot = await buildDomSnapshot(adapter);
  const candidates = extractorRegistry.flatMap(extractor =>
    extractor.extract(snapshot)
  );
  return resolveSelectors(candidates);
}

export function getRegisteredExtractorNames(): string[] {
  return extractorRegistry.map(extractor => extractor.name);
}
