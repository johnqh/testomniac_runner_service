import type { BrowserAdapter } from "../adapter";

/**
 * Single read-gate: wait for the page network to settle before the scanner
 * reads HTML / decomposes the page. Uses adapter defaults (10ms idle window,
 * 50ms floor, 5s stale cutoff, 10s cap). No-ops for adapters that cannot
 * observe network activity.
 */
export async function settleForRead(
  adapter: Pick<BrowserAdapter, "waitForNetworkIdle">
): Promise<void> {
  await adapter.waitForNetworkIdle?.();
}
