import { describe, it, expect } from "vitest";
import {
  analyzeConsoleErrors,
  analyzeNetworkErrors,
  checkPostClickState,
} from "./functional-checker.js";

describe("functional-checker", () => {
  it("filters noise from console errors", () => {
    const errors = [
      "Failed to load resource: favicon.ico",
      "TypeError: Cannot read property x of undefined",
      "JQMIGRATE: deprecated API",
    ];
    const issues = analyzeConsoleErrors(errors);
    expect(issues).toHaveLength(1);
    expect(issues[0].description).toContain("TypeError");
  });

  it("detects same-origin 404s", () => {
    const responses = [
      { url: "https://example.com/broken", status: 404 },
      { url: "https://cdn.other.com/file", status: 404 },
    ];
    const issues = analyzeNetworkErrors(responses, "https://example.com");
    expect(issues).toHaveLength(1);
    expect(issues[0].type).toBe("not_found");
  });

  it("detects click leading to error page", () => {
    const issues = checkPostClickState(
      "https://example.com/products",
      "https://example.com/error",
      "404 Page Not Found"
    );
    expect(issues.some(i => i.type === "click_leads_to_error")).toBe(true);
  });
});
