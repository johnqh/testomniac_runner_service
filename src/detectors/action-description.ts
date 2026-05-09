import type { ActionDefinitionResponse } from "@sudobility/testomniac_types";

export function describeAction(
  action: ActionDefinitionResponse,
  elementName?: string
): string {
  const name = elementName ?? "element";
  switch (action.type) {
    case "navigate":
      return `Navigate to ${action.targetUrl ?? "page"}`;
    case "hover":
      return `Move mouse over ${name}`;
    case "click":
      return `Click ${name}`;
    case "fill":
      return `Enter '${action.inputValue ?? ""}' into ${name}`;
    case "select":
      return `Select option in ${name}`;
    case "radio_select":
      return `Select radio button ${name}`;
    default:
      return `${action.type} on ${name}`;
  }
}

export function buildTestElementDescription(
  actions: ActionDefinitionResponse[],
  elementNames?: Map<number, string>
): string {
  return actions
    .map(
      (a, i) =>
        `${i + 1}. ${describeAction(a, elementNames?.get(a.actionableItemId ?? 0))}`
    )
    .join("\n");
}
