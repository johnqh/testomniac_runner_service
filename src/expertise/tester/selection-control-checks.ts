import type { ExpertiseContext, Outcome } from "../types";
import {
  classifyControlKind,
  findControlBySelector,
  findControlPeers,
} from "./control-state";

export function checkSelectionState(
  expectation: {
    description: string;
    targetPath?: string;
    expectNoChange?: boolean;
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

  if (expectation.expectNoChange || final.disabled) {
    if (!initial) {
      return {
        expected: expectation.description,
        observed: "Disabled control was not present in the initial snapshot",
        result: "error",
      };
    }

    if (
      initial.checked !== final.checked ||
      initial.selected !== final.selected ||
      initial.value !== final.value
    ) {
      return {
        expected: expectation.description,
        observed: "Disabled control changed state after interaction",
        result: "error",
      };
    }

    return {
      expected: expectation.description,
      observed: expectation.expectNoChange
        ? "Control did not respond to interaction"
        : "Disabled control did not respond to interaction",
      result: "pass",
    };
  }

  const kind = classifyControlKind(final);
  switch (kind) {
    case "radio":
      return checkRadioSelection(expectation.description, final, context);
    case "checkbox":
    case "switch":
      return checkCheckboxSelection(
        expectation.description,
        initial,
        final,
        context
      );
    case "tab":
      return checkTabSelection(expectation.description, final, context);
    default:
      return {
        expected: expectation.description,
        observed: `Control kind "${kind}" does not support selection assertions`,
        result: "warning",
      };
  }
}

function checkRadioSelection(
  description: string,
  final: NonNullable<ReturnType<typeof findControlBySelector>>,
  context: ExpertiseContext
): Outcome {
  const peers = findControlPeers(context.finalControlStates, final);
  const checkedPeers = peers.filter(peer => peer.checked || peer.selected);

  if (!(final.checked || final.selected)) {
    return {
      expected: description,
      observed: "Radio control was not selected after interaction",
      result: "error",
    };
  }

  if (checkedPeers.length > 1) {
    return {
      expected: description,
      observed: `Radio group has multiple selected controls (${checkedPeers.length})`,
      result: "error",
    };
  }

  return {
    expected: description,
    observed:
      "Radio control selected itself and unselected the rest of its group",
    result: "pass",
  };
}

function checkCheckboxSelection(
  description: string,
  initial: ReturnType<typeof findControlBySelector>,
  final: NonNullable<ReturnType<typeof findControlBySelector>>,
  context: ExpertiseContext
): Outcome {
  if (!final.checked) {
    return {
      expected: description,
      observed: "Checkbox-like control is not checked after interaction",
      result: "error",
    };
  }

  const initialPeers = findControlPeers(context.initialControlStates, initial);
  const finalPeers = findControlPeers(context.finalControlStates, final);

  for (const peer of initialPeers) {
    if (!peer.checked || peer.selector === final.selector) continue;
    const matchingFinal = finalPeers.find(
      candidate => candidate.selector === peer.selector
    );
    if (matchingFinal && !matchingFinal.checked) {
      return {
        expected: description,
        observed: `Checkbox interaction unexpectedly unchecked sibling control ${peer.selector}`,
        result: "error",
      };
    }
  }

  return {
    expected: description,
    observed:
      "Checkbox-like control checked itself without clearing other checked siblings",
    result: "pass",
  };
}

function checkTabSelection(
  description: string,
  final: NonNullable<ReturnType<typeof findControlBySelector>>,
  context: ExpertiseContext
): Outcome {
  const peers = findControlPeers(context.finalControlStates, final);
  const selectedPeers = peers.filter(peer => peer.selected);

  if (!final.selected) {
    return {
      expected: description,
      observed: "Tab did not become selected after interaction",
      result: "error",
    };
  }

  if (selectedPeers.length !== 1) {
    return {
      expected: description,
      observed: `Tablist has ${selectedPeers.length} selected tabs instead of exactly one`,
      result: "error",
    };
  }

  return {
    expected: description,
    observed: "Tab interaction resulted in a single selected tab",
    result: "pass",
  };
}
