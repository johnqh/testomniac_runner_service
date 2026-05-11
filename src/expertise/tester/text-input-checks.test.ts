import { describe, expect, it } from "vitest";
import { checkInputValue } from "./text-input-checks";
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
    initialUrl: "https://example.com/form",
    currentUrl: "https://example.com/form",
    startingPath: "/form",
    initialUiSnapshot: uiSnapshot,
    finalUiSnapshot: uiSnapshot,
    initialControlStates,
    finalControlStates,
  };
}

describe("checkInputValue", () => {
  it("passes when a disabled text control remains unchanged", () => {
    const initial = createControlState({
      selector: "#phone",
      inputType: "tel",
      disabled: true,
      value: "",
    });
    const final = createControlState({
      selector: "#phone",
      inputType: "tel",
      disabled: true,
      value: "",
    });

    const result = checkInputValue(
      {
        description: "Disabled phone field should not respond",
        targetPath: "#phone",
        expectedValue: "5551234567",
      },
      createContext([initial], [final])
    );

    expect(result.result).toBe("pass");
  });

  it("passes when an enabled control is marked expect-no-change and remains unchanged", () => {
    const initial = createControlState({
      selector: "#search",
      inputType: "text",
      disabled: false,
      value: "",
    });
    const final = createControlState({
      selector: "#search",
      inputType: "text",
      disabled: false,
      value: "",
    });

    const result = checkInputValue(
      {
        description: "Visually disabled search should not respond",
        targetPath: "#search",
        expectedValue: "shoes",
        expectNoChange: true,
      },
      createContext([initial], [final])
    );

    expect(result.result).toBe("pass");
  });

  it("fails when a disabled text control changes", () => {
    const initial = createControlState({
      selector: "#date",
      inputType: "date",
      disabled: true,
      value: "",
    });
    const final = createControlState({
      selector: "#date",
      inputType: "date",
      disabled: true,
      value: "01/02/2026",
    });

    const result = checkInputValue(
      {
        description: "Disabled date field should not respond",
        targetPath: "#date",
        expectedValue: "01/02/2026",
      },
      createContext([initial], [final])
    );

    expect(result.result).toBe("error");
    expect(result.observed).toContain("Disabled control changed");
  });

  it("accepts formatted phone input when digits are preserved", () => {
    const final = createControlState({
      selector: "#phone",
      inputType: "tel",
      value: "(555) 123-4567",
    });

    const result = checkInputValue(
      {
        description: "Phone input should retain digits",
        targetPath: "#phone",
        expectedValue: "5551234567",
      },
      createContext([], [final])
    );

    expect(result.result).toBe("pass");
  });

  it("fails when a password field becomes visible without a reveal control", () => {
    const final = createControlState({
      selector: "#password",
      inputType: "password",
      value: "Secret123!",
      passwordMasked: false,
      hasPasswordRevealControl: false,
    });

    const result = checkInputValue(
      {
        description: "Password should remain masked",
        targetPath: "#password",
        expectedValue: "Secret123!",
      },
      createContext([], [final])
    );

    expect(result.result).toBe("error");
    expect(result.observed).toContain("no reveal control");
  });
});
