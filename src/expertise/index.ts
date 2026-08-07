export type { Outcome, ExpertiseContext, Expertise } from "./types.js";
export { TesterExpertise } from "./tester-expertise.js";
export { SeoExpertise } from "./seo-expertise.js";
export { SecurityExpertise } from "./security-expertise.js";
export { PerformanceExpertise } from "./performance-expertise.js";
export { ContentExpertise } from "./content-expertise.js";
export { UiExpertise } from "./ui-expertise.js";
export { AccessibilityExpertise } from "./accessibility-expertise.js";
export { NoopExpertise } from "./noop-expertise.js";

import type { Expertise } from "./types.js";
import { TesterExpertise } from "./tester-expertise.js";
import { SeoExpertise } from "./seo-expertise.js";
import { SecurityExpertise } from "./security-expertise.js";
import { PerformanceExpertise } from "./performance-expertise.js";
import { ContentExpertise } from "./content-expertise.js";
import { UiExpertise } from "./ui-expertise.js";
import { AccessibilityExpertise } from "./accessibility-expertise.js";

const REQUIRED_EXPERTISE_SLUG = "tester";

function buildExpertiseRegistry(): Record<string, () => Expertise> {
  return {
    tester: () => new TesterExpertise(),
    seo: () => new SeoExpertise(),
    security: () => new SecurityExpertise(),
    performance: () => new PerformanceExpertise(),
    content: () => new ContentExpertise(),
    ui: () => new UiExpertise(),
    accessibility: () => new AccessibilityExpertise(),
  };
}

export function createExpertises(slugs?: string[]): Expertise[] {
  const registry = buildExpertiseRegistry();
  const normalized = Array.from(
    new Set(
      (slugs ?? [REQUIRED_EXPERTISE_SLUG])
        .map(slug => slug.trim().toLowerCase())
        .filter(Boolean)
    )
  );
  const selected = normalized.includes(REQUIRED_EXPERTISE_SLUG)
    ? normalized
    : [REQUIRED_EXPERTISE_SLUG, ...normalized];

  return selected
    .map(slug => registry[slug]?.())
    .filter((expertise): expertise is Expertise => Boolean(expertise));
}

export function createDefaultExpertises(): Expertise[] {
  return createExpertises([
    "tester",
    "seo",
    "security",
    "performance",
    "content",
    "ui",
    "accessibility",
  ]);
}
