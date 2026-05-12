import { describe, expect, it } from "vitest";
import type {
  TestInteractionResponse,
  TestInteractionRunResponse,
} from "@sudobility/testomniac_types";
import { selectNextOpenTestInteractionRun } from "./runner";

function makeInteraction(
  id: number,
  overrides: Partial<TestInteractionResponse> = {}
): TestInteractionResponse {
  return {
    id,
    runnerId: 1,
    testSurfaceId: 1,
    title: `Interaction ${id}`,
    testType: "interaction",
    sizeClass: "desktop",
    surfaceTags: ["interaction"],
    priority: 3,
    scaffoldId: null,
    patternType: null,
    dependencyTestInteractionId: null,
    pageId: null,
    targetPageId: null,
    testEnvironmentId: null,
    personaId: null,
    useCaseId: null,
    startingPageStateId: null,
    startingPath: "/",
    stepsJson: null,
    globalExpectationsJson: null,
    estimatedDurationMs: null,
    uid: null,
    generatedKey: null,
    isActive: true,
    isGenerated: true,
    generatedAt: null,
    ...overrides,
  } as TestInteractionResponse;
}

function makeRun(
  id: number,
  testInteractionId: number
): TestInteractionRunResponse {
  return {
    id,
    testInteractionId,
    testSurfaceRunId: 10,
    status: "pending",
    durationMs: null,
    errorMessage: null,
    screenshotPath: null,
    consoleLog: null,
    networkLog: null,
    startedAt: null,
    completedAt: null,
    createdAt: null,
    expectedOutcome: null,
    observedOutcome: null,
    testEnvironmentId: null,
  } as TestInteractionRunResponse;
}

describe("selectNextOpenTestInteractionRun", () => {
  it("prefers hover interactions before non-hover siblings", () => {
    const hover = makeInteraction(11, {
      title: "Hover over Menu",
      surfaceTags: ["interaction", "hover"],
      priority: 4,
    });
    const click = makeInteraction(12, {
      title: "Click Menu",
      surfaceTags: ["interaction", "click"],
      priority: 3,
    });

    const selected = selectNextOpenTestInteractionRun(
      [makeRun(100, click.id), makeRun(101, hover.id)],
      [hover, click],
      []
    );

    expect(selected.testInteractionId).toBe(hover.id);
  });

  it("prefers hover children on the active dependency branch", () => {
    const parent = makeInteraction(20, { title: "Navigate to /" });
    const hoverChild = makeInteraction(21, {
      title: "Hover over Header menu",
      surfaceTags: ["interaction", "hover"],
      priority: 4,
      dependencyTestInteractionId: parent.id,
    });
    const clickChild = makeInteraction(22, {
      title: "Click Hero CTA",
      surfaceTags: ["interaction", "click"],
      priority: 3,
      dependencyTestInteractionId: parent.id,
    });
    const unrelated = makeInteraction(23, {
      title: "Fill Search",
      surfaceTags: ["interaction", "fill"],
      priority: 2,
    });

    const selected = selectNextOpenTestInteractionRun(
      [
        makeRun(201, clickChild.id),
        makeRun(202, unrelated.id),
        makeRun(203, hoverChild.id),
      ],
      [parent, hoverChild, clickChild, unrelated],
      [parent.id]
    );

    expect(selected.testInteractionId).toBe(hoverChild.id);
  });
});
