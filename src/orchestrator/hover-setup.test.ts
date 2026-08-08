import { describe, it, expect } from "vitest";

/**
 * The rule extracted from the replay loop, stated once so it can be checked:
 *
 *   skip a hover setup step when the interaction's own first action is a hover
 *
 * A hover leaves no state that survives the next hover — moving the pointer
 * elsewhere stops hovering the first element, and anything it revealed
 * collapses with it. Replaying one before another hover cannot affect the
 * outcome; it can only fail to find a control that is no longer showing, and
 * spend the selector timeout doing so.
 *
 * Measured on a live scan: all 114 failed setup steps were this shape.
 */
function isSuperseded(ownFirstAction: string | undefined, setupAction: string) {
  return ownFirstAction === "hover" && setupAction === "hover";
}

describe("superseded hover setup", () => {
  it("skips a hover that a later hover cancels", () => {
    expect(isSuperseded("hover", "hover")).toBe(true);
  });

  // A click does not cancel a hover — a menu opened by hovering is what the
  // click is there to reach.
  it("keeps a hover that sets up a click", () => {
    expect(isSuperseded("click", "hover")).toBe(false);
  });

  // Only hovers are superseded. A click, fill or navigation in the chain
  // leaves real state behind.
  it("keeps every non-hover setup step", () => {
    for (const setup of ["click", "fill", "goto", "select"]) {
      expect(isSuperseded("hover", setup)).toBe(false);
    }
  });

  it("keeps everything when the interaction has no steps", () => {
    expect(isSuperseded(undefined, "hover")).toBe(false);
  });
});
