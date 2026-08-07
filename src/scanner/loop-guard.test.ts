import { describe, it, expect } from "vitest";
import { LoopGuard } from "./loop-guard.js";

describe("LoopGuard", () => {
  it("allows new action signatures", () => {
    const guard = new LoopGuard();
    expect(guard.shouldCreate("mouseover", 1, 5)).toBe(true);
  });

  it("blocks duplicate signatures", () => {
    const guard = new LoopGuard();
    guard.record("mouseover", 1, 5);
    expect(guard.shouldCreate("mouseover", 1, 5)).toBe(false);
  });

  it("allows same type with different items", () => {
    const guard = new LoopGuard();
    guard.record("mouseover", 1, 5);
    expect(guard.shouldCreate("mouseover", 2, 5)).toBe(true);
  });

  it("enforces max actions per page state", () => {
    const guard = new LoopGuard({ maxActionsPerPageState: 3 });
    guard.record("mouseover", 1, 10);
    guard.record("mouseover", 2, 10);
    guard.record("mouseover", 3, 10);
    expect(guard.shouldCreate("mouseover", 4, 10)).toBe(false);
  });

  it("enforces max total actions", () => {
    const guard = new LoopGuard({ maxTotalActions: 2 });
    guard.record("mouseover", 1, 5);
    guard.record("click", 1, 5);
    expect(guard.shouldCreate("mouseover", 2, 6)).toBe(false);
  });
});
