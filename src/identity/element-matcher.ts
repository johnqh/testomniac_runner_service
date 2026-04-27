import type { ElementIdentityResponse } from "@sudobility/testomniac_types";

export interface ElementFingerprint {
  role: string;
  computedName: string;
  tagName: string;
  labelText?: string;
  groupName?: string;
  placeholder?: string;
  altText?: string;
  testId?: string;
  inputType?: string;
  nthInGroup?: number;
  formContext?: string;
  headingContext?: string;
  landmarkAncestor?: string;
  cssSelector: string;
}

export interface MatchResult {
  identity: ElementIdentityResponse;
  score: number;
}

const MATCH_THRESHOLD = 0.7;

export function matchElementIdentity(
  fp: ElementFingerprint,
  existing: ElementIdentityResponse[]
): MatchResult | null {
  let best: MatchResult | null = null;

  for (const identity of existing) {
    const score = computeMatchScore(fp, identity);
    if (score > (best?.score ?? 0)) {
      best = { identity, score };
    }
  }

  return best && best.score >= MATCH_THRESHOLD ? best : null;
}

function computeMatchScore(
  fp: ElementFingerprint,
  id: ElementIdentityResponse
): number {
  // 1. Exact testId match
  if (fp.testId && id.testId && fp.testId === id.testId) {
    return 1.0;
  }

  // 2. Role + computedName + groupName
  if (
    fp.role === id.role &&
    fp.computedName &&
    id.computedName &&
    fp.computedName === id.computedName &&
    fp.groupName &&
    id.groupName &&
    fp.groupName === id.groupName
  ) {
    return 0.95;
  }

  // 3. Role + computedName
  if (
    fp.role === id.role &&
    fp.computedName &&
    id.computedName &&
    fp.computedName === id.computedName
  ) {
    return 0.9;
  }

  // 4. Role + labelText
  if (
    fp.role === id.role &&
    fp.labelText &&
    id.labelText &&
    fp.labelText === id.labelText
  ) {
    return 0.85;
  }

  // 5. Role + computedName + landmarkAncestor
  if (
    fp.role === id.role &&
    fp.computedName &&
    id.computedName &&
    fp.computedName === id.computedName &&
    fp.landmarkAncestor &&
    id.landmarkAncestor &&
    fp.landmarkAncestor === id.landmarkAncestor
  ) {
    return 0.8;
  }

  // 6. Role + placeholder
  if (
    fp.role === id.role &&
    fp.placeholder &&
    id.placeholder &&
    fp.placeholder === id.placeholder
  ) {
    return 0.75;
  }

  return 0;
}
