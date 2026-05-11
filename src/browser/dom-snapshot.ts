import type { BrowserAdapter } from "../adapter";
import type { DomSnapshotEntry } from "../extractors/types";

export async function buildDomSnapshot(
  adapter: BrowserAdapter
): Promise<DomSnapshotEntry[]> {
  const rawItems = await adapter.evaluate(() => {
    const BASE_SELECTOR = [
      "a[href]",
      "button",
      'input:not([type="hidden"])',
      "select",
      "textarea",
      "summary",
      "label",
      "video",
      "audio",
      '[contenteditable=""]',
      '[contenteditable="true"]',
      '[tabindex]:not([tabindex="-1"])',
      '[role="button"]',
      '[role="link"]',
      '[role="checkbox"]',
      '[role="radio"]',
      '[role="switch"]',
      '[role="tab"]',
      '[role="menuitem"]',
      '[role="textbox"]',
      '[role="combobox"]',
      '[role="option"]',
      '[role="slider"]',
      '[role="spinbutton"]',
      '[role="progressbar"]',
      '[role="listbox"]',
      '[role="gridcell"]',
      '[role="treeitem"]',
      "[onclick]",
      "[ondblclick]",
      "[onmousedown]",
      "[onmouseup]",
      "[onmouseover]",
      "[onmouseenter]",
      "[onpointerdown]",
      "[onpointerup]",
      ".ui-sortable-handle",
      ".ui-draggable-handle",
    ].join(", ");

    function isVisible(el: Element): boolean {
      if (!(el instanceof HTMLElement)) return false;
      if (el.hidden) return false;
      if (el.closest('[hidden], [aria-hidden="true"], [inert]')) return false;

      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return false;
      if (el.getClientRects().length === 0) return false;

      const style = window.getComputedStyle(el);
      if (style.display === "none" || style.visibility !== "visible") {
        return false;
      }
      if (style.opacity === "0" || Number(style.opacity) < 0.05) {
        return false;
      }
      if (style.pointerEvents === "none") return false;

      return true;
    }

    function isClickableAncestor(el: Element): boolean {
      const style = window.getComputedStyle(el);
      return (
        el.hasAttribute("onclick") ||
        el.hasAttribute("ondblclick") ||
        el.hasAttribute("onmousedown") ||
        el.hasAttribute("onmouseup") ||
        el.hasAttribute("onmouseover") ||
        el.hasAttribute("onmouseenter") ||
        el.hasAttribute("onpointerdown") ||
        el.hasAttribute("onpointerup") ||
        style.cursor === "pointer" ||
        style.cursor === "copy" ||
        el.hasAttribute("data-toggle")
      );
    }

    function bestTarget(el: Element): Element {
      let current: Element | null = el;
      let best = el;

      while (current && current !== document.body) {
        const parent: HTMLElement | null = current.parentElement;
        if (!parent) break;
        if (!isClickableAncestor(parent)) break;

        const currentRect = current.getBoundingClientRect();
        const parentRect = parent.getBoundingClientRect();
        const currentArea = currentRect.width * currentRect.height;
        const parentArea = parentRect.width * parentRect.height;

        if (parentArea > currentArea * 6) break;
        best = parent;
        current = parent;
      }

      return best;
    }

    function shouldKeepExactInteractiveTarget(el: Element): boolean {
      return el.matches(
        [
          "a[href]",
          "button",
          'input:not([type="hidden"])',
          "select",
          "textarea",
          "summary",
          "label",
          "video",
          "audio",
          '[contenteditable=""]',
          '[contenteditable="true"]',
          '[tabindex]:not([tabindex="-1"])',
          '[role="button"]',
          '[role="link"]',
          '[role="checkbox"]',
          '[role="radio"]',
          '[role="switch"]',
          '[role="tab"]',
          '[role="menuitem"]',
          '[role="textbox"]',
          '[role="combobox"]',
          '[role="option"]',
          '[role="slider"]',
          '[role="spinbutton"]',
          '[role="progressbar"]',
          '[role="listbox"]',
          '[role="gridcell"]',
          '[role="treeitem"]',
        ].join(", ")
      );
    }

    interface SnapshotEntry {
      selector: string;
      tagName: string;
      role?: string;
      inputType?: string;
      accessibleName?: string;
      textContent?: string;
      href?: string;
      disabled: boolean;
      visible: boolean;
      x: number;
      y: number;
      width: number;
      height: number;
      attributes: Record<string, string>;
      sourceHints: string[];
      groupName?: string;
      headingContext?: string;
      landmarkAncestor?: string;
      testId?: string;
      formContext?: string;
    }

    const entries: SnapshotEntry[] = [];
    const seen = new Set<Element>();
    let idx = 0;

    function pushEntry(el: Element, sourceHint?: string) {
      if (seen.has(el)) return;
      seen.add(el);

      const rect = el.getBoundingClientRect();
      if (rect.width < 8 || rect.height < 8) return;

      const uid = `tmnc-${idx++}`;
      el.setAttribute("data-tmnc-id", uid);

      const tagName = el.tagName;
      const role = el.getAttribute("role") || undefined;
      const ariaLabel = el.getAttribute("aria-label") || "";
      const textContent = el.textContent?.trim().slice(0, 80) || "";
      const name = ariaLabel || textContent;
      const href = el.getAttribute("href") || undefined;
      const inputType =
        el instanceof HTMLInputElement ? el.type || undefined : undefined;
      const hints: string[] = [];

      if (el.matches("a[href]")) hints.push("anchor");
      if (el.matches("button")) hints.push("button");
      if (el.matches('input:not([type="hidden"])')) hints.push("input");
      if (el.matches("select")) hints.push("select");
      if (el.matches("textarea")) hints.push("textarea");
      if (el.matches("summary")) hints.push("summary");
      if (el.matches("label")) hints.push("label");
      if (el.matches("video")) hints.push("video");
      if (el.matches("audio")) hints.push("audio");
      if (el.matches('[contenteditable=""], [contenteditable="true"]')) {
        hints.push("contenteditable");
      }
      if (el.hasAttribute("tabindex") && el.getAttribute("tabindex") !== "-1") {
        hints.push("tabindex");
      }
      if (role) hints.push(`role:${role}`);
      if (sourceHint) hints.push(sourceHint);
      if (
        el.hasAttribute("onclick") ||
        el.hasAttribute("ondblclick") ||
        el.hasAttribute("onmousedown") ||
        el.hasAttribute("onmouseup") ||
        el.hasAttribute("onmouseover") ||
        el.hasAttribute("onmouseenter") ||
        el.hasAttribute("onpointerdown") ||
        el.hasAttribute("onpointerup")
      ) {
        hints.push("mouse-handler");
      }
      if (
        el.classList?.contains("ui-sortable-handle") ||
        el.classList?.contains("ui-draggable-handle")
      ) {
        hints.push("drag-handle");
      }

      const attrs: Record<string, string> = {};
      const placeholder =
        el.getAttribute("placeholder") || (el as HTMLInputElement).placeholder;
      if (placeholder) attrs.placeholder = placeholder;
      const elName = el.getAttribute("name");
      if (elName) attrs.name = elName;
      const elId = el.getAttribute("id");
      if (elId) attrs.id = elId;
      const autocomplete = el.getAttribute("autocomplete");
      if (autocomplete) attrs.autocomplete = autocomplete;
      const pattern = el.getAttribute("pattern");
      if (pattern) attrs.pattern = pattern;
      const ariaExpanded = el.getAttribute("aria-expanded");
      if (ariaExpanded != null) attrs["aria-expanded"] = ariaExpanded;
      if (
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        el instanceof HTMLSelectElement
      ) {
        const id2 = el.id;
        if (id2) {
          const label2 = document.querySelector(`label[for="${id2}"]`);
          if (label2) {
            attrs.labelText = label2.textContent?.trim().slice(0, 80) || "";
          }
        }
        if (!attrs.labelText) {
          const parentLabel = el.closest("label");
          if (parentLabel) {
            attrs.labelText =
              parentLabel.textContent?.trim().slice(0, 80) || "";
          }
        }
        if (!attrs.labelText) {
          const prev = el.previousElementSibling;
          if (
            prev &&
            (prev.tagName === "LABEL" ||
              prev.tagName === "SPAN" ||
              prev.tagName === "DIV")
          ) {
            attrs.labelText = prev.textContent?.trim().slice(0, 80) || "";
          }
        }
        if (el instanceof HTMLSelectElement) {
          attrs.options = JSON.stringify(
            Array.from(el.options)
              .map(option => option.value)
              .filter(Boolean)
          );
        }
      }

      // --- Identity signals ---
      const testId =
        el.getAttribute("data-testid") ||
        el.getAttribute("data-test-id") ||
        el.getAttribute("data-cy") ||
        undefined;

      let groupName: string | undefined;
      const fieldset = el.closest("fieldset");
      if (fieldset) {
        const legend = fieldset.querySelector("legend");
        if (legend) groupName = legend.textContent?.trim().slice(0, 80);
      }
      if (!groupName) {
        const radioGroup = el.closest('[role="radiogroup"], [role="group"]');
        if (radioGroup) {
          const lblBy = radioGroup.getAttribute("aria-labelledby");
          groupName =
            radioGroup.getAttribute("aria-label") ||
            (lblBy
              ? document.getElementById(lblBy)?.textContent?.trim().slice(0, 80)
              : undefined);
        }
      }

      let headingContext: string | undefined;
      let prevEl: Element | null = el;
      for (let i = 0; i < 50 && prevEl; i++) {
        const prevSibling: Element | null = prevEl.previousElementSibling;
        if (prevSibling) {
          if (/^H[1-6]$/.test(prevSibling.tagName)) {
            headingContext = prevSibling.textContent?.trim().slice(0, 80);
            break;
          }
          const nested = prevSibling.querySelector("h1,h2,h3,h4,h5,h6");
          if (nested) {
            headingContext = nested.textContent?.trim().slice(0, 80);
            break;
          }
          prevEl = prevSibling;
        } else {
          prevEl = prevEl.parentElement;
        }
      }

      const landmarkTags: Record<string, string> = {
        HEADER: "banner",
        NAV: "navigation",
        MAIN: "main",
        ASIDE: "complementary",
        FOOTER: "contentinfo",
      };
      let landmarkAncestor: string | undefined;
      const landmarkEl = el.closest(
        '[role="banner"],[role="navigation"],[role="main"],[role="complementary"],[role="contentinfo"],[role="form"],[role="region"],[role="search"],header,nav,main,aside,footer,form[aria-label],section[aria-label]'
      );
      if (landmarkEl && landmarkEl !== el) {
        landmarkAncestor =
          landmarkEl.getAttribute("role") ||
          landmarkTags[landmarkEl.tagName] ||
          undefined;
      }

      let formContext: string | undefined;
      const formEl = el.closest("form");
      if (formEl) {
        formContext =
          formEl.getAttribute("action") ||
          formEl.getAttribute("id") ||
          formEl.getAttribute("name") ||
          undefined;
      }

      entries.push({
        selector: `[data-tmnc-id="${uid}"]`,
        tagName,
        role,
        inputType,
        accessibleName: name || undefined,
        textContent: textContent || undefined,
        href,
        disabled:
          (el instanceof HTMLButtonElement ||
            el instanceof HTMLInputElement ||
            el instanceof HTMLSelectElement ||
            el instanceof HTMLTextAreaElement) &&
          el.disabled,
        visible: isVisible(el),
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        attributes: attrs,
        sourceHints: hints,
        groupName,
        headingContext,
        landmarkAncestor,
        testId,
        formContext,
      });
    }

    document.querySelectorAll(BASE_SELECTOR).forEach(sourceEl => {
      if (shouldKeepExactInteractiveTarget(sourceEl)) {
        pushEntry(sourceEl, "exact-target");
      } else {
        const promotedTarget = bestTarget(sourceEl);
        if (promotedTarget !== sourceEl) {
          pushEntry(sourceEl, "source-target");
          pushEntry(promotedTarget, "promoted-target");
        } else {
          pushEntry(sourceEl, "source-target");
        }
      }
    });

    const allElements = document.querySelectorAll("body *");
    for (let i = 0; i < allElements.length; i++) {
      const el = allElements[i];
      if (seen.has(el)) continue;
      if (!(el instanceof HTMLElement)) continue;

      const rect = el.getBoundingClientRect();
      if (rect.width < 8 || rect.height < 8) continue;

      const style = window.getComputedStyle(el);
      if (style.display === "none" || style.visibility !== "visible") continue;
      const cur = style.cursor;
      if (
        cur !== "pointer" &&
        cur !== "copy" &&
        cur !== "grab" &&
        cur !== "move"
      )
        continue;

      let ancestorCaptured = false;
      let parent = el.parentElement;
      while (parent && parent !== document.body) {
        if (seen.has(parent)) {
          ancestorCaptured = true;
          break;
        }
        parent = parent.parentElement;
      }
      if (ancestorCaptured) continue;

      pushEntry(el, "cursor-pointer");
    }

    return entries;
  });

  return ((rawItems as DomSnapshotEntry[]) || []).filter(Boolean);
}
