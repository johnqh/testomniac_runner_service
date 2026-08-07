import type { BrowserAdapter } from "../adapter.js";
import {
  waitForStableDom,
  DOM_FINGERPRINT_SCRIPT,
} from "../browser/dom-stability.js";

/**
 * Single read-gate: wait for the page to settle before the scanner reads HTML
 * or decomposes the page.
 *
 * Two waits, because neither alone is sufficient. Network idle (10ms window,
 * 50ms floor, 5s stale cutoff, 10s cap) covers requests still in flight. DOM
 * stability covers what network idle cannot: a single-page app renders AFTER
 * its chunk resolves, with nothing in flight while it does, so a network-only
 * gate returns while the page still reads "Loading...".
 *
 * Both no-op safely. Network idle is skipped by adapters that cannot observe
 * traffic; DOM stability is skipped when the very first sample fails, which
 * means the adapter cannot evaluate at all. Only a LATER failure counts as
 * instability — that is a navigation detaching the context, which genuinely
 * means the page is still changing. Retrying a sampler that never worked would
 * spend the full cap on every read.
 */
export async function settleForRead(
  adapter: Partial<Pick<BrowserAdapter, "waitForNetworkIdle" | "evaluate">>
): Promise<void> {
  await adapter.waitForNetworkIdle?.();

  const evaluate = adapter.evaluate;
  if (!evaluate) return;
  let first: string;
  try {
    first = (await evaluate.call(adapter, DOM_FINGERPRINT_SCRIPT)) as string;
  } catch {
    return;
  }

  let seeded = false;
  await waitForStableDom(async () => {
    if (!seeded) {
      seeded = true;
      return first;
    }
    return evaluate.call(adapter, DOM_FINGERPRINT_SCRIPT) as Promise<string>;
  });
}
