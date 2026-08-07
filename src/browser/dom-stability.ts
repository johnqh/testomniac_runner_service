/**
 * Wait for the DOM to stop changing.
 *
 * Network idle is not enough for a single-page app. The framework renders
 * AFTER the chunk request resolves, and nothing is in flight while it does, so
 * a network-quiet gate returns while the page still reads "Loading...". That
 * is not a cosmetic problem for a scanner: a half-rendered page has different
 * controls, so it gets a different view identity, thinner content for a goal
 * to match against, and — worst — an incomplete set of outbound links, which
 * silently removes routes from the graph.
 *
 * Measured on a real scan before this existed: four of five recorded views
 * contained "Loading...", and the home page had no footer links at all.
 */

export interface DomStabilityOptions {
  /** Consecutive identical samples required before the DOM counts as stable. */
  stableSamples?: number;
  /** Delay between samples. */
  pollMs?: number;
  /** Hard cap. A page that never stops changing must not stall the scan. */
  timeout?: number;
}

export const DOM_STABILITY_DEFAULTS: Required<DomStabilityOptions> = {
  stableSamples: 2,
  pollMs: 100,
  timeout: 3000,
};

export interface DomStabilityDeps {
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Called when the cap was hit before the DOM settled. */
  onTimeout?: () => void;
}

/**
 * Resolve once `sample` returns the same fingerprint `stableSamples` times in
 * a row, or once the cap elapses.
 *
 * Returning on the cap rather than throwing is deliberate: a page with a
 * spinner, a clock or a polling widget never settles, and a scan of it should
 * be slightly stale rather than dead.
 */
export async function waitForStableDom(
  sample: () => Promise<string>,
  options: DomStabilityOptions = {},
  deps: DomStabilityDeps = {}
): Promise<void> {
  const { stableSamples, pollMs, timeout } = {
    ...DOM_STABILITY_DEFAULTS,
    ...options,
  };
  const now = deps.now ?? (() => Date.now());
  const sleep =
    deps.sleep ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)));

  const startedAt = now();
  let previous: string | undefined;
  let repeats = 0;

  for (;;) {
    let current: string;
    try {
      current = await sample();
    } catch {
      // A navigation mid-sample detaches the context. The page is changing by
      // definition, so treat it as not-yet-stable and let the cap end it.
      current = `unreadable:${now()}`;
    }

    repeats = current === previous ? repeats + 1 : 0;
    previous = current;
    if (repeats + 1 >= stableSamples) return;

    if (now() - startedAt >= timeout) {
      deps.onTimeout?.();
      return;
    }
    await sleep(pollMs);
  }
}

/**
 * A cheap fingerprint of what the page currently shows.
 *
 * Element count catches structure appearing; text length catches a spinner
 * being replaced by content. Together they cover the two ways a lazy route
 * finishes rendering.
 */
export const DOM_FINGERPRINT_SCRIPT = (): string =>
  `${document.querySelectorAll("*").length}:${(document.body?.innerText ?? "").length}`;
