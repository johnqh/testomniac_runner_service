import { describe, expect, it } from "vitest";
import { checkNoNetworkErrors, checkPageLoaded } from "./core-checks";

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

  it("fails when the current document returns a same-origin 404", () => {
    const outcome = checkPageLoaded(
      {
        html: "<html><body><h1>404 Not Found</h1></body></html>",
        initialHtml: "",
        scaffolds: [],
        patterns: [],
        consoleLogs: [],
        networkLogs: [
          {
            method: "GET",
            url: "https://academybugs.com/terms-and-conditions",
            status: 404,
            contentType: "text/html",
          },
        ],
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
        initialUrl: "https://academybugs.com/",
        currentUrl: "https://academybugs.com/terms-and-conditions",
      },
      "Page should load with valid HTML"
    );

    expect(outcome.result).toBe("error");
    expect(outcome.observed).toContain("HTTP 404");
  });
});

describe("checkNoNetworkErrors", () => {
  const baseContext = {
    html: "<html></html>",
    initialHtml: "<html></html>",
    scaffolds: [],
    patterns: [],
    expectations: [],
    consoleLogs: [],
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
    initialUrl: "https://academybugs.com/find-bugs/",
    currentUrl: "https://academybugs.com/find-bugs/",
  };

  it("ignores third-party network noise", () => {
    const outcome = checkNoNetworkErrors(
      {
        ...baseContext,
        networkLogs: [
          {
            method: "GET",
            url: "https://analytics.example.com/pixel.js",
            status: 404,
            contentType: "application/javascript",
          },
        ],
      },
      "No network errors during page load or interaction"
    );

    expect(outcome.result).toBe("pass");
  });

  it("warns for non-critical same-origin asset failures", () => {
    const outcome = checkNoNetworkErrors(
      {
        ...baseContext,
        networkLogs: [
          {
            method: "GET",
            url: "https://academybugs.com/wp-content/uploads/missing-image.png",
            status: 404,
            contentType: "image/png",
          },
        ],
      },
      "No network errors during page load or interaction"
    );

    expect(outcome.result).toBe("warning");
  });

  it("fails for critical same-origin api failures", () => {
    const outcome = checkNoNetworkErrors(
      {
        ...baseContext,
        networkLogs: [
          {
            method: "POST",
            url: "https://academybugs.com/api/cart",
            status: 500,
            contentType: "application/json",
          },
        ],
      },
      "No network errors during page load or interaction"
    );

    expect(outcome.result).toBe("error");
  });
});
