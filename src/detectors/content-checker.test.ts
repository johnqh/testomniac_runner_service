import { describe, it, expect } from "vitest";
import { checkContentIssues } from "./content-checker.js";

describe("content-checker", () => {
  it("detects placeholder text", () => {
    const issues = checkContentIssues(
      "Lorem ipsum dolor sit amet",
      "<p>Lorem ipsum</p>"
    );
    expect(issues.some(i => i.type === "placeholder_text")).toBe(true);
  });

  it("detects error pages", () => {
    const issues = checkContentIssues("404 Page Not Found", "<h1>404</h1>");
    expect(issues.some(i => i.type === "error_page")).toBe(true);
  });

  it("passes clean content", () => {
    const issues = checkContentIssues(
      "Welcome to our store. Browse our products and find great deals.",
      "<p>Welcome</p>"
    );
    expect(issues.filter(i => i.severity === "error")).toHaveLength(0);
  });
});
