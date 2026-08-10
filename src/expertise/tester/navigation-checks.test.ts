import { describe, expect, it } from "vitest";
import {
  checkNavigationOrStateChanged,
  checkUrlMatchesTarget,
  checkUrlUnchanged,
} from "./navigation-checks.js";
import type { ExpertiseContext } from "../types.js";
import type { UiSnapshot } from "@sudobility/webgraph_parser";

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

describe("checkUrlMatchesTarget", () => {
  it("passes when the current url path matches the target path", () => {
    const result = checkUrlMatchesTarget(
      { description: "Arrive at /checkout", targetPath: "/checkout" },
      createContext("https://example.com/checkout")
    );

    expect(result.result).toBe("pass");
  });

  it("ignores query strings and trailing slashes", () => {
    const result = checkUrlMatchesTarget(
      { description: "Arrive at /checkout", targetPath: "/checkout/" },
      createContext("https://example.com/checkout?step=1")
    );

    expect(result.result).toBe("pass");
  });

  it("errors when the route landed somewhere else", () => {
    const result = checkUrlMatchesTarget(
      { description: "Arrive at /checkout", targetPath: "/checkout" },
      createContext("https://example.com/login")
    );

    expect(result.result).toBe("error");
    expect(result.observed).toContain("/login");
  });

  it("warns when the url context is unavailable rather than failing", () => {
    const result = checkUrlMatchesTarget(
      { description: "Arrive at /checkout", targetPath: "/checkout" },
      createContext(undefined)
    );

    expect(result.result).toBe("warning");
  });

  it("warns when no target path was supplied", () => {
    const result = checkUrlMatchesTarget(
      { description: "Arrive somewhere" },
      createContext("https://example.com/checkout")
    );

    expect(result.result).toBe("warning");
  });
});
