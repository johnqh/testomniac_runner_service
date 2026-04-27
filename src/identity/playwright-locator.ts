import type { ElementIdentity } from "@sudobility/testomniac_types";

const FORM_CONTROL_ROLES = new Set([
  "textbox",
  "checkbox",
  "radio",
  "combobox",
  "spinbutton",
  "slider",
  "switch",
]);

function escapeQuotes(s: string): { value: string; quote: string } {
  if (!s.includes("'")) return { value: s, quote: "'" };
  if (!s.includes('"')) return { value: s, quote: '"' };
  return { value: s.replace(/'/g, "\\'"), quote: "'" };
}

function wrap(method: string, arg: string): string {
  const { value, quote } = escapeQuotes(arg);
  return `${method}(${quote}${value}${quote})`;
}

function wrapRole(role: string, name: string): string {
  const { value, quote } = escapeQuotes(name);
  return `getByRole('${role}', { name: ${quote}${value}${quote} })`;
}

export function toPlaywrightLocator(identity: ElementIdentity): string {
  // 1. data-testid
  if (identity.testId) {
    return wrap("getByTestId", identity.testId);
  }

  // 2. Form controls with label
  if (identity.labelText && FORM_CONTROL_ROLES.has(identity.role)) {
    return wrap("getByLabel", identity.labelText);
  }

  // 3. Form controls with placeholder (no label)
  if (
    identity.placeholder &&
    FORM_CONTROL_ROLES.has(identity.role) &&
    !identity.labelText
  ) {
    return wrap("getByPlaceholder", identity.placeholder);
  }

  // 4. Role + accessible name (skip generic role)
  if (identity.computedName && identity.role !== "generic") {
    return wrapRole(identity.role, identity.computedName);
  }

  // 5. Images with alt text
  if (identity.altText) {
    return wrap("getByAltText", identity.altText);
  }

  // 6. Text content fallback (for generic elements)
  if (identity.computedName) {
    return wrap("getByText", identity.computedName);
  }

  // 7. CSS selector as last resort
  return `locator('${identity.cssSelector}')`;
}

export function buildScopeChain(identity: ElementIdentity): string | undefined {
  if (identity.groupName) {
    return wrapRole("group", identity.groupName);
  }
  if (identity.formContext) {
    return `locator('form[action="${identity.formContext}"]')`;
  }
  if (identity.landmarkAncestor) {
    return `getByRole('${identity.landmarkAncestor}')`;
  }
  return undefined;
}
