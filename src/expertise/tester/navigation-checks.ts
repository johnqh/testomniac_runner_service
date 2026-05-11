import type { ExpertiseContext, Outcome } from "../types";

export function checkUrlUnchanged(
  expectation: { description: string },
  context: ExpertiseContext
): Outcome {
  const startingPath = context.startingPath ?? "";
  const currentUrl = context.currentUrl ?? "";

  if (!startingPath || !currentUrl) {
    return {
      expected: expectation.description,
      observed: "URL comparison context was unavailable",
      result: "warning",
    };
  }

  if (!currentUrl.includes(startingPath)) {
    return {
      expected: expectation.description,
      observed: `URL changed unexpectedly to ${currentUrl}`,
      result: "error",
    };
  }

  return {
    expected: expectation.description,
    observed: `URL remained on ${currentUrl}`,
    result: "pass",
  };
}

export function checkNavigationOrStateChanged(
  expectation: { description: string },
  context: ExpertiseContext
): Outcome {
  const initialUrl = context.initialUrl ?? "";
  const currentUrl = context.currentUrl ?? "";

  if (initialUrl && currentUrl && initialUrl !== currentUrl) {
    return {
      expected: expectation.description,
      observed: `URL changed from ${initialUrl} to ${currentUrl}`,
      result: "pass",
    };
  }

  if (normalizeHtml(context.initialHtml) !== normalizeHtml(context.html)) {
    return {
      expected: expectation.description,
      observed: "DOM changed after interaction",
      result: "pass",
    };
  }

  const controlChanged = context.finalControlStates.some(finalState => {
    const initialState = context.initialControlStates.find(
      candidate => candidate.selector === finalState.selector
    );
    return (
      !initialState ||
      initialState.value !== finalState.value ||
      initialState.checked !== finalState.checked ||
      initialState.selected !== finalState.selected
    );
  });

  if (controlChanged) {
    return {
      expected: expectation.description,
      observed: "Control state changed after interaction",
      result: "pass",
    };
  }

  return {
    expected: expectation.description,
    observed: "No URL, DOM, or control-state change was detected",
    result: "error",
  };
}

function normalizeHtml(html: string): string {
  return html.replace(/\s+/g, " ").trim();
}
