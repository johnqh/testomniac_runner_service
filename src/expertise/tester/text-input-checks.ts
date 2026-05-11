import type { ExpertiseContext, Outcome } from "../types";
import {
  classifyControlKind,
  digitsOnly,
  findControlBySelector,
  normalizeWhitespace,
} from "./control-state";

export function checkInputValue(
  expectation: {
    description: string;
    expectedValue?: string;
    targetPath?: string;
    expectNoChange?: boolean;
  },
  context: ExpertiseContext
): Outcome {
  const control = findControlBySelector(
    context.finalControlStates,
    expectation.targetPath
  );
  if (!control) {
    return {
      expected: expectation.description,
      observed: `Target control not found for selector ${expectation.targetPath ?? "(unknown)"}`,
      result: "error",
    };
  }

  if (expectation.expectNoChange || control.disabled) {
    const initial = findControlBySelector(
      context.initialControlStates,
      expectation.targetPath
    );
    if (!initial) {
      return {
        expected: expectation.description,
        observed: "Disabled control was not present in the initial snapshot",
        result: "error",
      };
    }

    if (initial.value !== control.value) {
      return {
        expected: expectation.description,
        observed: `Disabled control changed from "${initial.value}" to "${control.value}"`,
        result: "error",
      };
    }

    return {
      expected: expectation.description,
      observed: expectation.expectNoChange
        ? "Control did not respond to user input"
        : "Disabled control did not respond to user input",
      result: "pass",
    };
  }

  const expectedValue = expectation.expectedValue ?? "";
  const actualValue = control.value ?? "";
  const kind = classifyControlKind(control);

  switch (kind) {
    case "phone":
      return checkPhoneInput(
        expectation.description,
        expectedValue,
        actualValue
      );
    case "date":
      return checkDateInput(
        expectation.description,
        expectedValue,
        actualValue
      );
    case "number":
      return checkNumberInput(
        expectation.description,
        expectedValue,
        actualValue
      );
    case "password":
      return checkPasswordInput(
        expectation.description,
        expectedValue,
        actualValue,
        control.passwordMasked,
        control.hasPasswordRevealControl
      );
    case "select":
      return checkSelectInput(
        expectation.description,
        expectedValue,
        control.selectedValues
      );
    default:
      return checkPlainTextInput(
        expectation.description,
        expectedValue,
        actualValue
      );
  }
}

function checkPlainTextInput(
  description: string,
  expectedValue: string,
  actualValue: string
): Outcome {
  if (normalizeWhitespace(actualValue) !== normalizeWhitespace(expectedValue)) {
    return {
      expected: description,
      observed: `Expected value "${expectedValue}" but found "${actualValue}"`,
      result: "error",
    };
  }

  return {
    expected: description,
    observed: `Control accepted typed value "${actualValue}"`,
    result: "pass",
  };
}

function checkPhoneInput(
  description: string,
  expectedValue: string,
  actualValue: string
): Outcome {
  const expectedDigits = digitsOnly(expectedValue);
  const actualDigits = digitsOnly(actualValue);
  const hasLetters = /[a-z]/i.test(actualValue);

  if (hasLetters) {
    return {
      expected: description,
      observed: `Phone input retained alphabetic characters: "${actualValue}"`,
      result: "error",
    };
  }

  if (!actualDigits || actualDigits !== expectedDigits) {
    return {
      expected: description,
      observed: `Phone input did not preserve the typed digits. Expected ${expectedDigits}, got "${actualValue}"`,
      result: "error",
    };
  }

  return {
    expected: description,
    observed: `Phone input accepted digits and formatted them as "${actualValue}"`,
    result: "pass",
  };
}

function checkDateInput(
  description: string,
  expectedValue: string,
  actualValue: string
): Outcome {
  if (!actualValue) {
    return {
      expected: description,
      observed: "Date input remained empty after typing",
      result: "error",
    };
  }

  if (/[a-z]/i.test(actualValue)) {
    return {
      expected: description,
      observed: `Date input retained alphabetic characters: "${actualValue}"`,
      result: "error",
    };
  }

  const expectedDigits = digitsOnly(expectedValue);
  const actualDigits = digitsOnly(actualValue);
  if (
    actualDigits.length < 6 ||
    !expectedDigits.startsWith(
      actualDigits.slice(
        0,
        Math.min(actualDigits.length, expectedDigits.length)
      )
    )
  ) {
    return {
      expected: description,
      observed: `Date input did not retain the typed date digits. Expected from "${expectedValue}", got "${actualValue}"`,
      result: "error",
    };
  }

  if (!/^[0-9/\-.]+$/.test(actualValue)) {
    return {
      expected: description,
      observed: `Date input contains unexpected characters: "${actualValue}"`,
      result: "error",
    };
  }

  return {
    expected: description,
    observed: `Date input accepted numeric entry as "${actualValue}"`,
    result: "pass",
  };
}

function checkNumberInput(
  description: string,
  expectedValue: string,
  actualValue: string
): Outcome {
  if (!actualValue) {
    return {
      expected: description,
      observed: "Number input remained empty after typing",
      result: "error",
    };
  }

  if (!/^-?\d+(\.\d+)?$/.test(actualValue)) {
    return {
      expected: description,
      observed: `Number input contains non-numeric characters: "${actualValue}"`,
      result: "error",
    };
  }

  if (digitsOnly(actualValue) !== digitsOnly(expectedValue)) {
    return {
      expected: description,
      observed: `Number input did not retain the expected digits. Expected "${expectedValue}", got "${actualValue}"`,
      result: "error",
    };
  }

  return {
    expected: description,
    observed: `Number input accepted numeric entry "${actualValue}"`,
    result: "pass",
  };
}

function checkPasswordInput(
  description: string,
  expectedValue: string,
  actualValue: string,
  passwordMasked: boolean,
  hasPasswordRevealControl: boolean
): Outcome {
  if (actualValue !== expectedValue) {
    return {
      expected: description,
      observed: `Password input did not retain the typed value. Expected length ${expectedValue.length}, got "${actualValue}"`,
      result: "error",
    };
  }

  if (!passwordMasked && !hasPasswordRevealControl) {
    return {
      expected: description,
      observed:
        "Password field no longer appears masked and no reveal control was detected",
      result: "error",
    };
  }

  return {
    expected: description,
    observed: passwordMasked
      ? "Password field retained the typed value and remained masked"
      : "Password field retained the typed value and has a reveal control",
    result: "pass",
  };
}

function checkSelectInput(
  description: string,
  expectedValue: string,
  selectedValues: string[]
): Outcome {
  if (!selectedValues.includes(expectedValue)) {
    return {
      expected: description,
      observed: `Expected selected option "${expectedValue}" but found [${selectedValues.join(", ")}]`,
      result: "error",
    };
  }

  return {
    expected: description,
    observed: `Select control chose "${expectedValue}"`,
    result: "pass",
  };
}
