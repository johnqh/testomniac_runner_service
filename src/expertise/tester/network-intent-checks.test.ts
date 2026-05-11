import { describe, expect, it } from "vitest";
import { checkNetworkRequestMade } from "./network-intent-checks";
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
    html: "<main>Loaded</main>",
    initialHtml: "<main>Initial</main>",
    scaffolds: [],
    patterns: [],
    consoleLogs: [],
    networkLogs: [],
    expectations: [],
    initialUrl: "https://example.com/products",
    currentUrl: "https://example.com/products",
    startingPath: "/products",
    initialUiSnapshot: uiSnapshot,
    finalUiSnapshot: uiSnapshot,
    initialControlStates: [],
    finalControlStates: [],
    ...overrides,
  };
}

describe("network intent checks", () => {
  it("passes when a mutation request is observed", () => {
    const result = checkNetworkRequestMade(
      {
        description: "Submit should send a mutation request",
        expectedValue: "mutation",
      },
      createContext({
        networkLogs: [
          {
            method: "POST",
            url: "https://example.com/api/cart",
            status: 200,
            contentType: "application/json",
          },
        ],
      })
    );

    expect(result.result).toBe("pass");
  });

  it("passes when a matching GET search request is observed", () => {
    const result = checkNetworkRequestMade(
      {
        description: "Search should issue a GET request",
        expectedValue: "GET",
        expectedTextTokens: ["search", "q="],
      },
      createContext({
        networkLogs: [
          {
            method: "GET",
            url: "https://example.com/search?q=chair",
            status: 200,
            contentType: "text/html",
          },
        ],
      })
    );

    expect(result.result).toBe("pass");
  });

  it("fails when the expected request is missing", () => {
    const result = checkNetworkRequestMade(
      {
        description: "Checkout should send a mutation request",
        expectedValue: "mutation",
      },
      createContext({
        networkLogs: [
          {
            method: "GET",
            url: "https://example.com/checkout",
            status: 200,
            contentType: "text/html",
          },
        ],
      })
    );

    expect(result.result).toBe("error");
  });
});
