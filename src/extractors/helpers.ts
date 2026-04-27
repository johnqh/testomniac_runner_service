import type {
  ActionKind,
  DomSnapshotEntry,
  ExtractorCandidate,
  SelectorResolvedCandidate,
} from "./types";

export function createCandidate(
  entry: DomSnapshotEntry,
  source: string
): ExtractorCandidate {
  return {
    selector: entry.selector,
    tagName: entry.tagName,
    role: entry.role,
    inputType: entry.inputType,
    accessibleName: entry.accessibleName,
    textContent: entry.textContent,
    href: entry.href,
    disabled: entry.disabled,
    visible: entry.visible,
    attributes: {
      ...entry.attributes,
      ...(entry.groupName ? { _groupName: entry.groupName } : {}),
      ...(entry.headingContext
        ? { _headingContext: entry.headingContext }
        : {}),
      ...(entry.landmarkAncestor
        ? { _landmarkAncestor: entry.landmarkAncestor }
        : {}),
      ...(entry.testId ? { _testId: entry.testId } : {}),
      ...(entry.formContext ? { _formContext: entry.formContext } : {}),
    },
    source,
  };
}

export function withResolvedSelector(
  candidate: ExtractorCandidate,
  actionKind: ActionKind
): SelectorResolvedCandidate {
  return {
    ...candidate,
    actionKind,
    stableKey:
      `${candidate.tagName}|${candidate.role || ""}|${candidate.accessibleName || ""}|${candidate.selector}`.slice(
        0,
        128
      ),
  };
}

export function uniqueBySelector<T extends { selector: string }>(
  items: T[]
): T[] {
  const seen = new Set<string>();
  return items.filter(item => {
    if (!item.selector || seen.has(item.selector)) return false;
    seen.add(item.selector);
    return true;
  });
}
