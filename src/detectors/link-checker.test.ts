import { describe, it, expect } from "vitest";
import { extractLinks } from "./link-checker.js";

describe("link-checker", () => {
  it("extracts links from HTML", () => {
    const html =
      '<a href="/about">About</a><a href="https://example.com/page">Page</a>';
    const links = extractLinks(html, "https://example.com");
    expect(links).toHaveLength(2);
    expect(links[0].href).toBe("https://example.com/about");
    expect(links[0].text).toBe("About");
  });

  it("skips anchors and javascript links", () => {
    const html =
      '<a href="#top">Top</a><a href="javascript:void(0)">Click</a><a href="mailto:a@b.com">Email</a>';
    const links = extractLinks(html, "https://example.com");
    expect(links).toHaveLength(0);
  });
});
