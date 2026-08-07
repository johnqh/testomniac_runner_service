import type { DetectionRule } from "../detection-rule.js";
import { duplicateHeadingRule } from "./duplicate-heading-rule.js";
import { emptyLinkRule } from "./empty-link-rule.js";
import { brokenImageRule } from "./broken-image-rule.js";
import { duplicateIdRule } from "./duplicate-id-rule.js";
import { placeholderTextRule } from "./placeholder-text-rule.js";
import { errorPageRule } from "./error-page-rule.js";
import { blankPageRule } from "./blank-page-rule.js";
import { brokenLinkRule } from "./broken-link-rule.js";
import { brokenMediaRule } from "./broken-media-rule.js";
import { deadClickRule } from "./dead-click-rule.js";
import { consoleErrorRule } from "./console-error-rule.js";
import { networkErrorRule } from "./network-error-rule.js";

export function getAllDetectionRules(): DetectionRule[] {
  return [
    // Pure HTML/text rules (no adapter needed)
    duplicateHeadingRule,
    emptyLinkRule,
    brokenImageRule,
    duplicateIdRule,
    placeholderTextRule,
    errorPageRule,
    blankPageRule,
    // Adapter-based rules (need browser context)
    brokenLinkRule,
    brokenMediaRule,
    deadClickRule,
    consoleErrorRule,
    networkErrorRule,
  ];
}

export {
  duplicateHeadingRule,
  emptyLinkRule,
  brokenImageRule,
  duplicateIdRule,
  placeholderTextRule,
  errorPageRule,
  blankPageRule,
  brokenLinkRule,
  brokenMediaRule,
  deadClickRule,
  consoleErrorRule,
  networkErrorRule,
};
