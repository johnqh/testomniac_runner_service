import { describe, it, expect, vi } from "vitest";
import { settleForRead } from "./settle-for-read";

describe("settleForRead", () => {
  it("calls waitForNetworkIdle when the adapter implements it", async () => {
    const waitForNetworkIdle = vi.fn().mockResolvedValue(undefined);
    await settleForRead({ waitForNetworkIdle });
    expect(waitForNetworkIdle).toHaveBeenCalledTimes(1);
  });

  it("no-ops when the adapter does not implement it", async () => {
    await expect(settleForRead({})).resolves.toBeUndefined();
  });
});
