import { describe, it, expect } from "vitest";
import { ActionQueue } from "./action-queue.js";

describe("ActionQueue", () => {
  it("starts empty", () => {
    const q = new ActionQueue();
    expect(q.hasOpen()).toBe(false);
    expect(q.next()).toBeUndefined();
  });

  it("adds and retrieves actions in order", () => {
    const q = new ActionQueue();
    q.add({ id: 1, type: "navigate", status: "open" });
    q.add({ id: 2, type: "mouseover", status: "open" });
    expect(q.hasOpen()).toBe(true);
    expect(q.next()!.id).toBe(1);
  });

  it("complete removes from open set", () => {
    const q = new ActionQueue();
    q.add({ id: 1, type: "navigate", status: "open" });
    q.complete(1);
    expect(q.hasOpen()).toBe(false);
  });

  it("skips completed actions when getting next", () => {
    const q = new ActionQueue();
    q.add({ id: 1, type: "navigate", status: "open" });
    q.add({ id: 2, type: "mouseover", status: "open" });
    q.complete(1);
    expect(q.next()!.id).toBe(2);
  });
});
