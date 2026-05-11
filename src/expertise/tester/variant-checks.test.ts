import { describe, expect, it } from "vitest";
import { checkVariantStateChanged } from "./variant-checks";
import type { ExpertiseContext } from "../types";
import type { UiSnapshot } from "../../browser/ui-snapshot";

function createContext(
  overrides: Partial<ExpertiseContext> = {}
): ExpertiseContext {
  const uiSnapshot: UiSnapshot = {
    activeElementSelector: "body",
    dialogCount: 0,
    toastCount: 0,
    feedbackTexts: [],
  };
  return {
    html: '<main><img src="/blue.jpg" /><div>$20.00</div><div>In stock</div></main>',
    initialHtml:
      '<main><img src="/red.jpg" /><div>$10.00</div><div>Out of stock</div></main>',
    scaffolds: [],
    patterns: [],
    consoleLogs: [],
    networkLogs: [],
    expectations: [],
    initialUrl: "https://example.com/product",
    currentUrl: "https://example.com/product?variant=blue",
    startingPath: "/product",
    initialUiSnapshot: uiSnapshot,
    finalUiSnapshot: uiSnapshot,
    initialControlStates: [],
    finalControlStates: [],
    ...overrides,
  };
}

describe("variant checks", () => {
  it("passes when product state signals change", () => {
    const result = checkVariantStateChanged(
      { description: "Selecting a variant should change product state" },
      createContext()
    );

    expect(result.result).toBe("pass");
  });

  it("warns when no product-state signal changes", () => {
    const html =
      '<main><img src="/same.jpg" /><div>$10.00</div><div>In stock</div></main>';
    const result = checkVariantStateChanged(
      { description: "Selecting a variant should change product state" },
      createContext({
        initialHtml: html,
        html,
        initialUrl: "https://example.com/product",
        currentUrl: "https://example.com/product",
      })
    );

    expect(result.result).toBe("warning");
  });

  it("passes when selecting a variant enables or relabels the purchase CTA", () => {
    const result = checkVariantStateChanged(
      { description: "Selecting a variant should unlock purchase state" },
      createContext({
        initialHtml:
          '<main><button disabled>Select options</button><img src="/same.jpg" /><div>$10.00</div></main>',
        html: '<main><button>Add to cart</button><img src="/same.jpg" /><div>$10.00</div></main>',
        initialUrl: "https://example.com/product",
        currentUrl: "https://example.com/product",
      })
    );

    expect(result.result).toBe("pass");
  });
});
