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

export function createDefaultExpertises(): Expertise[] {
  return [
    new TesterExpertise(),
    new SeoExpertise(),
    new SecurityExpertise(),
    new PerformanceExpertise(),
    new ContentExpertise(),
    new UiExpertise(),
    new AccessibilityExpertise(),
  ];
}
