import { describe, expect, it } from "vitest";
import { checkEmptyStateVisible, checkResultsChanged } from "./search-checks";
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
    html: "<main>Showing 4 results</main>",
    initialHtml: "<main>Showing 12 results</main>",
    scaffolds: [],
    patterns: [],
    consoleLogs: [],
    networkLogs: [],
    expectations: [],
    initialUrl: "https://example.com/search?q=chair",
    currentUrl: "https://example.com/search?q=lamp",
    startingPath: "/search",
    initialUiSnapshot: uiSnapshot,
    finalUiSnapshot: uiSnapshot,
    initialControlStates: [],
    finalControlStates: [],
    ...overrides,
  };
}

describe("search checks", () => {
  it("passes when a result summary changes", () => {
    const result = checkResultsChanged(
      { description: "Search should change visible results" },
      createContext()
    );

    expect(result.result).toBe("pass");
  });

  it("falls back to URL change when summaries are unavailable", () => {
    const result = checkResultsChanged(
      { description: "Search should change visible results" },
      createContext({
        initialHtml: "<main><div>Catalog</div></main>",
        html: "<main><div>Catalog</div></main>",
      })
    );

    expect(result.result).toBe("pass");
  });

  it("passes when empty-state copy is visible", () => {
    const result = checkEmptyStateVisible(
      { description: "No-result search should show an empty state" },
      createContext({
        html: "<main>No results found. Try a different search.</main>",
      })
    );

    expect(result.result).toBe("pass");
  });

  it("fails when an empty state is not visible", () => {
    const result = checkEmptyStateVisible(
      { description: "No-result search should show an empty state" },
      createContext({
        html: "<main><div>Search page</div></main>",
      })
    );

    expect(result.result).toBe("error");
  });
});
