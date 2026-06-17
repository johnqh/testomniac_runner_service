import type { UserData } from "@sudobility/testomniac_types";
import { resolveVariables } from "./variable-resolver";

/**
 * Return a shallow copy of `action` with `value` and `path` resolved against
 * userData. Throws UnresolvedVariableError if any referenced variable is
 * missing (caller surfaces this as a step failure). The input is not mutated,
 * so callers can keep the original (un-interpolated) action for logging.
 */
export function interpolateAction<T extends { value?: string; path?: string }>(
  action: T,
  userData: UserData | undefined
): T {
  const next: T = { ...action };
  if (typeof next.value === "string") {
    next.value = resolveVariables(next.value, userData);
  }
  if (typeof next.path === "string") {
    next.path = resolveVariables(next.path, userData);
  }
  return next;
}
