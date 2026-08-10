import { describe, it, expect } from "vitest";
import { slimHtml } from "@sudobility/webgraph_parser";

describe("slimHtml", () => {
  it("removes script bodies", () => {
    expect(slimHtml("<div>a</div><script>var x=1;</script>")).toBe(
      "<div>a</div>"
    );
  });

  it("removes style bodies", () => {
    expect(slimHtml("<style>.a{color:red}</style><p>b</p>")).toBe("<p>b</p>");
  });

  it("removes svg bodies", () => {
    expect(slimHtml('<svg><path d="M0 0"/></svg><p>b</p>')).toBe("<p>b</p>");
  });

  it("removes html comments", () => {
    expect(slimHtml("<p>a</p><!-- note -->")).toBe("<p>a</p>");
  });

  it("empties inline data uris but keeps the element", () => {
    expect(slimHtml('<img src="data:image/png;base64,AAAA" alt="x">')).toBe(
      '<img src="" alt="x">'
    );
  });

  // These are the tags the derived signals replaced. If slimming ate them the
  // markdown projection would lose structure too.
  it("preserves the structural tags content extraction depends on", () => {
    const html =
      "<dialog open><table><tr><td>1</td></tr></table><ul><li>a</li></ul></dialog>";
    expect(slimHtml(html)).toBe(html);
  });

  it("leaves already-slim html unchanged", () => {
    expect(slimHtml("<p>hello</p>")).toBe("<p>hello</p>");
  });
});
