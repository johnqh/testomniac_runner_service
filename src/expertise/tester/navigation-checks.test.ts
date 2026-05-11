import { describe, expect, it } from "vitest";
import {
  checkNavigationOrStateChanged,
  checkUrlUnchanged,
} from "./navigation-checks";
import type { ExpertiseContext } from "../types";
import type { UiSnapshot } from "../../browser/ui-snapshot";

function createContext(currentUrl?: string): ExpertiseContext {
  const uiSnapshot: UiSnapshot = {
    activeElementSelector: "body",
    dialogCount: 0,
    toastCount: 0,
    feedbackTexts: [],
  };
  return {
    html: "",
    initialHtml: "",
    scaffolds: [],
    patterns: [],
    consoleLogs: [],
    networkLogs: [],
    expectations: [],
    initialUrl: "https://example.com/account",
    currentUrl,
    startingPath: "/account",
    initialUiSnapshot: uiSnapshot,
    finalUiSnapshot: uiSnapshot,
    initialControlStates: [],
    finalControlStates: [],
  };
}

describe("checkUrlUnchanged", () => {
  it("passes when the current url remains on the starting path", () => {
    const result = checkUrlUnchanged(
      {
        description: "Disabled link should not navigate",
      },
      createContext("https://example.com/account?tab=billing")
    );

    expect(result.result).toBe("pass");
  });

  it("fails when the current url leaves the starting path", () => {
    const result = checkUrlUnchanged(
      {
        description: "Disabled link should not navigate",
      },
      createContext("https://example.com/checkout")
    );

    expect(result.result).toBe("error");
  });

  it("passes when url or dom state changes", () => {
    const result = checkNavigationOrStateChanged(
      {
        description: "Interaction should change page state",
      },
      {
        ...createContext("https://example.com/account"),
        initialHtml: "<main>Before</main>",
        html: "<main>After</main>",
      }
    );

    expect(result.result).toBe("pass");
  });
});
