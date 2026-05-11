import type { ExpertiseContext, Outcome } from "../types";

export function checkDialogClosed(
  expectation: { description: string },
  context: ExpertiseContext
): Outcome {
  if (context.initialUiSnapshot.dialogCount <= 0) {
    return {
      expected: expectation.description,
      observed: "No open dialog was present at the start of the test",
      result: "warning",
    };
  }

  if (
    context.finalUiSnapshot.dialogCount < context.initialUiSnapshot.dialogCount
  ) {
    return {
      expected: expectation.description,
      observed: `Open dialog count decreased from ${context.initialUiSnapshot.dialogCount} to ${context.finalUiSnapshot.dialogCount}`,
      result: "pass",
    };
  }

  return {
    expected: expectation.description,
    observed: "Dialog count did not decrease after the close action",
    result: "error",
  };
}

export function checkFocusReturned(
  expectation: { description: string },
  context: ExpertiseContext
): Outcome {
  const initial = context.initialUiSnapshot.activeElementSelector;
  const final = context.finalUiSnapshot.activeElementSelector;

  if (!initial || !final) {
    return {
      expected: expectation.description,
      observed: "Focus snapshots were unavailable",
      result: "warning",
    };
  }

  if (initial === final) {
    return {
      expected: expectation.description,
      observed: `Focus returned to ${final}`,
      result: "pass",
    };
  }

  return {
    expected: expectation.description,
    observed: `Focus moved from ${initial} to ${final} instead of returning`,
    result: "warning",
  };
}

export function checkFeedbackVisible(
  expectation: {
    description: string;
    expectedTextTokens?: string[];
    forbiddenTextTokens?: string[];
  },
  context: ExpertiseContext
): Outcome {
  const initialCount = context.initialUiSnapshot.toastCount;
  const finalCount = context.finalUiSnapshot.toastCount;
  const texts = context.finalUiSnapshot.feedbackTexts.map(text =>
    text.toLowerCase()
  );

  if (expectation.expectedTextTokens?.length) {
    const matched = expectation.expectedTextTokens.some(token =>
      texts.some(text => text.includes(token.toLowerCase()))
    );
    if (matched) {
      return {
        expected: expectation.description,
        observed: "Feedback region contains an expected token",
        result: "pass",
      };
    }
  }

  if (expectation.forbiddenTextTokens?.length) {
    const forbidden = expectation.forbiddenTextTokens.find(token =>
      texts.some(text => text.includes(token.toLowerCase()))
    );
    if (forbidden) {
      return {
        expected: expectation.description,
        observed: `Feedback region contains forbidden token "${forbidden}"`,
        result: "error",
      };
    }
  }

  if (finalCount > initialCount) {
    return {
      expected: expectation.description,
      observed: `Feedback regions increased from ${initialCount} to ${finalCount}`,
      result: "pass",
    };
  }

  return {
    expected: expectation.description,
    observed: "No new visible feedback region was detected",
    result: "warning",
  };
}
