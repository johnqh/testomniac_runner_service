import { describe, it, expect } from "vitest";
import {
  NetworkIdleTracker,
  waitForNetworkIdle,
  NETWORK_IDLE_DEFAULTS,
} from "./network-idle";

describe("NetworkIdleTracker.activeCount", () => {
  it("counts normal in-flight requests", () => {
    const t = new NetworkIdleTracker(() => 1000);
    t.start("a", "document");
    t.start("b", "xhr");
    expect(t.activeCount(1000, 5000)).toBe(2);
    t.end("a");
    expect(t.activeCount(1000, 5000)).toBe(1);
  });

  it("ignores persistent types (websocket, eventsource) case-insensitively", () => {
    const t = new NetworkIdleTracker(() => 1000);
    t.start("ws", "WebSocket");
    t.start("sse", "eventsource");
    t.start("x", "fetch");
    expect(t.activeCount(1000, 5000)).toBe(1);
  });

  it("ignores requests older than staleMs", () => {
    const t = new NetworkIdleTracker(() => 1000);
    t.start("old", "xhr"); // started at 1000
    expect(t.activeCount(5999, 5000)).toBe(1); // 4999ms old -> still counts
    expect(t.activeCount(6000, 5000)).toBe(0); // 5000ms old -> stale
  });

  it("clear() empties the map", () => {
    const t = new NetworkIdleTracker(() => 1000);
    t.start("a", "xhr");
    t.clear();
    expect(t.activeCount(1000, 5000)).toBe(0);
  });
});

// Deterministic virtual clock: sleep() advances time and fires any actions
// scheduled at-or-before the new time, so requests can open/close mid-wait.
function makeClock() {
  let t = 0;
  const scheduled: Array<{ at: number; fn: () => void; done: boolean }> = [];
  const drain = () => {
    for (const e of scheduled) {
      if (!e.done && e.at <= t) {
        e.done = true;
        e.fn();
      }
    }
  };
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms;
      drain();
    },
    at: (when: number, fn: () => void) =>
      scheduled.push({ at: when, fn, done: false }),
  };
}

describe("waitForNetworkIdle", () => {
  it("returns at ~floorMs when no requests ever open", async () => {
    const clock = makeClock();
    const tracker = new NetworkIdleTracker(clock.now);
    await waitForNetworkIdle(tracker, {}, { now: clock.now, sleep: clock.sleep });
    // floorMs=50 dominates; first poll boundary at or after 50ms
    expect(clock.now()).toBeGreaterThanOrEqual(NETWORK_IDLE_DEFAULTS.floorMs);
    expect(clock.now()).toBeLessThan(NETWORK_IDLE_DEFAULTS.timeout);
  });

  it("waits until ~idleMs after the last request closes", async () => {
    const clock = makeClock();
    const tracker = new NetworkIdleTracker(clock.now);
    tracker.start("a", "xhr"); // open at t=0
    clock.at(200, () => tracker.end("a")); // closes at t=200
    await waitForNetworkIdle(tracker, {}, { now: clock.now, sleep: clock.sleep });
    // Must not return before the request closed at 200
    expect(clock.now()).toBeGreaterThanOrEqual(200);
    // Returns shortly after (within a couple poll intervals + idle window)
    expect(clock.now()).toBeLessThan(
      200 + NETWORK_IDLE_DEFAULTS.idleMs + 3 * NETWORK_IDLE_DEFAULTS.pollMs
    );
  });

  it("never returns before floorMs even if idle immediately", async () => {
    const clock = makeClock();
    const tracker = new NetworkIdleTracker(clock.now);
    // No requests -> idle from t=0, but floor must hold.
    await waitForNetworkIdle(
      tracker,
      { floorMs: 100 },
      { now: clock.now, sleep: clock.sleep }
    );
    expect(clock.now()).toBeGreaterThanOrEqual(100);
  });

  it("gives up at timeout when the network never goes idle", async () => {
    const clock = makeClock();
    const tracker = new NetworkIdleTracker(clock.now);
    tracker.start("hang", "fetch"); // opens and never closes
    let timedOut = false;
    await waitForNetworkIdle(
      tracker,
      { staleMs: 1_000_000 }, // disable stale so only the cap can end it
      { now: clock.now, sleep: clock.sleep, onTimeout: () => (timedOut = true) }
    );
    expect(timedOut).toBe(true);
    expect(clock.now()).toBeGreaterThanOrEqual(NETWORK_IDLE_DEFAULTS.timeout);
  });
});
