import type { ExpertiseContext, Outcome } from "../types";

export function checkValidationMessageVisible(
  expectation: { description: string },
  context: ExpertiseContext
): Outcome {
  const invalidControls = context.finalControlStates.filter(
    control => control.invalid || Boolean(control.validationMessage)
  );

  if (invalidControls.length === 0 && !hasErrorLikeText(context.html)) {
    return {
      expected: expectation.description,
      observed: "No invalid controls or visible validation messaging detected",
      result: "error",
    };
  }

  return {
    expected: expectation.description,
    observed: `Detected ${invalidControls.length} invalid control(s) or visible validation messaging`,
    result: "pass",
  };
}

export function checkFormSubmittedSuccessfully(
  expectation: { description: string },
  context: ExpertiseContext
): Outcome {
  const invalidControls = context.finalControlStates.filter(
    control => control.invalid
  );
  if (invalidControls.length > 0) {
    return {
      expected: expectation.description,
      observed: `${invalidControls.length} control(s) remain invalid after submit`,
      result: "error",
    };
  }

  if (hasErrorLikeText(context.html)) {
    return {
      expected: expectation.description,
      observed: "Error-like validation text is still present after submit",
      result: "warning",
    };
  }

  const startingPath = context.startingPath ?? "";
  const currentUrl = context.currentUrl ?? "";
  if (startingPath && currentUrl && !currentUrl.includes(startingPath)) {
    return {
      expected: expectation.description,
      observed: `Current URL changed to ${currentUrl}`,
      result: "pass",
    };
  }

  return {
    expected: expectation.description,
    observed:
      "No invalid controls, network errors, or validation messages detected after submit",
    result: "pass",
  };
}

function hasErrorLikeText(html: string): boolean {
  return /(required|invalid|error|try again|must be|please enter|please select)/i.test(
    html
  );
}
