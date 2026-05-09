export type { Outcome, ExpertiseContext, Expertise } from "./types";
export { TesterExpertise } from "./tester-expertise";
export { SeoExpertise } from "./seo-expertise";
export { SecurityExpertise } from "./security-expertise";
export { PerformanceExpertise } from "./performance-expertise";
export { ContentExpertise } from "./content-expertise";
export { UiExpertise } from "./ui-expertise";
export { AccessibilityExpertise } from "./accessibility-expertise";
export { NoopExpertise } from "./noop-expertise";

import type { Expertise } from "./types";
import { TesterExpertise } from "./tester-expertise";
import { SeoExpertise } from "./seo-expertise";
import { SecurityExpertise } from "./security-expertise";
import { PerformanceExpertise } from "./performance-expertise";
import { ContentExpertise } from "./content-expertise";
import { UiExpertise } from "./ui-expertise";
import { AccessibilityExpertise } from "./accessibility-expertise";

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
