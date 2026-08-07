import {
  ERROR_TEXT_PATTERNS,
  ERROR_SELECTORS,
  CONSOLE_NOISE_PATTERNS,
} from "../config/constants.js";
import type { NetworkLogEntry } from "../domain/types.js";

export function detectDeadClick(
  startingPageStateId: number | undefined,
  targetPageStateId: number | undefined
): boolean {
  if (startingPageStateId === undefined || targetPageStateId === undefined)
    return false;
  return startingPageStateId === targetPageStateId;
}

export function detectErrorOnPage(
  visibleText: string,
  html: string
): { description: string } | null {
  const lowerText = visibleText.toLowerCase();
  for (const pattern of ERROR_TEXT_PATTERNS) {
    if (lowerText.includes(pattern)) {
      return {
        description: `Page contains error text: "${pattern}" found in visible text`,
      };
    }
  }

  for (const selector of ERROR_SELECTORS) {
    const classMatch = selector.match(/\.([a-zA-Z0-9_-]+)/);

    if (selector.startsWith("[role=")) {
      if (html.includes('role="alert"')) {
        return { description: 'Page contains element with role="alert"' };
      }
    } else if (classMatch) {
      const className = classMatch[1];
      if (html.includes(`class="${className}"`) || html.includes(className)) {
        return {
          description: `Page contains element with class "${className}"`,
        };
      }
    } else {
      const attrMatch = selector.match(/\[([^\]]+)\]/);
      if (attrMatch && html.includes(attrMatch[1])) {
        return {
          description: `Page contains element matching ${selector}`,
        };
      }
    }
  }

  return null;
}

export function detectConsoleErrors(logs: string[], _domain: string): string[] {
  return logs.filter(log => {
    const lower = log.toLowerCase();
    if (
      !lower.includes("error") &&
      !lower.includes("typeerror") &&
      !lower.includes("referenceerror") &&
      !lower.includes("syntaxerror")
    ) {
      return false;
    }
    for (const pattern of CONSOLE_NOISE_PATTERNS) {
      if (pattern.test(log)) return false;
    }
    return true;
  });
}

export function detectNetworkErrors(
  entries: NetworkLogEntry[],
  domain: string
): NetworkLogEntry[] {
  return entries.filter(entry => {
    if (entry.status < 400) return false;
    const url = new URL(entry.url);
    const isSameDomain =
      url.hostname === domain || url.hostname.endsWith("." + domain);
    if (isSameDomain) return true;
    if (entry.status >= 500) return true;
    return false;
  });
}
