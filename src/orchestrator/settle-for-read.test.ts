import { describe, it, expect, vi } from "vitest";
import { settleForRead } from "./settle-for-read.js";

describe("settleForRead", () => {
  it("calls waitForNetworkIdle when the adapter implements it", async () => {
    const waitForNetworkIdle = vi.fn().mockResolvedValue(undefined);
    await settleForRead({ waitForNetworkIdle });
    expect(waitForNetworkIdle).toHaveBeenCalledTimes(1);
  });

  it("no-ops when the adapter does not implement it", async () => {
    await expect(settleForRead({})).resolves.toBeUndefined();
  });

  // A sampler that never works means the adapter cannot evaluate. Retrying it
  // to the cap would cost three seconds on every page read.
  it("skips the stability wait when the first sample fails", async () => {
    const evaluate = vi.fn().mockRejectedValue(new Error("no context"));
    const startedAt = Date.now();
    await settleForRead({ evaluate });
    expect(evaluate).toHaveBeenCalledTimes(1);
    expect(Date.now() - startedAt).toBeLessThan(500);
  });

  // The case this gate exists for: a spinner followed by the real page.
  it("waits until the dom stops changing", async () => {
    const evaluate = vi
      .fn()
      .mockResolvedValueOnce("40:9")
      .mockResolvedValueOnce("120:900")
      .mockResolvedValue("800:5200");
    await settleForRead({ evaluate });
    expect(evaluate.mock.calls.length).toBeGreaterThanOrEqual(4);
  });

  // The page is ready when its network goes quiet, not after a fixed delay.
  // The floor exists only because a click's request may not have left the
  // browser yet, so a tracker asked immediately would call that idle.
  it("passes a floor through to the network gate", async () => {
    const waitForNetworkIdle = vi.fn().mockResolvedValue(undefined);
    await settleForRead({ waitForNetworkIdle }, { floorMs: 150 });
    expect(waitForNetworkIdle).toHaveBeenCalledWith({ floorMs: 150 });
  });

  it("leaves the gate's own defaults alone when no floor is given", async () => {
    const waitForNetworkIdle = vi.fn().mockResolvedValue(undefined);
    await settleForRead({ waitForNetworkIdle });
    expect(waitForNetworkIdle).toHaveBeenCalledWith(undefined);
  });
});
