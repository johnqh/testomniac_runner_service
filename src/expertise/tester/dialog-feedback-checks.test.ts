import { describe, expect, it } from "vitest";
import {
  checkDialogClosed,
  checkFeedbackVisible,
  checkFocusReturned,
} from "./dialog-feedback-checks";
import type { ExpertiseContext } from "../types";
import type { UiSnapshot } from "../../browser/ui-snapshot";

function createUiSnapshot(overrides: Partial<UiSnapshot> = {}): UiSnapshot {
  return {
    activeElementSelector: "body",
    dialogCount: 0,
    toastCount: 0,
    feedbackTexts: [],
    ...overrides,
  };
}

function createContext(
  initialUiSnapshot: UiSnapshot,
  finalUiSnapshot: UiSnapshot
): ExpertiseContext {
  return {
    html: "<main></main>",
    initialHtml: "<main></main>",
    scaffolds: [],
    patterns: [],
    consoleLogs: [],
    networkLogs: [],
    expectations: [],
    initialUrl: "https://example.com/page",
    currentUrl: "https://example.com/page",
    startingPath: "/page",
    initialUiSnapshot,
    finalUiSnapshot,
    initialControlStates: [],
    finalControlStates: [],
  };
}

describe("dialog and feedback checks", () => {
  it("passes when dialog count decreases", () => {
    const result = checkDialogClosed(
      { description: "Dialog should close" },
      createContext(
        createUiSnapshot({ dialogCount: 1 }),
        createUiSnapshot({ dialogCount: 0 })
      )
    );

    expect(result.result).toBe("pass");
  });

  it("passes when focus returns to the initial element", () => {
    const result = checkFocusReturned(
      { description: "Focus should return" },
      createContext(
        createUiSnapshot({ activeElementSelector: "#open-dialog" }),
        createUiSnapshot({ activeElementSelector: "#open-dialog" })
      )
    );

    expect(result.result).toBe("pass");
  });

  it("passes when feedback region count increases", () => {
    const result = checkFeedbackVisible(
      { description: "Feedback should appear" },
      createContext(
        createUiSnapshot({ toastCount: 0 }),
        createUiSnapshot({
          toastCount: 1,
          feedbackTexts: ["Item added successfully"],
        })
      )
    );

    expect(result.result).toBe("pass");
  });
});
