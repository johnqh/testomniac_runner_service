import type { BrowserAdapter } from "../adapter";
import type { FormInfo } from "../domain/types";

type AnalyzerField = FormInfo["fields"][number] & {
  disabled?: boolean;
  readOnly?: boolean;
  appearanceHint?: string;
};

export async function extractForms(
  adapter: BrowserAdapter
): Promise<FormInfo[]> {
  return adapter.evaluate(() => extractFormsFromRoot(document));
}

export function extractFormsFromRoot(root: Document | Element): FormInfo[] {
  const documentRef = root instanceof Document ? root : root.ownerDocument;
  if (!documentRef) return [];

  const allControls = Array.from(
    root.querySelectorAll("input, textarea, select")
  ).filter(isSupportedControl);
  const explicitForms = Array.from(root.querySelectorAll("form"));
  const forms: FormInfo[] = [];
  const assignedControls = new Set<Element>();

  explicitForms.forEach((form, index) => {
    const fields = collectFields(form, documentRef);
    fields.forEach(field => {
      const fieldEl = safeQuerySelector(documentRef, field.selector);
      if (fieldEl) assignedControls.add(fieldEl);
    });

    if (fields.length === 0) return;
    forms.push(buildFormInfo(form, fields, index));
  });

  const orphanControls = allControls.filter(
    control => !assignedControls.has(control)
  );
  const grouped = groupOrphanControls(orphanControls);

  grouped.forEach((controls, index) => {
    const container = findGroupingContainer(controls[0]);
    const fields = dedupeBySelector(
      controls.map(control => buildField(control, documentRef))
    );
    if (!shouldCreatePseudoForm(fields, container)) return;

    forms.push({
      selector: container
        ? bestSelector(container)
        : `pseudo-form-${index + 1}`,
      action: "",
      method: inferMethod(fields),
      fields,
      submitSelector: container
        ? findSubmitSelector(container, documentRef)
        : undefined,
      fieldCount: fields.length,
    });
  });

  return dedupeForms(forms);
}

function groupOrphanControls(controls: Element[]): Element[][] {
  const groups = new Map<Element, Element[]>();

  for (const control of controls) {
    const container = findGroupingContainer(control) ?? control.parentElement;
    if (!container) continue;

    const existing = groups.get(container) ?? [];
    existing.push(control);
    groups.set(container, existing);
  }

  return Array.from(groups.values());
}

function collectFields(
  container: ParentNode,
  documentRef: Document
): AnalyzerField[] {
  const fields = Array.from(
    container.querySelectorAll("input, textarea, select")
  ).filter(isSupportedControl);

  return dedupeBySelector(fields.map(field => buildField(field, documentRef)));
}

function buildFormInfo(
  form: HTMLFormElement,
  fields: AnalyzerField[],
  index: number
): FormInfo {
  return {
    selector: form.id ? `#${form.id}` : `form:nth-of-type(${index + 1})`,
    action: form.getAttribute("action") || "",
    method: (form.getAttribute("method") || inferMethod(fields)).toUpperCase(),
    fields,
    submitSelector: findSubmitSelector(form, form.ownerDocument),
    fieldCount: fields.length,
  };
}

function buildField(el: Element, documentRef: Document): AnalyzerField {
  const input = el as HTMLInputElement;
  const labelEl = input.id
    ? documentRef.querySelector(`label[for="${input.id}"]`)
    : null;
  const ariaLabelledBy = el.getAttribute("aria-labelledby");
  const labelledByText = ariaLabelledBy
    ? ariaLabelledBy
        .split(/\s+/)
        .map(id => documentRef.getElementById(id)?.textContent?.trim() || "")
        .filter(Boolean)
        .join(" ")
    : "";
  const wrappingLabel = el.closest("label");

  return {
    selector: bestSelector(el),
    name: el.getAttribute("name") || "",
    type: input.type || el.tagName.toLowerCase(),
    label:
      el.getAttribute("aria-label") ||
      labelledByText ||
      labelEl?.textContent?.trim() ||
      wrappingLabel?.textContent?.trim() ||
      el.getAttribute("placeholder") ||
      "",
    required:
      el.hasAttribute("required") ||
      el.getAttribute("aria-required") === "true",
    disabled:
      (el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        el instanceof HTMLSelectElement) &&
      el.disabled,
    readOnly:
      (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) &&
      el.readOnly,
    appearanceHint: [
      el.getAttribute("class") || "",
      el.getAttribute("style") || "",
      el.getAttribute("aria-disabled") || "",
      el.getAttribute("data-testid") || "",
    ]
      .join(" ")
      .trim(),
    placeholder: el.getAttribute("placeholder") || undefined,
    options:
      el.tagName === "SELECT"
        ? Array.from((el as HTMLSelectElement).options).map(
            option => option.value
          )
        : undefined,
  };
}

function bestSelector(el: Element): string {
  if (el.id) return `#${cssEscape(el.id)}`;

  const name = el.getAttribute("name");
  if (name) return `[name="${escapeAttribute(name)}"]`;

  const testId =
    el.getAttribute("data-testid") || el.getAttribute("data-test") || "";
  if (testId) return `[data-testid="${escapeAttribute(testId)}"]`;

  const className = Array.from(el.classList)
    .find(token => token && !token.includes(":"))
    ?.trim();
  if (className) {
    return `${el.tagName.toLowerCase()}.${cssEscape(className)}`;
  }

  return buildNthSelector(el);
}

