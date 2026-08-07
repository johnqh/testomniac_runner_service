import { describe, it, expect } from "vitest";
import { generatePairwiseCombinations } from "./pairwise.js";

describe("pairwise", () => {
  it("generates pairwise for 2 binary factors", () => {
    const factors = [
      { name: "A", values: ["on", "off"] },
      { name: "B", values: ["on", "off"] },
    ];
    const combos = generatePairwiseCombinations(factors);
    expect(combos.length).toBe(4);
  });

  it("generates fewer than exhaustive for larger inputs", () => {
    const factors = [
      { name: "A", values: ["on", "off"] },
      { name: "B", values: ["on", "off"] },
      { name: "C", values: ["on", "off"] },
      { name: "D", values: ["on", "off"] },
      { name: "E", values: ["1", "2", "3", "4"] },
    ];
    const combos = generatePairwiseCombinations(factors);
    const exhaustive = 2 * 2 * 2 * 2 * 4;
    expect(combos.length).toBeLessThan(exhaustive);
    expect(combos.length).toBeGreaterThan(0);
  });

  it("covers all pairs", () => {
    const factors = [
      { name: "A", values: ["0", "1"] },
      { name: "B", values: ["x", "y"] },
      { name: "C", values: ["p", "q"] },
    ];
    const combos = generatePairwiseCombinations(factors);
    const pairs01 = new Set<string>();
    for (const combo of combos) {
      pairs01.add(`${combo.A}|${combo.B}`);
    }
    expect(pairs01.has("0|x")).toBe(true);
    expect(pairs01.has("0|y")).toBe(true);
    expect(pairs01.has("1|x")).toBe(true);
    expect(pairs01.has("1|y")).toBe(true);
  });

  it("returns single combo for single factor", () => {
    const factors = [{ name: "A", values: ["on", "off"] }];
    const combos = generatePairwiseCombinations(factors);
    expect(combos.length).toBe(2);
  });
});
