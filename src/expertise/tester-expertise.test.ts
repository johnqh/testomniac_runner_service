import { describe, expect, it } from "vitest";
import { ExpertiseRuleId } from "@sudobility/testomniac_types";
import { TesterExpertise } from "./tester-expertise.js";
import type { ExpertiseContext } from "./types.js";
import type { UiSnapshot } from "../browser/ui-snapshot.js";

function createContext(
  currentUrl: string,
  expectations: ExpertiseContext["expectations"]
): ExpertiseContext {
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
    expectations,
    initialUrl: "https://example.com/",
    currentUrl,
    startingPath: "/",
    initialUiSnapshot: uiSnapshot,
    finalUiSnapshot: uiSnapshot,
    initialControlStates: [],
    finalControlStates: [],
  };
}

/**
 * These cover the SWITCH WIRING, not the check logic (that lives in
 * navigation-checks.test.ts). The default branch of checkExpectation returns
 * "pass" for unhandled expectation types, so an unwired expectation silently
 * succeeds. Route drift detection depends entirely on url_equals being wired.
 */
describe("TesterExpertise url_equals wiring", () => {
  const arrivalExpectation = (targetPath: string) =>
    [
      {
        expectationType: "url_equals",
        targetPath,
        severity: "error",
        description: `Arrive at ${targetPath}`,
        playwrightCode: "",
      },
    ] as unknown as ExpertiseContext["expectations"];

  it("reports an error when the browser did not arrive at the target path", () => {
    const outcomes = new TesterExpertise().evaluate(
      createContext(
        "https://example.com/login",
        arrivalExpectation("/checkout")
      )
    );

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].result).toBe("error");
  });

  it("does not fall through to the assumed-pass default branch", () => {
    const outcomes = new TesterExpertise().evaluate(
      createContext(
        "https://example.com/login",
        arrivalExpectation("/checkout")
      )
    );

    expect(outcomes[0].observed).not.toContain("Check not implemented");
  });

  it("tags the outcome with the route-arrival rule id", () => {
    const outcomes = new TesterExpertise().evaluate(
      createContext(
        "https://example.com/login",
        arrivalExpectation("/checkout")
      )
    );

    expect(outcomes[0].ruleId).toBe(ExpertiseRuleId.TesterUrlMatchesTarget);
  });

  it("passes when the browser did arrive at the target path", () => {
    const outcomes = new TesterExpertise().evaluate(
      createContext(
        "https://example.com/checkout",
        arrivalExpectation("/checkout")
      )
    );

    expect(outcomes[0].result).toBe("pass");
  });
});
