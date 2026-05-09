import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  extractActionableItems: vi.fn(async () => []),
  executePageExpertises: vi.fn(async () => {}),
}));

vi.mock("../extractors", () => ({
  extractActionableItems: mocks.extractActionableItems,
}));

vi.mock("./expertise", () => ({
  executePageExpertises: mocks.executePageExpertises,
}));

import { captureCurrentPage, resetCapturedPagePaths } from "./page-capture";

describe("page-capture", () => {
  beforeEach(() => {
    resetCapturedPagePaths();
    mocks.extractActionableItems.mockClear();
    mocks.executePageExpertises.mockClear();
  });

  it("creates new same-path page states when the DOM signature changes", async () => {
    let html = "<html><body><button>Open</button></body></html>";
    let createdStateId = 100;

    const adapter = {
      getUrl: vi.fn(async () => "https://example.com/settings"),
      content: vi.fn(async () => html),
    } as any;

    const api = {
      findOrCreatePage: vi.fn(async () => ({ id: 1 })),
      findMatchingPageState: vi.fn(async () => null),
      createPageState: vi.fn(async () => ({ id: createdStateId++ })),
      createDiscoveredPages: vi.fn(async () => []),
      createPageVisit: vi.fn(async () => ({ id: 1 })),
      createDecompositionJob: vi.fn(
        async (_scanId: number, pageStateId: number) => ({
          id: pageStateId + 1000,
        })
      ),
    } as any;

    const events = {
      onPageFound: vi.fn(),
      onPageStateCreated: vi.fn(),
      onDecompositionJobCreated: vi.fn(),
    } as any;

    const config = {
      runnerId: 1,
      scanId: 22,
      sizeClass: "desktop",
      baseUrl: "https://example.com",
      testEnvironmentId: 7,
    } as any;

    const firstCapture = await captureCurrentPage(
      adapter,
      config,
      api,
      events,
      {
        testRunId: 22,
        markDiscovered: true,
        createDecompositionJob: true,
      }
    );

    html =
      "<html><body><button aria-expanded='true'>Open</button><div role='dialog'>Panel</div></body></html>";

    const secondCapture = await captureCurrentPage(
      adapter,
      config,
      api,
      events,
      {
        testRunId: 22,
        markDiscovered: true,
        createDecompositionJob: true,
      }
    );

    expect(firstCapture?.createdNewState).toBe(true);
    expect(secondCapture?.createdNewState).toBe(true);
    expect(firstCapture?.pageStateId).not.toBe(secondCapture?.pageStateId);
    expect(events.onPageFound).toHaveBeenCalledTimes(1);
    expect(api.createDiscoveredPages).toHaveBeenCalledTimes(1);
    expect(api.createPageVisit).toHaveBeenCalledTimes(2);
    expect(api.createPageState).toHaveBeenCalledTimes(2);
    expect(api.createDecompositionJob).toHaveBeenCalledTimes(2);
  });

  it("skips duplicate captures when the same-path DOM signature repeats", async () => {
    const html = "<html><body><button>Open</button></body></html>";

    const adapter = {
      getUrl: vi.fn(async () => "https://example.com/settings"),
      content: vi.fn(async () => html),
    } as any;

    const api = {
      findOrCreatePage: vi.fn(async () => ({ id: 1 })),
      findMatchingPageState: vi.fn(async () => null),
      createPageState: vi.fn(async () => ({ id: 101 })),
      createDiscoveredPages: vi.fn(async () => []),
      createPageVisit: vi.fn(async () => ({ id: 1 })),
    } as any;

    const events = {
      onPageFound: vi.fn(),
      onPageStateCreated: vi.fn(),
      onDecompositionJobCreated: vi.fn(),
    } as any;

    const config = {
      runnerId: 1,
      scanId: 22,
      sizeClass: "desktop",
      baseUrl: "https://example.com",
      testEnvironmentId: 7,
    } as any;

    const firstCapture = await captureCurrentPage(
      adapter,
      config,
      api,
      events,
      {
        testRunId: 22,
        markDiscovered: true,
      }
    );

    const secondCapture = await captureCurrentPage(
      adapter,
      config,
      api,
      events,
      {
        testRunId: 22,
        markDiscovered: false,
      }
    );

    expect(firstCapture?.createdNewState).toBe(true);
    expect(secondCapture?.createdNewState).toBe(false);
    expect(api.createPageState).toHaveBeenCalledTimes(1);
    expect(mocks.executePageExpertises).toHaveBeenCalledTimes(1);
  });
});
