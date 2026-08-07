import type { BrowserAdapter } from "../adapter.js";

export async function detectAndHandleModal(
  adapter: BrowserAdapter
): Promise<{ found: boolean; content: string | null }> {
  const result = await adapter.evaluate(() => {
    const modalSelectors = [
      ".pum-active .pum-container",
      ".modal.show .modal-content",
      '[role="dialog"][aria-modal="true"]',
      ".modal-overlay.active",
      ".popup.active",
      ".lightbox.active",
      "[data-modal].active",
      ".fancybox-container",
    ];

    for (const sel of modalSelectors) {
      const modal = document.querySelector(sel);
      if (modal && (modal as HTMLElement).offsetWidth > 0) {
        const text = modal.textContent?.trim().slice(0, 500) || "";
        return { found: true, content: text };
      }
    }
    return { found: false, content: null };
  });
  return (
    (result as { found: boolean; content: string | null }) || {
      found: false,
      content: null,
    }
  );
}

export async function dismissModal(adapter: BrowserAdapter): Promise<boolean> {
  const dismissed = await adapter.evaluate(() => {
    const closeSelectors = [
      ".pum-active .pum-close",
      ".pum-active .popmake-close",
      ".modal.show .close",
      ".modal.show .btn-close",
      '[role="dialog"] [aria-label="Close"]',
      '[role="dialog"] .close-button',
      ".modal-overlay.active .close",
      ".popup.active .close",
      ".fancybox-close",
    ];

    for (const sel of closeSelectors) {
      const btn = document.querySelector(sel) as HTMLElement | null;
      if (btn && btn.offsetWidth > 0) {
        btn.click();
        return true;
      }
    }

    const overlay = document.querySelector(
      ".pum-overlay.pum-active.pum-click-to-close"
    ) as HTMLElement | null;
    if (overlay) {
      overlay.click();
      return true;
    }

    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
    );
    return false;
  });

  if (dismissed) {
    await new Promise(r => setTimeout(r, 500));
  }
  return dismissed as boolean;
}