function buildNthSelector(el: Element): string {
  const segments: string[] = [];
  let current: Element | null = el;

  while (current && current.tagName !== "BODY" && segments.length < 4) {
    const tag = current.tagName.toLowerCase();
    const parent: Element | null = current.parentElement;
    if (!parent) {
      segments.unshift(tag);
      break;
    }

    const siblings = Array.from(parent.children).filter(
      (sibling: Element) => sibling.tagName === current?.tagName
    );
    const index = siblings.indexOf(current) + 1;
    segments.unshift(`${tag}:nth-of-type(${index})`);
    current = parent;
  }

  return segments.join(" > ");
}

function findGroupingContainer(control: Element): Element | null {
  let current = control.parentElement;

  while (current && current.tagName !== "BODY") {
    const controlCount = current.querySelectorAll(
      "input, textarea, select"
    ).length;
    const hasSubmit = hasSubmitCandidate(current);
    const hasFormSignals =
      controlCount > 1 ||
      hasSubmit ||
      current.getAttribute("role") === "form" ||
      matchesFormSignalText(
        [
          current.className,
          current.id,
          current.getAttribute("aria-label") || "",
          current.getAttribute("data-testid") || "",
        ].join(" ")
      );

    if (hasFormSignals && controlCount <= 12) {
      return current;
    }

    current = current.parentElement;
  }

  return control.parentElement;
}

function hasSubmitCandidate(container: ParentNode): boolean {
  return Boolean(findSubmitElement(container));
}

function findSubmitSelector(
  container: ParentNode,
  documentRef: Document
): string | undefined {
  const submitElement = findSubmitElement(container);
  if (!submitElement) return undefined;

  const selector = bestSelector(submitElement);
  return safeQuerySelector(documentRef, selector) ? selector : undefined;
}

function findSubmitElement(container: ParentNode): Element | null {
  const candidates = Array.from(
    container.querySelectorAll(
      'button, input[type="submit"], input[type="button"], a, [role="button"]'
    )
  );

  const submitCandidate = candidates.find(candidate => {
    const text = [
      candidate.textContent || "",
      candidate.getAttribute("value") || "",
      candidate.getAttribute("aria-label") || "",
      candidate.getAttribute("title") || "",
      candidate.getAttribute("name") || "",
      candidate.getAttribute("id") || "",
      candidate.className || "",
    ]
      .join(" ")
      .toLowerCase();

    return (
      candidate.getAttribute("type") === "submit" || isSubmitLikeText(text)
    );
  });

  return submitCandidate ?? null;
}

function shouldCreatePseudoForm(
  fields: AnalyzerField[],
  container: Element | null
): boolean {
  if (fields.length === 0) return false;
  if (fields.length > 1) return true;
  if (!container) return false;
  if (hasSubmitCandidate(container)) return true;

  const field = fields[0];
  return /^(email|password|search|tel|url|number|date|textarea|select-one|select)$/i.test(
    field.type
  );
}

function inferMethod(fields: AnalyzerField[]): string {
  return fields.some(field => /^(search)$/i.test(field.type)) ? "GET" : "POST";
}

function dedupeForms(forms: FormInfo[]): FormInfo[] {
  const seen = new Set<string>();
  return forms.filter(form => {
    const key = `${form.selector}|${form.fields.map(field => field.selector).join(",")}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function dedupeBySelector(fields: AnalyzerField[]): AnalyzerField[] {
  const seen = new Set<string>();
  return fields.filter(field => {
    if (!field.selector || seen.has(field.selector)) return false;
    seen.add(field.selector);
    return true;
  });
}

function isSupportedControl(el: Element): boolean {
  const type = ((el as HTMLInputElement).type || "").toLowerCase();
  return !["hidden", "submit", "button", "reset", "image", "file"].includes(
    type
  );
}

function safeQuerySelector(
  documentRef: Document,
  selector: string
): Element | null {
  try {
    return documentRef.querySelector(selector);
  } catch {
    return null;
  }
}

function escapeAttribute(value: string): string {
  return value.replace(/"/g, '\\"');
}

function cssEscape(value: string): string {
  return value.replace(/([ !"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, "\\$1");
}

function matchesFormSignalText(value: string): boolean {
  return /\b(form|search|login|signin|sign-in|register|account|contact|checkout)\b/i.test(
    value
  );
}

function isSubmitLikeText(value: string): boolean {
  return /\b(send|submit|search|sign in|signin|log in|login|register|create account|apply|continue|save|place order|checkout)\b/.test(
    value
  );
}

export const __test__ = {
  inferMethod,
  shouldCreatePseudoFormDescriptor(input: {
    fieldTypes: string[];
    hasSubmitCandidate: boolean;
  }): boolean {
    const fields = input.fieldTypes.map(type => ({
      selector: type,
      name: type,
      type,
      label: type,
      required: false,
    }));

    return input.fieldTypes.length > 1
      ? true
      : input.hasSubmitCandidate ||
          shouldCreatePseudoForm(
            fields,
            input.hasSubmitCandidate ? ({} as Element) : null
          );
  },
  matchesFormSignalText,
  isSubmitLikeText,
};
