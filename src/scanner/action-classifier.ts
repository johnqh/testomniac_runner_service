import type { ActionableItem } from "@sudobility/testomniac_types";

export function normalizeHref(href: string, baseUrl: string): string | null {
  try {
    const url = new URL(href, baseUrl);
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

export function shouldExpectNavigation(
  item: ActionableItem,
  beforeUrl: string
): boolean {
  if (item.actionKind !== "navigate" || !item.href) return false;
  const target = normalizeHref(item.href, beforeUrl);
  if (!target) return false;
  return target !== beforeUrl.split("#")[0];
}

export function looksLikeSubmitAction(item: ActionableItem): boolean {
  const text =
    `${item.accessibleName || ""} ${item.textContent || ""}`.toLowerCase();
  const inputType = (item.inputType || "").toLowerCase();

  return (
    inputType === "submit" ||
    text.includes("submit") ||
    text.includes("send") ||
    text.includes("search") ||
    text.includes("book") ||
    text.includes("report") ||
    text.includes("save")
  );
}

export function looksLikeEnterCommitField(item: ActionableItem): boolean {
  const text =
    `${item.accessibleName || ""} ${item.textContent || ""}`.toLowerCase();
  const inputType = (item.inputType || "").toLowerCase();
  const role = (item.role || "").toLowerCase();

  return (
    inputType === "search" ||
    role === "combobox" ||
    text.includes("search") ||
    text.includes("query")
  );
}

export function getActionPriority(item: ActionableItem): number {
  const text =
    `${item.accessibleName || ""} ${item.textContent || ""}`.toLowerCase();
  const href = (item.href || "").toLowerCase();
  if (item.actionKind === "fill" || item.actionKind === "select") return 0;
  if (item.actionKind === "radio_select") return 1;
  if (
    href.includes("/store/") ||
    href.includes("ec_action=addtocart") ||
    href.includes("/my-cart/")
  ) {
    return 2;
  }
  if (looksLikeSubmitAction(item)) return 2;
  if (
    text.includes("add to cart") ||
    text.includes("checkout") ||
    text.includes("select options")
  ) {
    return 2;
  }
  if (item.actionKind === "navigate") return 4;
  if (item.actionKind === "click") return 3;
  return 3;
}
