import { describe, expect, it } from "vitest";
import { checkSelectionState } from "./selection-control-checks";
import type { ExpertiseContext } from "../types";
import type { ControlState } from "./control-state";
import type { UiSnapshot } from "../../browser/ui-snapshot";

function createControlState(
  overrides: Partial<ControlState> = {}
): ControlState {
  return {
    selector: "#control",
    tagName: "INPUT",
    role: undefined,
    inputType: "checkbox",
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
  finalControlStates: ControlState[]
): ExpertiseContext {
  const uiSnapshot: UiSnapshot = {
    activeElementSelector: "#control",
    dialogCount: 0,
    toastCount: 0,
    feedbackTexts: [],
  };
  return {
    html: "",
    initialHtml: "",
    scaffolds: [],
    patterns: [],
    consoleLogs: [],
    networkLogs: [],
    expectations: [],
    initialUrl: "https://example.com/settings",
    currentUrl: "https://example.com/settings",
    startingPath: "/settings",
    initialUiSnapshot: uiSnapshot,
    finalUiSnapshot: uiSnapshot,
    initialControlStates,
    finalControlStates,
  };
}

describe("checkSelectionState", () => {
  it("passes when a disabled checkbox remains unchanged", () => {
    const initial = createControlState({
      selector: "#terms",
      inputType: "checkbox",
      disabled: true,
      checked: false,
    });
    const final = createControlState({
      selector: "#terms",
      inputType: "checkbox",
      disabled: true,
      checked: false,
    });

    const result = checkSelectionState(
      {
        description: "Disabled checkbox should not toggle",
        targetPath: "#terms",
      },
      createContext([initial], [final])
    );

    expect(result.result).toBe("pass");
  });

  it("passes when an enabled selection control is marked expect-no-change", () => {
    const initial = createControlState({
      selector: "#archived",
      inputType: "checkbox",
      disabled: false,
      checked: false,
    });
    const final = createControlState({
      selector: "#archived",
      inputType: "checkbox",
      disabled: false,
      checked: false,
    });

    const result = checkSelectionState(
      {
        description: "Visually disabled checkbox should not toggle",
        targetPath: "#archived",
        expectNoChange: true,
      },
      createContext([initial], [final])
    );

    expect(result.result).toBe("pass");
  });

  it("fails when selecting one radio leaves multiple radios active", () => {
    const final = [
      createControlState({
        selector: "#plan-basic",
        inputType: "radio",
        checked: true,
        groupKey: "plan",
      }),
      createControlState({
        selector: "#plan-pro",
        inputType: "radio",
        checked: true,
        groupKey: "plan",
      }),
    ];

    const result = checkSelectionState(
      {
        description: "Radio group should have single selection",
        targetPath: "#plan-basic",
      },
      createContext([], final)
    );

    expect(result.result).toBe("error");
    expect(result.observed).toContain("multiple selected");
  });

  it("fails when checking a checkbox clears a checked sibling", () => {
    const initial = [
      createControlState({
        selector: "#email",
        inputType: "checkbox",
        checked: true,
        groupKey: "channels",
      }),
      createControlState({
        selector: "#sms",
        inputType: "checkbox",
        checked: false,
        groupKey: "channels",
      }),
    ];
    const final = [
      createControlState({
        selector: "#email",
        inputType: "checkbox",
        checked: false,
        groupKey: "channels",
      }),
      createControlState({
        selector: "#sms",
        inputType: "checkbox",
        checked: true,
        groupKey: "channels",
      }),
    ];

    const result = checkSelectionState(
      {
        description: "Checkboxes should not uncheck siblings",
        targetPath: "#sms",
      },
      createContext(initial, final)
    );

    expect(result.result).toBe("error");
    expect(result.observed).toContain("unexpectedly unchecked sibling");
  });

  it("passes when a tablist ends with exactly one selected tab", () => {
    const final = [
      createControlState({
        selector: "#overview",
        tagName: "BUTTON",
        role: "tab",
        selected: false,
        groupKey: "product-tabs",
      }),
      createControlState({
        selector: "#reviews",
        tagName: "BUTTON",
        role: "tab",
        selected: true,
        groupKey: "product-tabs",
      }),
    ];

    const result = checkSelectionState(
      {
        description: "Tab selection should be exclusive",
        targetPath: "#reviews",
      },
      createContext([], final)
    );

    expect(result.result).toBe("pass");
  });
});
