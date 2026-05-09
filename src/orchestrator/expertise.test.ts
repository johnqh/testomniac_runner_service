import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createDefaultExpertises: vi.fn(() => [
    {
      name: "security",
      evaluate: () => [
        {
          expected: "No mixed content requests",
          observed: "HTTP asset detected",
          result: "warning" as const,
        },
      ],
    },
  ]),
}));

vi.mock("../expertise", () => ({
  createDefaultExpertises: mocks.createDefaultExpertises,
}));

vi.mock("../scanner/component-detector", () => ({
  detectScaffoldRegions: vi.fn(async () => []),
}));

vi.mock("../scanner/pattern-detector", () => ({
  detectPatternsWithInstances: vi.fn(async () => []),
}));

import { executePageExpertises } from "./expertise";

describe("executePageExpertises", () => {
  beforeEach(() => {
    mocks.createDefaultExpertises.mockClear();
  });

  it("persists buffered console and network logs into expertise test case runs", async () => {
    const adapter = {
      content: vi.fn(async () => "<html><body>Hello</body></html>"),
      getRuntimeArtifacts: vi.fn(() => ({
        consoleLogs: ["error: failed to load config"],
        networkLogs: [
          {
            method: "GET",
            url: "https://example.com/app.js",
            status: 404,
            contentType: "application/javascript",
          },
        ],
      })),
      resetRuntimeArtifacts: vi.fn(),
    } as any;

    const api = {
      getTestSuitesByRunner: vi.fn(async () => []),
      insertTestSuite: vi.fn(async () => ({
        id: 10,
        title: "Expertise: security",
      })),
      insertTestCase: vi.fn(async () => ({ id: 20 })),
      createTestCaseRun: vi.fn(async () => ({ id: 30 })),
      createTestRun: vi.fn(async () => ({ id: 40 })),
      createTestRunFinding: vi.fn(async () => ({ id: 50 })),
      completeTestCaseRun: vi.fn(async () => undefined),
      completeTestRun: vi.fn(async () => undefined),
    } as any;

    const events = {
      onTestSuiteCreated: vi.fn(),
      onFindingCreated: vi.fn(),
      onTestRunCompleted: vi.fn(),
    } as any;

    await executePageExpertises(
      adapter,
      {
        runnerId: 1,
        scanId: 99,
        runnerInstanceId: "runner-1",
        runnerInstanceName: "runner-1",
        testEnvironmentId: 7,
        sizeClass: "desktop",
      } as any,
      api,
      events,
      200,
      300,
      "/settings"
    );

    expect(api.completeTestCaseRun).toHaveBeenCalledWith(
      30,
      expect.objectContaining({
        consoleLog: "error: failed to load config",
        networkLog: expect.stringContaining('"status":404'),
      })
    );
    expect(adapter.resetRuntimeArtifacts).toHaveBeenCalledTimes(1);
    expect(api.createTestRunFinding).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "[security] No mixed content requests",
      })
    );
  });
});
