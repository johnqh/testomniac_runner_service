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

function normalizeUrlPath(value: string): string | null {
  if (!value) return null;
  let pathname: string;
  try {
    pathname = new URL(value, "http://placeholder").pathname;
  } catch {
    return null;
  }
  const trimmed = pathname.replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed;
}

/**
 * Assert the browser ended on an expected path.
 *
 * Used by route chains materialized from the navigation graph: setup replay
 * swallows per-step errors, so without an explicit arrival assertion a stale
 * route would leave the browser somewhere wrong and the scenario would run
 * from there. This turns that silent drift into a finding.
 */
export function checkUrlMatchesTarget(
  expectation: { description: string; targetPath?: string },
  context: ExpertiseContext
): Outcome {
  const expected = expectation.targetPath
    ? normalizeUrlPath(expectation.targetPath)
    : null;
  const actual = normalizeUrlPath(context.currentUrl ?? "");

  if (!expected) {
    return {
      expected: expectation.description,
      observed: "No target path was supplied for the URL check",
      result: "warning",
    };
  }

  if (!actual) {
    return {
      expected: expectation.description,
      observed: "URL comparison context was unavailable",
      result: "warning",
    };
  }

  if (actual !== expected) {
    return {
      expected: expectation.description,
      observed: `Expected to arrive at ${expected} but landed on ${actual}`,
      result: "error",
    };
  }

  return {
    expected: expectation.description,
    observed: `Arrived at ${actual}`,
    result: "pass",
  };
}
