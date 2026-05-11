import { describe, expect, it } from "vitest";
import {
  checkLoadingCompletes,
  checkMediaLoaded,
  checkModalOpened,
  checkPageResponsive,
  checkVideoPlayable,
} from "./page-behavior-checks";
import type { ExpertiseContext } from "../types";
import type { UiSnapshot } from "../../browser/ui-snapshot";

function createContext(
  overrides: Partial<ExpertiseContext> = {}
): ExpertiseContext {
  const uiSnapshot: UiSnapshot = {
    activeElementSelector: "body",
    dialogCount: 0,
    toastCount: 0,
    feedbackTexts: [],
  };
  return {
    html: "<main>Loaded content</main>",
    initialHtml: "<main>Initial content</main>",
    scaffolds: [],
    patterns: [],
    consoleLogs: [],
    networkLogs: [],
    expectations: [],
    initialUrl: "https://example.com/products",
    currentUrl: "https://example.com/products",
    startingPath: "/products",
    initialUiSnapshot: uiSnapshot,
    finalUiSnapshot: uiSnapshot,
    initialControlStates: [],
    finalControlStates: [],
    ...overrides,
  };
}

describe("page-behavior checks", () => {
  it("fails when loading markers remain after interaction", () => {
    const result = checkLoadingCompletes(
      { description: "Loading should finish" },
      createContext({ html: "<main>Adding to Cart...</main>" })
    );

    expect(result.result).toBe("error");
  });

  it("passes when modal signals increase", () => {
    const result = checkModalOpened(
      { description: "Media should open a modal" },
      createContext({
        initialHtml: "<main>Gallery</main>",
        html: '<main><div role="dialog" aria-modal="true">Viewer</div></main>',
      })
    );

    expect(result.result).toBe("pass");
  });

  it("fails on media request errors", () => {
    const result = checkMediaLoaded(
      { description: "Media should load" },
      createContext({
        networkLogs: [
          {
            method: "GET",
            url: "https://example.com/image.jpg",
            status: 404,
            contentType: "image/jpeg",
          },
        ],
      })
    );

    expect(result.result).toBe("error");
  });

  it("fails when video fallback text is shown", () => {
    const result = checkVideoPlayable(
      { description: "Video should play" },
      createContext({
        html: "<main>Your browser does not support the video tag.</main>",
      })
    );

    expect(result.result).toBe("error");
  });

  it("passes when the page remains responsive", () => {
    const result = checkPageResponsive(
      { description: "Page should remain responsive" },
      createContext()
    );

    expect(result.result).toBe("pass");
  });
});
