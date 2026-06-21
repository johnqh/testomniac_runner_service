import { describe, expect, it, vi } from "vitest";
import {
  buildExpectationEvaluationGroups,
  emitLiveScreenshot,
  interactionNeedsStepSnapshots,
  readPageHtml,
} from "./test-interaction-executor";

describe("emitLiveScreenshot", () => {
  it("reuses pre-captured bytes instead of calling adapter.screenshot", async () => {
    const screenshot = vi.fn();
    const adapter = { screenshot, url: () => "http://x" } as any;
    const events = { onScreenshotCaptured: vi.fn() } as any;
    const bytes = new Uint8Array([1, 2, 3]);

    await emitLiveScreenshot(adapter, events, "http://x", bytes);

    expect(screenshot).not.toHaveBeenCalled();
    expect(events.onScreenshotCaptured).toHaveBeenCalledWith(
      expect.objectContaining({ pageUrl: "http://x" })
    );
  });

  it("captures itself when no bytes are provided", async () => {
    const screenshot = vi.fn().mockResolvedValue(new Uint8Array([4, 5, 6]));
    const adapter = { screenshot, url: () => "http://x" } as any;
    const events = { onScreenshotCaptured: vi.fn() } as any;

    await emitLiveScreenshot(adapter, events, "http://x");

    expect(screenshot).toHaveBeenCalledTimes(1);
  });
});

describe("interactionNeedsStepSnapshots", () => {
  it("is false when no step has expectations", () => {
    expect(interactionNeedsStepSnapshots([{ expectations: [] }, {}])).toBe(
      false
    );
  });
  it("is true when any step has an expectation", () => {
    expect(
      interactionNeedsStepSnapshots([
        { expectations: [] },
        { expectations: [{ x: 1 }] },
      ])
    ).toBe(true);
  });
});

describe("readPageHtml", () => {
  it("uses capturePageSnapshot when the adapter implements it", async () => {
    const adapter = {
      capturePageSnapshot: async () => ({
        html: "<batched>",
        bodyTextLength: 5,
      }),
      content: async () => "<fallback>",
    } as any;
    expect(await readPageHtml(adapter)).toBe("<batched>");
  });
  it("falls back to content() when capturePageSnapshot is absent", async () => {
    const adapter = { content: async () => "<fallback>" } as any;
    expect(await readPageHtml(adapter)).toBe("<fallback>");
  });
});

describe("buildExpectationEvaluationGroups", () => {
  it("uses per-step snapshots for step expectations and final snapshots for generated expectations", () => {
    const groups = buildExpectationEvaluationGroups({
      stepExecutions: [
        {
          step: {
            action: {
              actionType: "type",
              path: "#email",
              value: "user@example.com",
              playwrightCode: "",
              description: "Fill email",
            },
            expectations: [
              {
                expectationType: "input_value",
                targetPath: "#email",
                expectedValue: "user@example.com",
                severity: "must_pass",
                description: "Email field should contain typed value",
                playwrightCode: "",
              },
            ],
            description: "Fill email",
            continueOnFailure: false,
          },
          startedAtMs: 1000,
          endedAtMs: 1100,
          beforeSnapshot: {
            html: '<input id="email" value="">',
            url: "https://example.com/form",
            uiSnapshot: {
              dialogCount: 0,
              toastCount: 0,
              feedbackTexts: [],
            },
            controlStates: [],
          },
          afterSnapshot: {
            html: '<input id="email" value="user@example.com">',
            url: "https://example.com/form",
            uiSnapshot: {
              dialogCount: 0,
              toastCount: 0,
              feedbackTexts: [],
            },
            controlStates: [],
          },
        },
      ],
      generatedExpectations: [
        {
          expectationType: "form_submitted_successfully",
          severity: "must_pass",
          description: "Form should submit successfully",
          playwrightCode: "",
        },
      ],
      networkLogs: [
        {
          method: "POST",
          url: "https://example.com/api/submit",
          status: 200,
          contentType: "application/json",
          timestampMs: 1150,
        },
      ],
      initialSnapshot: {
        html: '<form><input id="email" value=""></form>',
        url: "https://example.com/form",
        uiSnapshot: {
          dialogCount: 0,
          toastCount: 0,
          feedbackTexts: [],
        },
        controlStates: [],
      },
      finalSnapshot: {
        html: "<div>Thanks for submitting</div>",
        url: "https://example.com/thanks",
        uiSnapshot: {
          dialogCount: 0,
          toastCount: 1,
          feedbackTexts: ["Thanks for submitting"],
        },
        controlStates: [],
      },
    });

    expect(groups).toHaveLength(2);

    expect(groups[0]?.previousSnapshot.html).toBe(
      '<input id="email" value="">'
    );
    expect(groups[0]?.snapshot.html).toBe(
      '<input id="email" value="user@example.com">'
    );
    expect(groups[1]?.previousSnapshot.html).toBe(
      '<form><input id="email" value=""></form>'
    );
    expect(groups[1]?.snapshot.html).toBe("<div>Thanks for submitting</div>");
  });

  it("normalizes malformed snapshots and missing generated expectations", () => {
    const groups = buildExpectationEvaluationGroups({
      stepExecutions: [
        {
          step: {
            action: {
              actionType: "click",
              path: "#submit",
              playwrightCode: "",
              description: "Submit",
            },
            expectations: [
              {
                expectationType: "page_loaded",
                severity: "must_pass",
                description: "Page should load",
                playwrightCode: "",
              },
            ],
            description: "Submit",
            continueOnFailure: false,
          },
          startedAtMs: 1000,
          endedAtMs: 1100,
          beforeSnapshot: {
            html: null as unknown as string,
            url: null as unknown as string,
            uiSnapshot: {
              dialogCount: 0,
              toastCount: 0,
              feedbackTexts: [],
            },
            controlStates: null as unknown as [],
          },
          afterSnapshot: {
            html: null as unknown as string,
            url: "https://example.com/result",
            uiSnapshot: {
              dialogCount: 0,
              toastCount: 0,
              feedbackTexts: [],
            },
            controlStates: null as unknown as [],
          },
        },
      ],
      generatedExpectations: null as unknown as [],
      networkLogs: [],
      initialSnapshot: {
        html: null as unknown as string,
        url: null as unknown as string,
        uiSnapshot: {
          dialogCount: 0,
          toastCount: 0,
          feedbackTexts: [],
        },
        controlStates: null as unknown as [],
      },
      finalSnapshot: {
        html: null as unknown as string,
        url: null as unknown as string,
        uiSnapshot: {
          dialogCount: 0,
          toastCount: 0,
          feedbackTexts: [],
        },
        controlStates: null as unknown as [],
      },
    });

    expect(groups).toHaveLength(1);
    expect(groups[0]?.previousSnapshot.html).toBe("");
    expect(groups[0]?.previousSnapshot.url).toBe("");
    expect(groups[0]?.previousSnapshot.controlStates).toEqual([]);
    expect(groups[0]?.snapshot.html).toBe("");
  });
});
