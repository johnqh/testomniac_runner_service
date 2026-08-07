import { describe, it, expect } from "vitest";
import {
  detectDeadClick,
  detectErrorOnPage,
  detectConsoleErrors,
  detectNetworkErrors,
} from "./issue-detector.js";

describe("issue-detector", () => {
  it("detectDeadClick returns true when states match", () => {
    expect(detectDeadClick(5, 5)).toBe(true);
    expect(detectDeadClick(5, 6)).toBe(false);
  });

  it("detectDeadClick returns false when starting state is undefined", () => {
    expect(detectDeadClick(undefined, 5)).toBe(false);
  });

  it("detectErrorOnPage finds error text patterns", () => {
    const result = detectErrorOnPage(
      "Something went wrong",
      '<div class="error">Oops</div>'
    );
    expect(result).not.toBeNull();
    expect(result!.description).toContain("something went wrong");
  });

  it("detectErrorOnPage finds error HTML selectors", () => {
    const result = detectErrorOnPage(
      "All good",
      '<div role="alert">Server error</div>'
    );
    expect(result).not.toBeNull();
  });

  it("detectErrorOnPage returns null for clean pages", () => {
    const result = detectErrorOnPage("Welcome home", "<div>Hello world</div>");
    expect(result).toBeNull();
  });

  it("detectConsoleErrors filters noise", () => {
    const logs = [
      "Failed to load resource: favicon.ico",
      "TypeError: Cannot read property x of undefined",
      "Some deprecated API warning",
    ];
    const errors = detectConsoleErrors(logs, "example.com");
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("TypeError");
  });

  it("detectNetworkErrors catches same-domain 4xx", () => {
    const entries = [
      {
        method: "GET",
        url: "https://example.com/api/data",
        status: 404,
        contentType: "application/json",
      },
      {
        method: "GET",
        url: "https://cdn.analytics.com/track",
        status: 404,
        contentType: "text/html",
      },
    ];
    const errors = detectNetworkErrors(entries, "example.com");
    expect(errors).toHaveLength(1);
    expect(errors[0].url).toContain("example.com");
  });

  it("detectNetworkErrors catches any-domain 5xx", () => {
    const entries = [
      {
        method: "POST",
        url: "https://other.com/webhook",
        status: 500,
        contentType: "text/html",
      },
    ];
    const errors = detectNetworkErrors(entries, "example.com");
    expect(errors).toHaveLength(1);
  });

  it("detectNetworkErrors ignores third-party 4xx", () => {
    const entries = [
      {
        method: "GET",
        url: "https://ads.tracker.com/pixel",
        status: 403,
        contentType: "text/html",
      },
    ];
    const errors = detectNetworkErrors(entries, "example.com");
    expect(errors).toHaveLength(0);
  });
});
