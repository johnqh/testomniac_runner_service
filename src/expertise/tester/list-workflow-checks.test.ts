import { describe, expect, it } from "vitest";
import { checkRowCountChanged } from "./list-workflow-checks";
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
    initialUrl: "https://example.com/list",
    currentUrl: "https://example.com/list",
    startingPath: "/list",
    initialUiSnapshot: uiSnapshot,
    finalUiSnapshot: uiSnapshot,
    initialControlStates: [],
    finalControlStates: [],
  };
}

describe("list workflow checks", () => {
  it("passes when table row count changes", () => {
    const result = checkRowCountChanged(
      {
        description: "Deleting a row should change table row count",
        expectedCountDelta: -1,
      },
      createContext(
        "<table><tr><td>1</td></tr><tr><td>2</td></tr></table>",
        "<table><tr><td>1</td></tr></table>"
      )
    );

    expect(result.result).toBe("pass");
  });

  it("fails when list row count does not change", () => {
    const result = checkRowCountChanged(
      { description: "Pagination should change visible rows" },
      createContext(
        "<ul><li>A</li><li>B</li></ul>",
        "<ul><li>A</li><li>B</li></ul>"
      )
    );

    expect(result.result).toBe("error");
  });

  it("passes when removing the last item leaves an empty state", () => {
    const result = checkRowCountChanged(
      {
        description: "Deleting the last row should reduce the list to empty",
        expectedCountDelta: -1,
      },
      createContext(
        "<ul><li>Only item</li></ul>",
        "<main><p>No items found</p></main>"
      )
    );

    expect(result.result).toBe("pass");
  });
});
