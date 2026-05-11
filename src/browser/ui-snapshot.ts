export interface UiSnapshot {
  activeElementSelector?: string;
  dialogCount: number;
  toastCount: number;
  feedbackTexts: string[];
}

import type { BrowserAdapter } from "../adapter";

export async function captureUiSnapshot(
  adapter: BrowserAdapter
): Promise<UiSnapshot> {
  return adapter.evaluate(() => {
    function bestSelector(el: Element | null): string | undefined {
      if (!el) return undefined;
      if (el.hasAttribute("data-tmnc-id")) {
        return `[data-tmnc-id="${el.getAttribute("data-tmnc-id")}"]`;
      }
      if (el.id) return `#${el.id}`;
      const name = el.getAttribute("name");
      if (name) return `[name="${name}"]`;
      return el.tagName.toLowerCase();
    }

    function visibleText(el: Element): string {
      return el.textContent?.replace(/\s+/g, " ").trim().slice(0, 200) || "";
    }

    const dialogSelector = [
      "dialog[open]",
      '[role="dialog"]',
      '[role="alertdialog"]',
      '[aria-modal="true"]',
      ".modal",
      ".lightbox",
      ".overlay",
    ].join(", ");
    const feedbackSelector = [
      '[role="status"]',
      '[role="alert"]',
      '[aria-live="polite"]',
      '[aria-live="assertive"]',
      ".toast",
      ".snackbar",
      ".notification",
      ".alert",
      ".message",
      ".success",
      ".error",
    ].join(", ");

    const dialogs = Array.from(
      document.querySelectorAll(dialogSelector)
    ).filter(
      el =>
        visibleText(el).length > 0 || (el as HTMLElement).offsetParent !== null
    );
    const feedbackTexts = Array.from(
      document.querySelectorAll(feedbackSelector)
    )
      .map(el => visibleText(el))
      .filter(Boolean);

    return {
      activeElementSelector: bestSelector(document.activeElement),
      dialogCount: dialogs.length,
      toastCount: feedbackTexts.length,
      feedbackTexts,
    };
  });
}
