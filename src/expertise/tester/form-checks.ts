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

export function checkErrorStateVisible(
  expectation: { description: string },
  context: ExpertiseContext
): Outcome {
  const invalidControls = context.finalControlStates.filter(
    control => control.invalid || Boolean(control.validationMessage)
  );
  const feedbackHasError = hasErrorLikeFeedback(
    context.finalUiSnapshot.feedbackTexts
  );

  if (
    invalidControls.length > 0 ||
    hasErrorLikeText(context.html) ||
    feedbackHasError
  ) {
    return {
      expected: expectation.description,
      observed:
        invalidControls.length > 0
          ? `Detected ${invalidControls.length} invalid control(s) or visible error state`
          : "Visible error-like text or feedback was detected",
      result: "pass",
    };
  }

  return {
    expected: expectation.description,
    observed: "No visible error state was detected",
    result: "error",
  };
}

export function checkErrorStateCleared(
  expectation: { description: string },
  context: ExpertiseContext
): Outcome {
  const initialHasError =
    context.initialControlStates.some(
      control => control.invalid || Boolean(control.validationMessage)
    ) ||
    hasErrorLikeText(context.initialHtml) ||
    hasErrorLikeFeedback(context.initialUiSnapshot.feedbackTexts);
  const finalHasError =
    context.finalControlStates.some(
      control => control.invalid || Boolean(control.validationMessage)
    ) ||
    hasErrorLikeText(context.html) ||
    hasErrorLikeFeedback(context.finalUiSnapshot.feedbackTexts);

  if (finalHasError) {
    return {
      expected: expectation.description,
      observed: "Visible error state remains after the recovery action",
      result: "error",
    };
  }

  if (initialHasError) {
    return {
      expected: expectation.description,
      observed: "Previously visible error state was cleared",
      result: "pass",
    };
  }

  return {
    expected: expectation.description,
    observed: "No visible error state was present before the recovery action",
    result: "warning",
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

function hasErrorLikeFeedback(feedbackTexts: string[]): boolean {
  return feedbackTexts.some(text =>
    /\b(error|failed|try again|invalid|required|unable|problem)\b/i.test(text)
  );
}
