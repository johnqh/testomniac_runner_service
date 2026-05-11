import type { ExpertiseContext, Outcome } from "../types";
import { findControlBySelector } from "./control-state";

export function checkExpandedStateChanged(
  expectation: {
    description: string;
    targetPath?: string;
    expectedValue?: string;
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

  if (!final) {
    return {
      expected: expectation.description,
      observed: `Target control not found for selector ${expectation.targetPath ?? "(unknown)"}`,
      result: "error",
    };
  }

  if (final.expanded == null) {
    return {
      expected: expectation.description,
      observed: "Target control does not expose aria-expanded state",
      result: "warning",
    };
  }

  if (expectation.expectedValue === "true" && final.expanded !== true) {
    return {
      expected: expectation.description,
      observed: "Disclosure did not become expanded",
      result: "error",
    };
  }

  if (expectation.expectedValue === "false" && final.expanded !== false) {
    return {
      expected: expectation.description,
      observed: "Disclosure did not become collapsed",
      result: "error",
    };
  }

  if (initial && initial.expanded === final.expanded) {
    return {
      expected: expectation.description,
      observed: `Disclosure state did not change (${String(final.expanded)})`,
      result: "error",
    };
  }

  return {
    expected: expectation.description,
    observed: `Disclosure state changed to ${String(final.expanded)}`,
    result: "pass",
  };
}
