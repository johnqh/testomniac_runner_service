import { describe, expect, it } from "vitest";
import { checkResultsRestored } from "./search-restore-checks";
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
    html: "<main>Showing 12 results <a>Alpha</a><a>Bravo</a><a>Charlie</a></main>",
    initialHtml:
      "<main>Showing 12 results <a>Alpha</a><a>Bravo</a><a>Charlie</a></main>",
    scaffolds: [],
    patterns: [],
    consoleLogs: [],
    networkLogs: [],
    expectations: [],
    initialUrl: "https://example.com/search",
    currentUrl: "https://example.com/search",
    startingPath: "/search",
    initialUiSnapshot: uiSnapshot,
    finalUiSnapshot: uiSnapshot,
    initialControlStates: [],
    finalControlStates: [],
    ...overrides,
  };
}

describe("search restore checks", () => {
  it("passes when baseline results are restored", () => {
    const result = checkResultsRestored(
      { description: "Clearing search should restore baseline results" },
      createContext()
    );

    expect(result.result).toBe("pass");
  });

  it("warns when result state stays changed", () => {
    const result = checkResultsRestored(
      { description: "Clearing search should restore baseline results" },
      createContext({
        html: "<main>Showing 2 results <a>X</a><a>Y</a></main>",
        currentUrl: "https://example.com/search?q=test",
      })
    );

    expect(result.result).toBe("warning");
  });
});
