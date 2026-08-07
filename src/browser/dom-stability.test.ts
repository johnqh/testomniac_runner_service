import { describe, it, expect, vi } from "vitest";
import { waitForStableDom } from "./dom-stability.js";

/** Deterministic clock: time only advances when the code sleeps. */
function fakeDeps(onTimeout?: () => void) {
  let clock = 0;
  return {
    now: () => clock,
    sleep: async (ms: number) => {
      clock += ms;
    },
    onTimeout,
    elapsed: () => clock,
  };
}

const samplesOf = (values: string[]) => {
  let i = 0;
  return vi.fn(async () => values[Math.min(i++, values.length - 1)]);
};

describe("waitForStableDom", () => {
  it("returns as soon as two consecutive samples match", async () => {
    const deps = fakeDeps();
    const sample = samplesOf(["10:5", "10:5"]);
    await waitForStableDom(sample, {}, deps);
    expect(sample).toHaveBeenCalledTimes(2);
  });

  // The case this exists for: a spinner, then the real page.
  it("keeps waiting while the page is still rendering", async () => {
    const deps = fakeDeps();
    const sample = samplesOf(["40:9", "120:900", "800:5200", "800:5200"]);
    await waitForStableDom(sample, {}, deps);
    expect(sample).toHaveBeenCalledTimes(4);
  });

  // A clock, a spinner or a polling widget never settles. Being slightly stale
  // beats stalling every scan of that page.
  it("gives up at the cap instead of hanging", async () => {
    const onTimeout = vi.fn();
    const deps = fakeDeps(onTimeout);
    let n = 0;
    await waitForStableDom(
      async () => `changing:${n++}`,
      { pollMs: 100, timeout: 500 },
      deps
    );
    expect(onTimeout).toHaveBeenCalled();
    expect(deps.elapsed()).toBeLessThanOrEqual(600);
  });

  // A navigation detaches the execution context. The page is changing by
  // definition, so a throw must not escape and must not count as stable.
  it("treats an unreadable sample as unstable rather than throwing", async () => {
    const onTimeout = vi.fn();
    const deps = fakeDeps(onTimeout);
    await waitForStableDom(
      async () => {
        throw new Error("Execution context was destroyed");
      },
      { pollMs: 100, timeout: 300 },
      deps
    );
    expect(onTimeout).toHaveBeenCalled();
  });

  it("honours a higher stability requirement", async () => {
    const deps = fakeDeps();
    const sample = samplesOf(["a", "a", "a"]);
    await waitForStableDom(sample, { stableSamples: 3 }, deps);
    expect(sample).toHaveBeenCalledTimes(3);
  });
});
