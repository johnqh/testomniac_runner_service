import { describe, expect, it } from "vitest";
import { checkPageLoaded } from "./core-checks";

describe("checkPageLoaded", () => {
  it("treats null html as a failed page load instead of throwing", () => {
    const outcome = checkPageLoaded(
      {
        html: null as unknown as string,
        initialHtml: "",
        scaffolds: [],
        patterns: [],
        consoleLogs: [],
        networkLogs: [],
        expectations: [],
        initialUiSnapshot: {
          dialogCount: 0,
          toastCount: 0,
          feedbackTexts: [],
        },
        finalUiSnapshot: {
          dialogCount: 0,
          toastCount: 0,
          feedbackTexts: [],
        },
        initialControlStates: [],
        finalControlStates: [],
      },
      "Page should load with valid HTML"
    );

    expect(outcome.result).toBe("error");
    expect(outcome.observed).toContain("empty");
  });
});
