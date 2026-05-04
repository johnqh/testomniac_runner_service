import { describe, it, expect } from "vitest";
import {
  getBody,
  getContentBody,
  getFixedBody,
  decomposeHtml,
} from "./html-decomposer";
import type { DetectedScaffoldRegion } from "./component-detector";
import type { PatternInstance } from "@sudobility/testomniac_types";

describe("getBody", () => {
  it("extracts body content from full HTML", () => {
    const html =
      "<html><head><title>Test</title></head><body><h1>Hello</h1></body></html>";
    expect(getBody(html)).toBe("<h1>Hello</h1>");
  });

  it("handles body with attributes", () => {
    const html =
      '<html><body class="main" id="app"><p>Content</p></body></html>';
    expect(getBody(html)).toBe("<p>Content</p>");
  });

  it("returns full input when no body tag", () => {
    const html = "<h1>No body tag</h1>";
    expect(getBody(html)).toBe(html);
  });

  it("handles multiline body", () => {
    const html =
      "<html><body>\n  <div>\n    <p>Test</p>\n  </div>\n</body></html>";
    expect(getBody(html)).toContain("<p>Test</p>");
  });
});

describe("getContentBody", () => {
  it("strips reusable regions from body", () => {
    const body =
      "<header><nav>Menu</nav></header><main>Content</main><footer>Foot</footer>";
    const regions: DetectedScaffoldRegion[] = [
      {
        type: "topMenu",
        selector: "header",
        outerHtml: "<header><nav>Menu</nav></header>",
        hash: "abc",
      },
      {
        type: "footer",
        selector: "footer",
        outerHtml: "<footer>Foot</footer>",
        hash: "def",
      },
    ];
    const { contentBody, scaffolds } = getContentBody(body, regions);
    expect(contentBody).toBe(
      "<!-- scaffold: topMenu --><main>Content</main><!-- scaffold: footer -->"
    );
    expect(scaffolds).toHaveLength(2);
  });

  it("skips regions not found in body", () => {
    const body = "<main>Content</main>";
    const regions: DetectedScaffoldRegion[] = [
      {
        type: "footer",
        selector: "footer",
        outerHtml: "<footer>Missing</footer>",
        hash: "xyz",
      },
    ];
    const { contentBody, scaffolds } = getContentBody(body, regions);
    expect(contentBody).toBe("<main>Content</main>");
    expect(scaffolds).toHaveLength(0);
  });

  it("handles empty regions array", () => {
    const body = "<main>Content</main>";
    const { contentBody, scaffolds } = getContentBody(body, []);
    expect(contentBody).toBe(body);
    expect(scaffolds).toHaveLength(0);
  });
});

describe("getFixedBody", () => {
  it("strips pattern instances from content body", () => {
    const contentBody =
      '<main><div class="card">Card 1</div><p>Text</p><div class="card">Card 2</div></main>';
    const instances: PatternInstance[] = [
      {
        type: "card",
        selector: ".card",
        outerHtml: '<div class="card">Card 1</div>',
        hash: "c1",
      },
      {
        type: "card",
        selector: ".card",
        outerHtml: '<div class="card">Card 2</div>',
        hash: "c2",
      },
    ];
    const { fixedBody, patterns } = getFixedBody(contentBody, instances);
    expect(fixedBody).toBe(
      "<main><!-- pattern: card --><p>Text</p><!-- pattern: card --></main>"
    );
    expect(patterns).toHaveLength(2);
  });

  it("returns unchanged when no patterns", () => {
    const contentBody = "<main><p>Text</p></main>";
    const { fixedBody, patterns } = getFixedBody(contentBody, []);
    expect(fixedBody).toBe(contentBody);
    expect(patterns).toHaveLength(0);
  });
});

describe("decomposeHtml (backward compat)", () => {
  it("wraps getContentBody", () => {
    const body = "<header>H</header><main>M</main>";
    const regions: DetectedScaffoldRegion[] = [
      {
        type: "topMenu",
        selector: "header",
        outerHtml: "<header>H</header>",
        hash: "h",
      },
    ];
    const result = decomposeHtml(body, regions);
    expect(result.bodyHtml).toBe(body);
    expect(result.contentHtml).toBe("<!-- scaffold: topMenu --><main>M</main>");
    expect(result.regions).toHaveLength(1);
  });
});
