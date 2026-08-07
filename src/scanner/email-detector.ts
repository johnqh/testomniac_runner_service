import {
  EMAIL_HINT_PATTERNS,
  EMAIL_CONFIRMATION_PATTERNS,
} from "../config/constants.js";

export function detectEmailHint(
  hasEmailField: boolean,
  visibleText: string
): boolean {
  if (!hasEmailField) return false;
  const lower = visibleText.toLowerCase();
  return EMAIL_HINT_PATTERNS.some(p => lower.includes(p));
}

export function detectEmailConfirmation(visibleText: string): boolean {
  const lower = visibleText.toLowerCase();
  return EMAIL_CONFIRMATION_PATTERNS.some(p => lower.includes(p));
}
