import { describe, expect, it } from "vitest";
import {
  checkFieldErrorClearsAfterFix,
  checkRequiredErrorShownForField,
} from "./validation-checks";
import type { ExpertiseContext } from "../types";
import type { ControlState } from "./control-state";
import type { UiSnapshot } from "../../browser/ui-snapshot";

function createControlState(
  overrides: Partial<ControlState> = {}
): ControlState {
  return {
    selector: "#field",
    tagName: "INPUT",
    role: undefined,
    inputType: "text",
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
    expanded: undefined,
    passwordMasked: true,
    hasPasswordRevealControl: false,
    ...overrides,
  };
}

function createContext(
  initialControlStates: ControlState[],
  finalControlStates: ControlState[],
  html = "<main></main>"
): ExpertiseContext {
  const uiSnapshot: UiSnapshot = {
    activeElementSelector: "#field",
    dialogCount: 0,
    toastCount: 0,
    feedbackTexts: [],
  };
  return {
    html,
    initialHtml: "<main></main>",
    scaffolds: [],
    patterns: [],
    consoleLogs: [],
    networkLogs: [],
    expectations: [],
    initialUrl: "https://example.com/form",
    currentUrl: "https://example.com/form",
    startingPath: "/form",
    initialUiSnapshot: uiSnapshot,
    finalUiSnapshot: uiSnapshot,
    initialControlStates,
    finalControlStates,
  };
}

describe("validation checks", () => {
  it("passes when omitted field shows invalid state", () => {
    const result = checkRequiredErrorShownForField(
      {
        description: "Required field should show an error",
        targetPath: "#email",
      },
      createContext(
        [],
        [
          createControlState({
            selector: "#email",
            invalid: true,
            validationMessage: "Please enter email",
          }),
        ]
      )
    );

    expect(result.result).toBe("pass");
  });

  it("passes when field error clears after correction", () => {
    const result = checkFieldErrorClearsAfterFix(
      {
        description: "Field error should clear after fix",
        targetPath: "#email",
      },
      createContext(
        [
          createControlState({
            selector: "#email",
            invalid: true,
            validationMessage: "Required",
          }),
        ],
        [
          createControlState({
            selector: "#email",
            invalid: false,
            validationMessage: "",
          }),
        ]
      )
    );

    expect(result.result).toBe("pass");
  });
});
