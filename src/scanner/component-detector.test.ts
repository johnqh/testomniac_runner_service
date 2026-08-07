import { describe, it, expect } from "vitest";
import {
  extractCandidateRegions,
  groupByHash,
  COMPONENT_SELECTORS,
} from "./component-detector.js";
import { normalizeHtml } from "../browser/page-utils.js";
import { createHash } from "node:crypto";

function sha256(s: string) {
  return createHash("sha256").update(s).digest("hex");
}

describe("component-detector", () => {
  it("COMPONENT_SELECTORS includes nav, header, footer", () => {
    expect(COMPONENT_SELECTORS).toContain("nav");
    expect(COMPONENT_SELECTORS).toContain("header");
    expect(COMPONENT_SELECTORS).toContain("footer");
    expect(COMPONENT_SELECTORS).toContain('[role="navigation"]');
  });

  it("extractCandidateRegions finds nav and footer", () => {
    const html =
      '<header><nav><a href="/">Home</a></nav></header><main>Content</main><footer><p>Copyright</p></footer>';
    const regions = extractCandidateRegions(html);
    expect(regions.length).toBeGreaterThanOrEqual(2);
    const selectors = regions.map(r => r.selector);
    expect(selectors).toContain("nav");
    expect(selectors).toContain("footer");
  });

  it("groupByHash groups identical regions", () => {
    const navHtml = '<a href="/">Home</a><a href="/about">About</a>';
    const hash = sha256(normalizeHtml(navHtml));
    const regions = [
      { pageStateId: 1, selector: "nav", innerHtml: navHtml, hash },
      { pageStateId: 2, selector: "nav", innerHtml: navHtml, hash },
      {
        pageStateId: 3,
        selector: "nav",
        innerHtml: navHtml + '<a href="/new">New</a>',
        hash: sha256(normalizeHtml(navHtml + '<a href="/new">New</a>')),
      },
    ];
    const groups = groupByHash(regions);
    expect(groups.length).toBe(2);
    const mainGroup = groups.find(g => g.instances.length === 2);
    expect(mainGroup).toBeDefined();
    expect(mainGroup!.hash).toBe(hash);
  });
});
