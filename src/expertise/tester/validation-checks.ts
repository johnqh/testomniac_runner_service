import type { ExpertiseContext, Outcome } from "../types";
import { findControlBySelector } from "./control-state";

export function checkRequiredErrorShownForField(
  expectation: {
    description: string;
    targetPath?: string;
  },
  context: ExpertiseContext
): Outcome {
  const target = findControlBySelector(
    context.finalControlStates,
    expectation.targetPath
  );

  if (target && (target.invalid || Boolean(target.validationMessage))) {
    return {
      expected: expectation.description,
      observed: `Field ${target.selector} shows invalid state or validation message`,
      result: "pass",
    };
  }

  if (hasErrorLikeText(context.html)) {
    return {
      expected: expectation.description,
      observed: "Page shows visible validation-like error text",
      result: "pass",
    };
  }

  return {
    expected: expectation.description,
    observed:
      "No field-specific invalid state or validation message was detected",
    result: "error",
  };
}

export function checkFieldErrorClearsAfterFix(
  expectation: {
    description: string;
    targetPath?: string;
  },
  context: ExpertiseContext
): Outcome {
  const initial = findControlBySelector(
    context.initialControlStates,
    expectation.targetPath
  );
  const final = findControlBySelector(
    context.finalControlStates,
    expectation.targetPath
  );

  if (final && (final.invalid || Boolean(final.validationMessage))) {
    return {
      expected: expectation.description,
      observed: `Field ${final.selector} still shows invalid state after correction`,
      result: "error",
    };
  }

  if (
    initial &&
    (initial.invalid || Boolean(initial.validationMessage)) &&
    final
  ) {
    return {
      expected: expectation.description,
      observed: `Field ${final.selector} cleared its invalid state after correction`,
      result: "pass",
    };
  }

  if (!hasErrorLikeText(context.html)) {
    return {
      expected: expectation.description,
      observed:
        "No visible validation-like error text remains after correction",
      result: "pass",
    };
  }

  return {
    expected: expectation.description,
    observed: "Validation-like error text still appears after correction",
    result: "warning",
  };
}

function hasErrorLikeText(html: string): boolean {
  return /(required|invalid|error|try again|must be|please enter|please select)/i.test(
    html
  );
}
