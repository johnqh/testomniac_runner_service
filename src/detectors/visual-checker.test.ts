import { describe, it, expect } from "vitest";
import { checkVisualIssues } from "./visual-checker.js";

describe("visual-checker", () => {
  it("detects duplicate IDs", () => {
    const html = '<div id="main">A</div><div id="main">B</div>';
    const issues = checkVisualIssues(html, "https://example.com");
    expect(issues.some(i => i.type === "duplicate_id")).toBe(true);
  });

  it("detects duplicate headings", () => {
    const html = "<h4>Home / Shop</h4><h4>Home / Shop</h4>";
    const issues = checkVisualIssues(html, "https://example.com");
    expect(issues.some(i => i.type === "duplicate_heading")).toBe(true);
  });

  it("detects empty links", () => {
    const html = '<a href="/page"></a>';
    const issues = checkVisualIssues(html, "https://example.com");
    expect(issues.some(i => i.type === "empty_link")).toBe(true);
  });
});
