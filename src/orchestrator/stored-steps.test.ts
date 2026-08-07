import { describe, it, expect } from "vitest";
import { parseStoredSteps } from "./test-interaction-executor.js";

/**
 * Guards the seam between testomniac_api's route materializer and this
 * executor. The fixtures below are copied verbatim from the shape
 * buildRouteStepSpecs emits.
 *
 * The failure this prevents is silent: the executor runs `if (action.path)`,
 * so a step whose target landed in any other key is skipped without an error
 * and the route appears to execute.
 */
describe("parseStoredSteps", () => {
  it("carries a click target through as path", () => {
    const [step] = parseStoredSteps([
      {
        action: {
          actionType: "click",
          path: "#add-btn",
          playwrightCode: "await page.click('#add-btn')",
          description: "Click Add to cart",
        },
        expectations: [],
        description: "Click Add to cart",
        continueOnFailure: false,
      },
    ]);
    expect(step.action.actionType).toBe("click");
    expect(step.action.path).toBe("#add-btn");
  });

  it("carries a fill target and its value", () => {
    const [step] = parseStoredSteps([
      {
        action: {
          actionType: "fill",
          path: "#q",
          value: "mac mini",
          playwrightCode: "await page.fill('#q', 'mac mini')",
          description: "Fill Search",
        },
        expectations: [],
        description: "Fill Search with mac mini",
        continueOnFailure: false,
      },
    ]);
    expect(step.action.path).toBe("#q");
    expect(step.action.value).toBe("mac mini");
  });

  it("carries a goto target", () => {
    const [step] = parseStoredSteps([
      {
        action: {
          actionType: "goto",
          path: "/en/cart",
          playwrightCode: "await page.goto('/en/cart')",
          description: "Navigate to /en/cart",
        },
        expectations: [],
        description: "Navigate to /en/cart",
        continueOnFailure: false,
      },
    ]);
    expect(step.action.path).toBe("/en/cart");
  });

  // The exact bug: a producer keying the target on `selector` loses it here,
  // and the executor then skips the step without complaining.
  it("drops a target keyed on selector, which is why producers must use path", () => {
    const [step] = parseStoredSteps([
      {
        action: {
          actionType: "click",
          selector: "#add-btn",
          playwrightCode: "await page.click('#add-btn')",
          description: "Click Add to cart",
        },
        expectations: [],
        description: "",
        continueOnFailure: false,
      },
    ]);
    expect(step.action.path).toBeUndefined();
  });
});
