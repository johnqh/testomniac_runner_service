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
  const initialTexts = context.initialUiSnapshot.feedbackTexts.map(text =>
    text.toLowerCase()
  );
  const texts = context.finalUiSnapshot.feedbackTexts.map(text =>
    text.toLowerCase()
  );

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

  if (expectation.expectedTextTokens?.length) {
    const matchedText = texts.find(text =>
      expectation.expectedTextTokens?.some(token =>
        text.includes(token.toLowerCase())
      )
    );
    if (matchedText) {
      const wasAlreadyVisible = initialTexts.some(
        initialText => initialText === matchedText
      );
      if (wasAlreadyVisible && finalCount <= initialCount) {
        return {
          expected: expectation.description,
          observed:
            "Expected feedback text was already visible before the action and no new feedback appeared",
          result: "warning",
        };
      }

      return {
        expected: expectation.description,
        observed: "Feedback region contains a newly visible expected token",
        result: "pass",
      };
    }
  }

  const newTexts = texts.filter(text => !initialTexts.includes(text));
  if (finalCount > initialCount) {
    return {
      expected: expectation.description,
      observed: `Feedback regions increased from ${initialCount} to ${finalCount}`,
      result: "pass",
    };
  }

  if (newTexts.length > 0) {
    return {
      expected: expectation.description,
      observed: "Visible feedback content changed after the action",
      result: "pass",
    };
  }

  return {
    expected: expectation.description,
    observed: "No new visible feedback region was detected",
    result: "warning",
  };
}

export function checkFeedbackNotDuplicated(
  expectation: { description: string },
  context: ExpertiseContext
): Outcome {
  const texts = context.finalUiSnapshot.feedbackTexts
    .map(text => text.trim().toLowerCase())
    .filter(Boolean);

  if (texts.length <= 1) {
    return {
      expected: expectation.description,
      observed: "No duplicate visible feedback messages were detected",
      result: "pass",
    };
  }

  const duplicates = new Set<string>();
  const seen = new Set<string>();
  for (const text of texts) {
    if (seen.has(text)) {
      duplicates.add(text);
    }
    seen.add(text);
  }

  if (duplicates.size > 0) {
    return {
      expected: expectation.description,
      observed: `Duplicate feedback messages detected: ${Array.from(duplicates).join(", ")}`,
      result: "error",
    };
  }

  return {
    expected: expectation.description,
    observed: "Multiple distinct feedback messages were visible at once",
    result: "warning",
  };
}
