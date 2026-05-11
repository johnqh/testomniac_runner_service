import { describe, expect, it } from "vitest";
import {
  checkBackNavigationRestoresState,
  checkForwardNavigationReappliesState,
  checkStatePersistsAfterReload,
} from "./persistence-checks";
import type { ExpertiseContext } from "../types";
import type { UiSnapshot } from "../../browser/ui-snapshot";

function createUiSnapshot(): UiSnapshot {
  return {
    activeElementSelector: "body",
    dialogCount: 0,
    toastCount: 0,
    feedbackTexts: [],
  };
}

function createContext(
  initialHtml: string,
  html: string,
  initialUrl = "https://example.com/products",
  currentUrl = "https://example.com/products"
): ExpertiseContext {
  const uiSnapshot = createUiSnapshot();
  return {
    html,
    initialHtml,
    scaffolds: [],
    patterns: [],
    consoleLogs: [],
    networkLogs: [],
    expectations: [],
    initialUrl,
    currentUrl,
    startingPath: "/products",
    initialUiSnapshot: uiSnapshot,
    finalUiSnapshot: uiSnapshot,
    initialControlStates: [],
    finalControlStates: [],
  };
}

describe("persistence checks", () => {
  it("passes when visible state signals persist after reload", () => {
    const result = checkStatePersistsAfterReload(
      {
        description: "Cart state should persist after reload",
        expectedTextTokens: ["cart"],
      },
      createContext("<main>Cart 2</main>", "<main>Cart 2</main>")
    );

    expect(result.result).toBe("pass");
  });

  it("passes when back navigation restores the previous state", () => {
    const result = checkBackNavigationRestoresState(
      {
        description: "Back should restore previous state",
      },
      createContext(
        "<main>Products</main>",
        "<main>Products</main>",
        "https://example.com/products",
        "https://example.com/products"
      )
    );

    expect(result.result).toBe("pass");
  });

  it("passes when forward navigation reapplies a different state", () => {
    const result = checkForwardNavigationReappliesState(
      {
        description: "Forward should reapply later state",
      },
      createContext(
        "<main>Products</main>",
        "<main>Product detail</main>",
        "https://example.com/products",
        "https://example.com/products/1"
      )
    );

    expect(result.result).toBe("pass");
  });
});
