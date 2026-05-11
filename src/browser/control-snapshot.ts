import type { BrowserAdapter } from "../adapter";
import type { ControlState } from "../expertise/tester/control-state";

export async function captureControlStates(
  adapter: BrowserAdapter
): Promise<ControlState[]> {
  return adapter.evaluate(() => {
    function bestSelector(el: Element): string {
      if (el.hasAttribute("data-tmnc-id")) {
        return `[data-tmnc-id="${el.getAttribute("data-tmnc-id")}"]`;
      }
      if (el.id) return `#${el.id}`;
      const name = el.getAttribute("name");
      if (name) return `[name="${name}"]`;
      return el.tagName.toLowerCase();
    }

    function isVisible(el: Element): boolean {
      if (!(el instanceof HTMLElement)) return false;
      if (el.hidden) return false;
      if (el.closest('[hidden], [aria-hidden="true"], [inert]')) return false;

      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return false;
      if (el.getClientRects().length === 0) return false;

      const style = window.getComputedStyle(el);
      return (
        style.display !== "none" &&
        style.visibility === "visible" &&
        style.pointerEvents !== "none"
      );
    }

    function getLabel(el: Element): string | undefined {
      const ariaLabel = el.getAttribute("aria-label");
      if (ariaLabel) return ariaLabel.trim();

      if (
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        el instanceof HTMLSelectElement
      ) {
        if (el.id) {
          const label = document.querySelector(`label[for="${el.id}"]`);
          if (label?.textContent) return label.textContent.trim();
        }
        const parentLabel = el.closest("label");
        if (parentLabel?.textContent) return parentLabel.textContent.trim();
      }

      const labelledBy = el.getAttribute("aria-labelledby");
      if (labelledBy) {
        const text = labelledBy
          .split(/\s+/)
          .map(id => document.getElementById(id)?.textContent?.trim() ?? "")
          .filter(Boolean)
          .join(" ");
        if (text) return text;
      }

      return el.textContent?.trim() || undefined;
    }

    function getGroupKey(el: Element): string | undefined {
      const name = el.getAttribute("name");
      if (name) return `name:${name}`;

      const tablist = el.closest('[role="tablist"]');
      if (tablist) {
        return `tablist:${tablist.getAttribute("aria-label") || bestSelector(tablist)}`;
      }

      const radioGroup = el.closest('[role="radiogroup"], fieldset');
      if (radioGroup) return `group:${bestSelector(radioGroup)}`;

      const roleGroup = el.closest('[role="group"]');
      if (roleGroup) return `group:${bestSelector(roleGroup)}`;

      return undefined;
    }

    function hasPasswordRevealControl(el: Element): boolean {
      const container =
        el.closest("form, [role='group'], [role='region']") || el.parentElement;
      if (!container) return false;
      return Boolean(
        container.querySelector(
          [
            '[aria-label*="show password" i]',
            '[aria-label*="hide password" i]',
            'button[title*="show password" i]',
            'button[title*="hide password" i]',
            '[data-testid*="show-password" i]',
            '[data-testid*="toggle-password" i]',
          ].join(", ")
        )
      );
    }

    const selector = [
      "input",
      "textarea",
      "select",
      "button",
      "a[href]",
      '[role="button"]',
      '[role="link"]',
      '[role="menuitem"]',
      '[role="checkbox"]',
      '[role="radio"]',
      '[role="switch"]',
      '[role="tab"]',
      '[role="textbox"]',
      '[role="combobox"]',
      "[aria-expanded]",
    ].join(", ");

    const controls = Array.from(document.querySelectorAll(selector));
    return controls.map(el => {
      const input = el instanceof HTMLInputElement ? el : null;
      const textarea = el instanceof HTMLTextAreaElement ? el : null;
      const select = el instanceof HTMLSelectElement ? el : null;
      const role = el.getAttribute("role") || undefined;
      const inputType = input?.type || undefined;
      const isCheckboxLike =
        role === "checkbox" ||
        role === "radio" ||
        role === "switch" ||
        inputType === "checkbox" ||
        inputType === "radio";
      const checked = input
        ? input.checked
        : el.getAttribute("aria-checked") === "true";
      const selected =
        role === "tab" ? el.getAttribute("aria-selected") === "true" : checked;
      const value = input?.value ?? textarea?.value ?? select?.value ?? "";
      const selectedValues = select
        ? Array.from(select.selectedOptions).map(option => option.value)
        : selected
          ? [value]
          : [];

      const invalidNode =
        input ?? textarea ?? select ?? (el instanceof HTMLElement ? el : null);
      const invalid =
        invalidNode instanceof HTMLElement &&
        "matches" in invalidNode &&
        typeof invalidNode.matches === "function"
          ? invalidNode.matches(":invalid")
          : el.getAttribute("aria-invalid") === "true";
      const expandedAttr = el.getAttribute("aria-expanded");
      const validationMessage =
        input?.validationMessage ||
        textarea?.validationMessage ||
        select?.validationMessage ||
        undefined;

      return {
        selector: bestSelector(el),
        tagName: el.tagName,
        role,
        inputType,
        inputMode: input?.inputMode || textarea?.inputMode || undefined,
        name: el.getAttribute("name") || undefined,
        label: getLabel(el),
        groupName: el.getAttribute("data-group-name") || undefined,
        groupKey: getGroupKey(el),
        formContext:
          el.closest("form")?.getAttribute("action") ||
          el.closest("form")?.getAttribute("id") ||
          undefined,
        disabled:
          input?.disabled ||
          textarea?.disabled ||
          select?.disabled ||
          el.getAttribute("aria-disabled") === "true" ||
          false,
        readOnly:
          input?.readOnly ||
          textarea?.readOnly ||
          el.getAttribute("aria-readonly") === "true" ||
          false,
        required:
          input?.required ||
          textarea?.required ||
          select?.required ||
          el.getAttribute("aria-required") === "true" ||
          false,
        visible: isVisible(el),
        checked: isCheckboxLike ? checked : false,
        selected,
        value,
        selectedValues,
        invalid,
        validationMessage,
        expanded:
          expandedAttr == null
            ? undefined
            : expandedAttr.toLowerCase() === "true",
        passwordMasked: inputType === "password",
        hasPasswordRevealControl:
          inputType === "password" ? hasPasswordRevealControl(el) : false,
      };
    });
  });
}
