import { describe, it, expect } from "vitest";
import { PhaseTimer } from "./phase-timer.js";

describe("PhaseTimer", () => {
  it("tracks phase duration", async () => {
    const timer = new PhaseTimer();
    timer.startPhase("mouse_scanning");
    await new Promise(r => setTimeout(r, 50));
    const duration = timer.endPhase("mouse_scanning");
    expect(duration).toBeGreaterThanOrEqual(40);
    expect(duration).toBeLessThan(200);
  });

  it("tracks total duration", async () => {
    const timer = new PhaseTimer();
    await new Promise(r => setTimeout(r, 50));
    const total = timer.totalElapsed();
    expect(total).toBeGreaterThanOrEqual(40);
  });

  it("returns all phase durations", () => {
    const timer = new PhaseTimer();
    timer.startPhase("a");
    timer.endPhase("a");
    timer.startPhase("b");
    timer.endPhase("b");
    const durations = timer.getAllDurations();
    expect(durations).toHaveProperty("a");
    expect(durations).toHaveProperty("b");
  });
});
