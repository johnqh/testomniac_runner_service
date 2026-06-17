/**
 * Shared "wait until the network is quiet" primitive used by every
 * BrowserAdapter. Adapters feed their native request-lifecycle events into a
 * NetworkIdleTracker; the scanner calls waitForNetworkIdle() before reading
 * page HTML so late-arriving XHR/JS content is captured.
 */

export interface NetworkIdleOptions {
  /** Quiet window: required ms of zero busy requests before resolving. */
  idleMs?: number;
  /** Minimum ms before idle may be declared (absorbs click->request race). */
  floorMs?: number;
  /** A request still open after this many ms stops counting (hung/long-poll). */
  staleMs?: number;
  /** Hard cap: resolve anyway after this many ms. */
  timeout?: number;
  /** Poll cadence. */
  pollMs?: number;
}

export interface NetworkIdleDeps {
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Invoked when the hard cap is hit before idle was reached. */
  onTimeout?: () => void;
}

export const NETWORK_IDLE_DEFAULTS: Required<NetworkIdleOptions> = {
  idleMs: 10,
  floorMs: 50,
  staleMs: 5000,
  timeout: 10000,
  pollMs: 10,
};

/** Resource types that hold a connection open indefinitely by design. */
const PERSISTENT_TYPES = new Set(["websocket", "eventsource"]);

export class NetworkIdleTracker {
  private inflight = new Map<string, { type: string; startTs: number }>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  start(requestId: string, resourceType: string): void {
    this.inflight.set(requestId, {
      type: (resourceType || "other").toLowerCase(),
      startTs: this.now(),
    });
  }

  end(requestId: string): void {
    this.inflight.delete(requestId);
  }

  clear(): void {
    this.inflight.clear();
  }

  /** In-flight requests that should gate idle: not persistent, not stale. */
  activeCount(now: number, staleMs: number): number {
    let count = 0;
    for (const { type, startTs } of this.inflight.values()) {
      if (PERSISTENT_TYPES.has(type)) continue;
      if (now - startTs >= staleMs) continue;
      count++;
    }
    return count;
  }
}

export async function waitForNetworkIdle(
  tracker: NetworkIdleTracker,
  options: NetworkIdleOptions = {},
  deps: NetworkIdleDeps = {}
): Promise<void> {
  const { idleMs, floorMs, staleMs, timeout, pollMs } = {
    ...NETWORK_IDLE_DEFAULTS,
    ...options,
  };
  const now = deps.now ?? (() => Date.now());
  const sleep =
    deps.sleep ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)));

  const startedAt = now();
  let lastBusyAt = startedAt;

  for (;;) {
    const t = now();
    const elapsed = t - startedAt;
    const active = tracker.activeCount(t, staleMs);
    if (active > 0) lastBusyAt = t;

    if (elapsed >= timeout) {
      deps.onTimeout?.();
      return;
    }
    if (elapsed >= floorMs && active === 0 && t - lastBusyAt >= idleMs) {
      return;
    }
    await sleep(pollMs);
  }
}
