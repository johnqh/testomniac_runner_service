import { describe, expect, it } from "vitest";
import {
  checkDialogClosed,
  checkFeedbackNotDuplicated,
  checkFeedbackVisible,
  checkFocusReturned,
} from "./dialog-feedback-checks";
import { checkErrorStateCleared, checkErrorStateVisible } from "./form-checks";
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

  it("fails when forbidden feedback remains visible even if success text is present", () => {
    const result = checkFeedbackVisible(
      {
        description: "Success feedback should appear without error messaging",
        expectedTextTokens: ["success"],
        forbiddenTextTokens: ["error"],
      },
      createContext(
        createUiSnapshot({ toastCount: 0 }),
        createUiSnapshot({
          toastCount: 2,
          feedbackTexts: ["Saved successfully", "Error saving draft"],
        })
      )
    );

    expect(result.result).toBe("error");
  });

  it("warns when expected feedback was already visible before the action", () => {
    const result = checkFeedbackVisible(
      {
        description: "Action should create fresh success feedback",
        expectedTextTokens: ["saved"],
      },
      createContext(
        createUiSnapshot({
          toastCount: 1,
          feedbackTexts: ["Saved successfully"],
        }),
        createUiSnapshot({
          toastCount: 1,
          feedbackTexts: ["Saved successfully"],
        })
      )
    );

    expect(result.result).toBe("warning");
  });

  it("passes when feedback text changes even if region count stays the same", () => {
    const result = checkFeedbackVisible(
      { description: "Action should replace stale feedback" },
      createContext(
        createUiSnapshot({
          toastCount: 1,
          feedbackTexts: ["Saving..."],
        }),
        createUiSnapshot({
          toastCount: 1,
          feedbackTexts: ["Saved successfully"],
        })
      )
    );

    expect(result.result).toBe("pass");
  });

  it("fails when identical feedback messages are duplicated", () => {
    const result = checkFeedbackNotDuplicated(
      { description: "Feedback should not be duplicated" },
      createContext(
        createUiSnapshot({ toastCount: 0 }),
        createUiSnapshot({
          toastCount: 2,
          feedbackTexts: ["Saved successfully", "Saved successfully"],
        })
      )
    );

    expect(result.result).toBe("error");
  });

  it("passes when error feedback is visible", () => {
    const result = checkErrorStateVisible(
      { description: "An error state should be visible" },
      createContext(
        createUiSnapshot({ toastCount: 0 }),
        createUiSnapshot({
          toastCount: 1,
          feedbackTexts: ["Error saving changes. Try again."],
        })
      )
    );

    expect(result.result).toBe("pass");
  });

  it("passes when an existing error feedback is cleared", () => {
    const result = checkErrorStateCleared(
      { description: "The error state should clear after recovery" },
      createContext(
        createUiSnapshot({
          toastCount: 1,
          feedbackTexts: ["Error saving changes. Try again."],
        }),
        createUiSnapshot({
          toastCount: 1,
          feedbackTexts: ["Saved successfully"],
        })
      )
    );

    expect(result.result).toBe("pass");
  });
});
