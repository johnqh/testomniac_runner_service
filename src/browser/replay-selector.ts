import type {
  ActionableItem,
  ActionableItemResponse,
} from "@sudobility/testomniac_types";
import type { ControlState } from "../expertise/tester/control-state";

const REPLAY_SELECTOR_PREFIX = "tmnc-replay:";

export type ReplaySelectorMetadata = {
  css?: string;
  tagName?: string;
  role?: string;
  inputType?: string;
  accessibleName?: string;
  textContent?: string;
  href?: string;
  testId?: string;
  id?: string;
  name?: string;
  placeholder?: string;
};

function normalizeText(value: string | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

export function isTransientSnapshotSelector(selector?: string | null): boolean {
  return Boolean(selector && selector.includes("data-tmnc-id"));
}

export function isReplaySelector(selector?: string | null): boolean {
  return Boolean(selector && selector.startsWith(REPLAY_SELECTOR_PREFIX));
}

export function encodeReplaySelector(metadata: ReplaySelectorMetadata): string {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(metadata)) {
    const normalizedValue = normalizeText(value);
    if (normalizedValue.length > 0) {
      params.set(key, normalizedValue);
    }
  }

  return `${REPLAY_SELECTOR_PREFIX}${params.toString()}`;
}

export function parseReplaySelector(
  selector?: string | null
): ReplaySelectorMetadata | null {
  if (!isReplaySelector(selector)) {
    return null;
  }

  const raw = (selector ?? "").slice(REPLAY_SELECTOR_PREFIX.length);
  const params = new URLSearchParams(raw);
  const metadata: ReplaySelectorMetadata = {};

  for (const key of [
    "css",
    "tagName",
    "role",
    "inputType",
    "accessibleName",
    "textContent",
    "href",
    "testId",
    "id",
    "name",
    "placeholder",
  ] as const) {
    const value = normalizeText(params.get(key) ?? "");
    if (value.length > 0) {
      metadata[key] = value;
    }
  }

  return metadata;
}

export function buildReplaySelectorFromActionableItem(
  item: ActionableItem
): string {
  const css =
    item.selector && !isTransientSnapshotSelector(item.selector)
      ? item.selector
      : undefined;

  return encodeReplaySelector({
    css,
    tagName: item.tagName,
    role: item.role,
    inputType: item.inputType,
    accessibleName: item.accessibleName,
    textContent: item.textContent,
    href: item.href,
    testId: asString(item.attributes?._testId),
    id: asString(item.attributes?.id),
    name: asString(item.attributes?.name),
    placeholder: asString(item.attributes?.placeholder),
  });
}

export function buildReplaySelectorFromDescription(
  actionType: string,
  description: string,
  fallbackPath?: string
): string | undefined {
  const compact = normalizeText(description.split("\n")[0] ?? description);
  const prefixes = [
    "Hover over ",
    "Click ",
    "Select variant ",
    "Select ",
    "Type into ",
    "Activate ",
  ];

  let label = compact;
  for (const prefix of prefixes) {
    if (label.startsWith(prefix)) {
      label = label.slice(prefix.length);
      break;
    }
  }

  for (const token of [" leads to ", " should "]) {
    const index = label.toLowerCase().indexOf(token.trim());
    if (index > 0) {
      label = label.slice(0, index).trim();
    }
  }

  if (!label) {
    return undefined;
  }

  return encodeReplaySelector({
    css:
      fallbackPath && !isTransientSnapshotSelector(fallbackPath)
        ? fallbackPath
        : undefined,
    tagName: actionType === "selectOption" ? "select" : undefined,
    accessibleName: label,
    textContent: label,
  });
}

