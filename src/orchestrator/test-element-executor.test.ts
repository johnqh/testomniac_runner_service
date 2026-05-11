import { describe, expect, it } from "vitest";
import { buildExpectationEvaluationGroups } from "./test-element-executor";

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
});
