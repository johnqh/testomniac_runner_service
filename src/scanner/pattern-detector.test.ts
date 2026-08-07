import { describe, it, expect } from "vitest";
import { PATTERN_TYPE_SELECTORS } from "./pattern-detector.js";

describe("PATTERN_TYPE_SELECTORS", () => {
  it("has 20 pattern types", () => {
    expect(Object.keys(PATTERN_TYPE_SELECTORS)).toHaveLength(20);
  });

  it("has selectors for card pattern", () => {
    expect(PATTERN_TYPE_SELECTORS.card).toContain(".card");
    expect(PATTERN_TYPE_SELECTORS.card).toContain("article");
  });

  it("has selectors for modal pattern", () => {
    expect(PATTERN_TYPE_SELECTORS.modal).toContain('[role="dialog"]');
    expect(PATTERN_TYPE_SELECTORS.modal).toContain("dialog");
  });

  it("has selectors for table pattern", () => {
    expect(PATTERN_TYPE_SELECTORS.table).toContain("table:has(thead)");
  });

  it("has selectors for pagination pattern", () => {
    expect(PATTERN_TYPE_SELECTORS.pagination.length).toBeGreaterThan(0);
  });

  it("has selectors for toast pattern", () => {
    expect(PATTERN_TYPE_SELECTORS.toast).toContain(".toast");
  });

  it("every pattern type has at least one selector", () => {
    for (const [type, selectors] of Object.entries(PATTERN_TYPE_SELECTORS)) {
      expect(selectors.length, `${type} should have selectors`).toBeGreaterThan(
        0
      );
    }
  });
});
