import { describe, expect, it } from "vitest";
import {
  checkElementFocused,
  checkExpandedStateChanged,
} from "./keyboard-disclosure-checks";
import type { ExpertiseContext } from "../types";
import type { ControlState } from "./control-state";
import type { UiSnapshot } from "../../browser/ui-snapshot";

function createControlState(
  overrides: Partial<ControlState> = {}
): ControlState {
  return {
    selector: "#toggle",
    tagName: "BUTTON",
    role: "button",
    inputType: undefined,
    inputMode: undefined,
    name: undefined,
    label: undefined,
    groupName: undefined,
    groupKey: undefined,
    formContext: undefined,
    disabled: false,
    readOnly: false,
    required: false,
    visible: true,
    checked: false,
    selected: false,
    value: "",
    selectedValues: [],
    invalid: false,
    validationMessage: undefined,
    expanded: false,
    passwordMasked: false,
    hasPasswordRevealControl: false,
    ...overrides,
  };
}

function createContext(
  initialControlStates: ControlState[],
  finalControlStates: ControlState[]
): ExpertiseContext {
  const uiSnapshot: UiSnapshot = {
    activeElementSelector: "#toggle",
    dialogCount: 0,
    toastCount: 0,
    feedbackTexts: [],
  };

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
    initialUiSnapshot: uiSnapshot,
    finalUiSnapshot: uiSnapshot,
    initialControlStates,
    finalControlStates,
  };
}

describe("keyboard/disclosure checks", () => {
  it("passes when focus moves to the target element", () => {
    const result = checkElementFocused(
      {
        description: "Target should receive focus",
        targetPath: "#toggle",
      },
      createContext([createControlState()], [createControlState()])
    );

    expect(result.result).toBe("pass");
  });

  it("passes when expanded state changes", () => {
    const result = checkExpandedStateChanged(
      {
        description: "Disclosure should expand",
        targetPath: "#toggle",
      },
      createContext(
        [createControlState({ expanded: false })],
        [createControlState({ expanded: true })]
      )
    );

    expect(result.result).toBe("pass");
  });

  it("fails when expanded state does not change", () => {
    const result = checkExpandedStateChanged(
      {
        description: "Disclosure should expand",
        targetPath: "#toggle",
      },
      createContext(
        [createControlState({ expanded: false })],
        [createControlState({ expanded: false })]
      )
    );

    expect(result.result).toBe("error");
  });
});
