import { describe, expect, it } from "vitest";
import {
  checkCartSummaryChanged,
  checkCollectionOrderChanged,
  checkCountChanged,
} from "./commerce-checks";
import { checkResultsChanged } from "./search-checks";
import type { ExpertiseContext } from "../types";
import type { UiSnapshot } from "../../browser/ui-snapshot";

function createContext(initialHtml: string, html: string): ExpertiseContext {
  const uiSnapshot: UiSnapshot = {
    activeElementSelector: "body",
    dialogCount: 0,
    toastCount: 0,
    feedbackTexts: [],
  };
  return {
    html,
    initialHtml,
    scaffolds: [],
    patterns: [],
    consoleLogs: [],
    networkLogs: [],
    expectations: [],
    initialUrl: "https://example.com/cart",
    currentUrl: "https://example.com/cart",
    startingPath: "/cart",
    initialUiSnapshot: uiSnapshot,
    finalUiSnapshot: uiSnapshot,
    initialControlStates: [],
    finalControlStates: [],
  };
}

describe("commerce checks", () => {
  it("passes when a cart count increases", () => {
    const result = checkCountChanged(
      {
        description: "Cart count should increase",
        expectedCountDelta: 1,
      },
      createContext("<main>Cart 1</main>", "<main>Cart 2</main>")
    );

    expect(result.result).toBe("pass");
  });

  it("passes when the cart summary changes", () => {
    const result = checkCartSummaryChanged(
      {
        description: "Cart summary should update",
      },
      createContext(
        "<main>Subtotal $10.00 Checkout</main>",
        "<main>Subtotal $20.00 Checkout</main>"
      )
    );

    expect(result.result).toBe("pass");
  });

  it("passes when the result summary changes", () => {
    const result = checkResultsChanged(
      {
        description: "Result summary should update",
      },
      createContext(
        "<main>Showing 12 results</main>",
        "<main>Showing 4 results</main>"
      )
    );

    expect(result.result).toBe("pass");
  });

  it("passes when collection ordering changes", () => {
    const result = checkCollectionOrderChanged(
      {
        description: "Collection ordering should update",
      },
      createContext(
        "<main><a>Alpha</a><a>Bravo</a><a>Charlie</a></main>",
        "<main><a>Charlie</a><a>Bravo</a><a>Alpha</a></main>"
      )
    );

    expect(result.result).toBe("pass");
  });

  it("falls back to quantity control values when count text is unavailable", () => {
    const uiSnapshot: UiSnapshot = {
      activeElementSelector: "body",
      dialogCount: 0,
      toastCount: 0,
      feedbackTexts: [],
    };
    const result = checkCountChanged(
      {
        description: "Quantity should increase",
        expectedCountDelta: 1,
      },
      {
        html: "<main>Cart</main>",
        initialHtml: "<main>Cart</main>",
        scaffolds: [],
        patterns: [],
        consoleLogs: [],
        networkLogs: [],
        expectations: [],
        initialUrl: "https://example.com/cart",
        currentUrl: "https://example.com/cart",
        startingPath: "/cart",
        initialUiSnapshot: uiSnapshot,
        finalUiSnapshot: uiSnapshot,
        initialControlStates: [
          {
            selector: "#qty",
            tagName: "INPUT",
            name: "quantity",
            label: "Quantity",
            disabled: false,
            readOnly: false,
            required: false,
            visible: true,
            checked: false,
            selected: false,
            value: "1",
            selectedValues: [],
            invalid: false,
            passwordMasked: false,
            hasPasswordRevealControl: false,
          },
        ],
        finalControlStates: [
          {
            selector: "#qty",
            tagName: "INPUT",
            name: "quantity",
            label: "Quantity",
            disabled: false,
            readOnly: false,
            required: false,
            visible: true,
            checked: false,
            selected: false,
            value: "2",
            selectedValues: [],
            invalid: false,
            passwordMasked: false,
            hasPasswordRevealControl: false,
          },
        ],
      }
    );

    expect(result.result).toBe("pass");
  });

  it("passes when summary prices change even if summary keywords are missing", () => {
    const result = checkCartSummaryChanged(
      {
        description: "Cart pricing should update",
      },
      createContext(
        "<main><div>$10.00</div><div>$2.00</div></main>",
        "<main><div>$20.00</div><div>$4.00</div></main>"
      )
    );

    expect(result.result).toBe("pass");
  });
});
