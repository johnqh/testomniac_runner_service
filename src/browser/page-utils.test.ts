import { describe, it, expect } from "vitest";
import { computeHashes, normalizeHtml } from "./page-utils.js";

describe("page-utils", () => {
  it("computeHashes returns 4 hex strings", async () => {
    const hashes = await computeHashes("<html><body>Hello</body></html>", []);
    expect(hashes.htmlHash).toMatch(/^[a-f0-9]{64}$/);
    expect(hashes.normalizedHtmlHash).toMatch(/^[a-f0-9]{64}$/);
    expect(hashes.textHash).toMatch(/^[a-f0-9]{64}$/);
    expect(hashes.actionableHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("normalizeHtml strips whitespace and sorts attributes", () => {
    const a = normalizeHtml('<div  class="a"  id="b" >  hello  </div>');
    const b = normalizeHtml('<div id="b" class="a">hello</div>');
    expect(a).toBe(b);
  });

  it("different content produces different hashes", async () => {
    const a = await computeHashes("<body>Page A</body>", []);
    const b = await computeHashes("<body>Page B</body>", []);
    expect(a.textHash).not.toBe(b.textHash);
  });
});
