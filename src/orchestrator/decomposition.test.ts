import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  extractActionableItems: vi.fn(async () => []),
  detectScaffoldRegions: vi.fn(async () => []),
  detectPatternsWithInstances: vi.fn(async () => []),
}));

vi.mock("../extractors", () => ({
  extractActionableItems: mocks.extractActionableItems,
}));

vi.mock("../scanner/component-detector", async () => {
  const actual = await vi.importActual("../scanner/component-detector");
  return {
    ...(actual as object),
    detectScaffoldRegions: mocks.detectScaffoldRegions,
  };
});

vi.mock("../scanner/pattern-detector", () => ({
  detectPatternsWithInstances: mocks.detectPatternsWithInstances,
}));

import { processDecompositionJob } from "./decomposition";

describe("processDecompositionJob", () => {
  beforeEach(() => {
    mocks.extractActionableItems.mockReset();
    mocks.detectScaffoldRegions.mockReset();
    mocks.detectPatternsWithInstances.mockReset();
  });

  it("does not regenerate duplicate shared scaffold cases", async () => {
    mocks.extractActionableItems.mockResolvedValue([
      {
        stableKey: "menu-button",
        selector: "#menu-button",
        tagName: "button",
        role: "button",
        actionKind: "click",
        accessibleName: "Menu",
        textContent: "Menu",
        disabled: false,
        visible: true,
        attributes: {
          "aria-haspopup": "menu",
          "aria-expanded": "false",
        },
      },
    ]);
    mocks.detectScaffoldRegions.mockResolvedValue([
      {
        type: "header",
        selector: "header",
        hash: "header-hash",
        outerHtml: "<header><button id='menu-button'>Menu</button></header>",
      },
    ]);
    mocks.detectPatternsWithInstances.mockResolvedValue([]);

    const adapter = {
      getUrl: vi.fn(async () => "https://example.com/home"),
      goto: vi.fn(async () => undefined),
      content: vi.fn(
        async () =>
          "<html><body><header><button id='menu-button'>Menu</button></header></body></html>"
      ),
      evaluate: vi.fn(async (...args: unknown[]) => {
        const firstArg = args[0];
        if (typeof firstArg === "function") {
          return [77];
        }
        return null;
      }),
    } as any;

    const api = {
      getPageState: vi.fn(async () => ({
        id: 10,
        pageId: 100,
        sizeClass: "desktop",
      })),
      getPage: vi.fn(async () => ({ id: 100, relativePath: "/home" })),
      findOrCreateScaffold: vi.fn(async () => ({ id: 77 })),
      linkPageStateScaffolds: vi.fn(async () => undefined),
      findMatchingPageStateDecomposed: vi.fn(async () => null),
      updatePageStateDecomposedHashes: vi.fn(async () => undefined),
      insertPageStatePatterns: vi.fn(async () => undefined),
      getTestSuitesByRunner: vi.fn(async () => [
        { id: 501, scaffoldId: 77, title: "Shared Scaffold: header" },
      ]),
      getTestCasesByRunner: vi.fn(async () => [
        { id: 601, scaffoldId: 77, title: "click: Menu" },
        { id: 602, scaffoldId: 77, title: "state chain: Menu" },
      ]),
      insertTestSuite: vi.fn(async () => ({ id: 999, title: "unused" })),
      insertTestCase: vi.fn(async () => ({ id: 700 })),
      createTestAction: vi.fn(async () => undefined),
    } as any;

    const created = await processDecompositionJob(
      { id: 1, pageStateId: 10 } as any,
      adapter,
      {
        runnerId: 1,
        sizeClass: "desktop",
        baseUrl: "https://example.com",
      } as any,
      api,
      {
        onTestSuiteCreated: vi.fn(),
      } as any
    );

    expect(created).toEqual([]);
    expect(api.insertTestSuite).not.toHaveBeenCalled();
    expect(api.insertTestCase).not.toHaveBeenCalled();
    expect(api.createTestAction).not.toHaveBeenCalled();
  });

  it("creates multi-step state chains for expandable controls", async () => {
    mocks.extractActionableItems.mockResolvedValue([
      {
        stableKey: "faq-toggle",
        selector: "#faq-toggle",
        tagName: "button",
        role: "button",
        actionKind: "click",
        accessibleName: "FAQ",
        textContent: "Open FAQ",
        disabled: false,
        visible: true,
        attributes: {
          "aria-expanded": "false",
          "aria-controls": "faq-panel",
        },
      },
    ]);
    mocks.detectScaffoldRegions.mockResolvedValue([]);
    mocks.detectPatternsWithInstances.mockResolvedValue([]);

    const adapter = {
      getUrl: vi.fn(async () => "https://example.com/help"),
      goto: vi.fn(async () => undefined),
      content: vi.fn(
        async () =>
          "<html><body><button id='faq-toggle' aria-expanded='false'>Open FAQ</button></body></html>"
      ),
      evaluate: vi.fn(async () => null),
    } as any;

    const api = {
      getPageState: vi.fn(async () => ({
        id: 10,
        pageId: 100,
        sizeClass: "desktop",
      })),
      getPage: vi.fn(async () => ({ id: 100, relativePath: "/help" })),
      findMatchingPageStateDecomposed: vi.fn(async () => null),
      updatePageStateDecomposedHashes: vi.fn(async () => undefined),
      insertPageStatePatterns: vi.fn(async () => undefined),
      getTestSuitesByRunner: vi.fn(async () => []),
      getTestCasesByRunner: vi.fn(async () => []),
      insertTestSuite: vi.fn(async () => ({
        id: 501,
        title: "Page State #10",
      })),
      insertTestCase: vi.fn(async () => ({ id: 601 })),
      createTestAction: vi.fn(async () => undefined),
    } as any;

    const created = await processDecompositionJob(
      { id: 2, pageStateId: 10 } as any,
      adapter,
      {
        runnerId: 1,
        sizeClass: "desktop",
        baseUrl: "https://example.com",
      } as any,
      api,
      {
        onTestSuiteCreated: vi.fn(),
      } as any
    );

    expect(created).toEqual([601, 601]);
    expect(api.insertTestCase).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        title: "state chain: FAQ",
      }),
      501
    );
    expect(api.createTestAction).toHaveBeenCalledTimes(3);
    expect(api.createTestAction).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        description: "open FAQ",
        actionType: "click",
      })
    );
    expect(api.createTestAction).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        description: "close FAQ",
        actionType: "click",
      })
    );
  });

  it("uses an explicit close control when a trigger opens a controlled region", async () => {
    mocks.extractActionableItems.mockResolvedValue([
      {
        stableKey: "dialog-open",
        selector: "#dialog-open",
        tagName: "button",
        role: "button",
        actionKind: "click",
        accessibleName: "Open dialog",
        textContent: "Open dialog",
        disabled: false,
        visible: true,
        attributes: {
          "aria-controls": "dialog-panel",
          "aria-expanded": "false",
        },
      },
      {
        stableKey: "dialog-close",
        selector: "#dialog-close",
        tagName: "button",
        role: "button",
        actionKind: "click",
        accessibleName: "Close dialog",
        textContent: "Close",
        disabled: false,
        visible: true,
        attributes: {},
      },
    ]);
    mocks.detectScaffoldRegions.mockResolvedValue([]);
    mocks.detectPatternsWithInstances.mockResolvedValue([]);

    const adapter = {
      getUrl: vi.fn(async () => "https://example.com/dialog"),
      goto: vi.fn(async () => undefined),
      content: vi.fn(
        async () =>
          "<html><body><button id='dialog-open' aria-controls='dialog-panel'>Open dialog</button><div id='dialog-panel'><button id='dialog-close'>Close</button></div></body></html>"
      ),
      evaluate: vi.fn(async (...args: unknown[]) => {
        if (typeof args[2] === "string" && Array.isArray(args[3])) {
          return "#dialog-close";
        }
        if (Array.isArray(args[1])) {
          return [];
        }
        return null;
      }),
    } as any;

    const api = {
      getPageState: vi.fn(async () => ({
        id: 11,
        pageId: 101,
        sizeClass: "desktop",
      })),
      getPage: vi.fn(async () => ({ id: 101, relativePath: "/dialog" })),
      findMatchingPageStateDecomposed: vi.fn(async () => null),
      updatePageStateDecomposedHashes: vi.fn(async () => undefined),
      insertPageStatePatterns: vi.fn(async () => undefined),
      getTestSuitesByRunner: vi.fn(async () => []),
      getTestCasesByRunner: vi.fn(async () => []),
      insertTestSuite: vi.fn(async () => ({
        id: 510,
        title: "Page State #11",
      })),
      insertTestCase: vi.fn(async () => ({ id: 610 })),
      createTestAction: vi.fn(async () => undefined),
    } as any;

    await processDecompositionJob(
      { id: 3, pageStateId: 11 } as any,
      adapter,
      {
        runnerId: 1,
        sizeClass: "desktop",
        baseUrl: "https://example.com",
      } as any,
      api,
      {
        onTestSuiteCreated: vi.fn(),
      } as any
    );

    expect(api.createTestAction).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        path: "#dialog-close",
        description: "close Open dialog",
      })
    );
  });

  it("groups tabs by container before generating tab chains", async () => {
    mocks.extractActionableItems.mockResolvedValue([
      {
        stableKey: "tab-a1",
        selector: "#tab-a1",
        tagName: "button",
        role: "tab",
        actionKind: "click",
        accessibleName: "Overview",
        textContent: "Overview",
        disabled: false,
        visible: true,
        attributes: { "aria-selected": "true" },
      },
      {
        stableKey: "tab-b1",
        selector: "#tab-b1",
        tagName: "button",
        role: "tab",
        actionKind: "click",
        accessibleName: "Users",
        textContent: "Users",
        disabled: false,
        visible: true,
        attributes: { "aria-selected": "true" },
      },
      {
        stableKey: "tab-a2",
        selector: "#tab-a2",
        tagName: "button",
        role: "tab",
        actionKind: "click",
        accessibleName: "Billing",
        textContent: "Billing",
        disabled: false,
        visible: true,
        attributes: { "aria-selected": "false" },
      },
      {
        stableKey: "tab-b2",
        selector: "#tab-b2",
        tagName: "button",
        role: "tab",
        actionKind: "click",
        accessibleName: "Roles",
        textContent: "Roles",
        disabled: false,
        visible: true,
        attributes: { "aria-selected": "false" },
      },
    ]);
    mocks.detectScaffoldRegions.mockResolvedValue([]);
    mocks.detectPatternsWithInstances.mockResolvedValue([]);

    const insertTitles: string[] = [];
    const adapter = {
      getUrl: vi.fn(async () => "https://example.com/tabs"),
      goto: vi.fn(async () => undefined),
      content: vi.fn(async () => "<html><body>tabs</body></html>"),
      evaluate: vi.fn(async (...args: unknown[]) => {
        if (Array.isArray(args[1])) {
          return [
            { selector: "#tab-a1", groupKey: "group-a", order: 0 },
            { selector: "#tab-b1", groupKey: "group-b", order: 0 },
            { selector: "#tab-a2", groupKey: "group-a", order: 1 },
            { selector: "#tab-b2", groupKey: "group-b", order: 1 },
          ];
        }
        return null;
      }),
    } as any;

    const api = {
      getPageState: vi.fn(async () => ({
        id: 12,
        pageId: 102,
        sizeClass: "desktop",
      })),
      getPage: vi.fn(async () => ({ id: 102, relativePath: "/tabs" })),
      findMatchingPageStateDecomposed: vi.fn(async () => null),
      updatePageStateDecomposedHashes: vi.fn(async () => undefined),
      insertPageStatePatterns: vi.fn(async () => undefined),
      getTestSuitesByRunner: vi.fn(async () => []),
      getTestCasesByRunner: vi.fn(async () => []),
      insertTestSuite: vi.fn(async () => ({
        id: 520,
        title: "Page State #12",
      })),
      insertTestCase: vi.fn(
        async (_runnerId: number, testCase: { title: string }) => {
          insertTitles.push(testCase.title);
          return { id: 620 + insertTitles.length };
        }
      ),
      createTestAction: vi.fn(async () => undefined),
    } as any;

    await processDecompositionJob(
      { id: 4, pageStateId: 12 } as any,
      adapter,
      {
        runnerId: 1,
        sizeClass: "desktop",
        baseUrl: "https://example.com",
      } as any,
      api,
      {
        onTestSuiteCreated: vi.fn(),
      } as any
    );

    expect(insertTitles).toContain("tab chain: Overview -> Billing");
    expect(insertTitles).toContain("tab chain: Users -> Roles");
    expect(insertTitles).not.toContain("tab chain: Overview -> Users");
  });
});
