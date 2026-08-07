import type { BrowserAdapter } from "../adapter.js";
import type { ScanPageSignals } from "@sudobility/testomniac_types";

/**
 * Derive the values the server used to compute from raw page HTML.
 *
 * These exist so the HTML need not cross the wire at all. The server-side
 * versions were regexes over markup (`/<tr\b/gi`, `/role=["']dialog["']/i`);
 * here the live DOM answers the same questions exactly and more cheaply — a
 * `<tr>` inserted by script counts, and a `dialog` that is present but closed
 * correctly does not.
 *
 * A markdown payload could not support any of these: it contains no tags to
 * count, so each check would silently return zero.
 */
export async function capturePageSignals(
  adapter: BrowserAdapter
): Promise<ScanPageSignals> {
  return adapter.evaluate(() => {
    const hasOpenDialog = (): boolean => {
      if (document.querySelector("dialog[open]")) return true;
      if (
        document.querySelector(
          '[role="dialog"], [role="alertdialog"], [aria-modal="true"]'
        )
      ) {
        return true;
      }
      // The server matched /\bmodal\b/i and /\boverlay\b/i anywhere in the
      // markup, which fired on any class containing those words. Keep that
      // reach, but only for elements actually rendered.
      const candidates = document.querySelectorAll(
        '[class*="modal" i], [class*="overlay" i]'
      );
      for (const element of Array.from(candidates)) {
        const rect = (element as HTMLElement).getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) return true;
      }
      return false;
    };

    const collectionCount = (): number => {
      const rows = document.querySelectorAll("tr").length;
      if (rows > 0) return rows;
      const items = document.querySelectorAll("li").length;
      if (items > 0) return items;
      return document.querySelectorAll(
        'article[class*="product" i], article[class*="card" i],' +
          'article[class*="result" i], article[class*="item" i],' +
          'article[class*="row" i], section[class*="product" i],' +
          'section[class*="card" i], section[class*="result" i],' +
          'section[class*="item" i], section[class*="row" i],' +
          'div[class*="product" i], div[class*="card" i],' +
          'div[class*="result" i], div[class*="item" i],' +
          'div[class*="row" i]'
      ).length;
    };

    return {
      hasOpenDialog: hasOpenDialog(),
      collectionCount: collectionCount(),
      visibleText: (document.body?.innerText ?? "").replace(/\s+/g, " ").trim(),
      title: document.title || undefined,
    };
  });
}