export function matchesControlSelector(
  selector: string | undefined,
  state: ControlState
): boolean {
  if (!selector) return false;
  if (!isReplaySelector(selector)) {
    return state.selector === selector;
  }

  const replay = parseReplaySelector(selector);
  if (!replay) return false;

  const normalizedLabel = normalizeText(state.label);
  const normalizedName = normalizeText(state.name);

  if (
    replay.tagName &&
    replay.tagName.toLowerCase() !== state.tagName.toLowerCase()
  ) {
    return false;
  }

  if (
    replay.role &&
    replay.role.toLowerCase() !== (state.role ?? "").toLowerCase()
  ) {
    return false;
  }

  if (
    replay.inputType &&
    replay.inputType.toLowerCase() !== (state.inputType ?? "").toLowerCase()
  ) {
    return false;
  }

  const targetNames = [
    normalizeText(replay.accessibleName),
    normalizeText(replay.textContent),
  ].filter(Boolean);

  if (targetNames.length > 0) {
    const matchesName = targetNames.some(
      target =>
        target === normalizedLabel ||
        target === normalizedName ||
        normalizedLabel.includes(target) ||
        normalizedName.includes(target)
    );

    if (!matchesName) {
      return false;
    }
  }

  if (replay.name && replay.name !== state.name) {
    return false;
  }

  if (
    replay.placeholder &&
    replay.placeholder !== state.name &&
    replay.placeholder !== state.label
  ) {
    return false;
  }

  return true;
}

export function matchesActionableItemSelector(
  selector: string | undefined,
  item: ActionableItem | ActionableItemResponse
): boolean {
  if (!selector) return false;

  const itemSelector = item.selector ?? undefined;
  if (!isReplaySelector(selector)) {
    return itemSelector === selector;
  }

  const replay = parseReplaySelector(selector);
  if (!replay) return false;

  const tagName = normalizeText(item.tagName ?? "").toLowerCase();
  const role = normalizeText(item.role ?? "").toLowerCase();
  const inputType = normalizeText(
    readActionableAttribute(item, "type")
  ).toLowerCase();
  const href = normalizeText(readActionableHref(item));
  const accessibleName = normalizeText(item.accessibleName ?? "");
  const textContent = normalizeText(readActionableTextContent(item));
  const testId = normalizeText(readActionableAttribute(item, "_testId"));
  const id = normalizeText(readActionableAttribute(item, "id"));
  const name = normalizeText(readActionableAttribute(item, "name"));
  const placeholder = normalizeText(
    readActionableAttribute(item, "placeholder")
  );

  if (replay.css && itemSelector && replay.css === itemSelector) {
    return true;
  }

  if (replay.tagName && replay.tagName.toLowerCase() !== tagName) {
    return false;
  }

  if (replay.role && replay.role.toLowerCase() !== role) {
    return false;
  }

  if (replay.inputType && replay.inputType.toLowerCase() !== inputType) {
    return false;
  }

  if (replay.href && replay.href !== href) {
    return false;
  }

  if (replay.testId && replay.testId !== testId) {
    return false;
  }

  if (replay.id && replay.id !== id) {
    return false;
  }

  if (replay.name && replay.name !== name) {
    return false;
  }

  if (replay.placeholder && replay.placeholder !== placeholder) {
    return false;
  }

  const targetNames = [
    normalizeText(replay.accessibleName),
    normalizeText(replay.textContent),
  ].filter(Boolean);

  if (targetNames.length > 0) {
    const haystacks = [accessibleName, textContent, name, placeholder].filter(
      Boolean
    );
    const matchesName = targetNames.some(target =>
      haystacks.some(
        value =>
          value === target || value.includes(target) || target.includes(value)
      )
    );

    if (!matchesName) {
      return false;
    }
  }

  return true;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readActionableAttribute(
  item: ActionableItem | ActionableItemResponse,
  key: string
): string | undefined {
  if ("attributes" in item) {
    return asString(item.attributes?.[key]);
  }

  if (
    item.attributesJson &&
    typeof item.attributesJson === "object" &&
    !Array.isArray(item.attributesJson)
  ) {
    return asString((item.attributesJson as Record<string, unknown>)[key]);
  }

  return undefined;
}

function readActionableHref(
  item: ActionableItem | ActionableItemResponse
): string | undefined {
  return "href" in item
    ? (asString(item.href) ?? readActionableAttribute(item, "href"))
    : undefined;
}

function readActionableTextContent(
  item: ActionableItem | ActionableItemResponse
): string | undefined {
  if ("textContent" in item) {
    return asString(item.textContent);
  }

  return readActionableAttribute(item, "textContent");
}
