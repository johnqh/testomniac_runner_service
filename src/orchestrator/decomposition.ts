import type { BrowserAdapter } from "../adapter";
import type { ApiClient } from "../api/client";
import type { DecompositionJobResponse } from "@sudobility/testomniac_types";
import type { ScanConfig, ScanEventHandler } from "./types";
import { generateTestCases } from "../generation/generator";

export async function processDecompositionJob(
  job: DecompositionJobResponse,
  _adapter: BrowserAdapter,
  config: ScanConfig,
  api: ApiClient,
  events: ScanEventHandler
): Promise<void> {
  const pageState = await api.getPageState(job.pageStateId);
  if (!pageState) {
    throw new Error(`Page state ${job.pageStateId} not found`);
  }

  const page = await api.getPage(pageState.pageId);
  if (!page) {
    throw new Error(`Page ${pageState.pageId} not found`);
  }

  // Generate test cases for this page state
  const generated = await generateTestCases({
    appId: config.appId,
    runId: config.scanId,
    sizeClass: config.sizeClass,
    api,
  });

  if (generated.length === 0) return;

  // Create a test suite for this decomposition job
  const suite = await api.insertTestSuite(config.appId, {
    title: `Page State #${job.pageStateId}`,
    description: `Auto-generated test suite for page state ${job.pageStateId}`,
    startingPageStateId: job.pageStateId,
    startingPath: page.relativePath,
    sizeClass: config.sizeClass,
    priority: 3,
    suite_tags: ["auto-generated"],
    decompositionJobId: job.id,
  });
  events.onTestSuiteCreated({ suiteId: suite.id, title: suite.title });

  // Insert test cases and link to suite
  for (const { testCase } of generated) {
    const tc = await api.insertTestCase(config.appId, testCase);
    for (const [index, step] of testCase.steps.entries()) {
      await api.createTestAction({
        testCaseId: tc.id,
        stepOrder: index,
        actionType: step.action.actionType,
        pageStateId: step.action.pageStateId,
        elementIdentityId: step.action.elementIdentityId,
        containerType: step.action.containerType,
        containerElementIdentityId: step.action.containerElementIdentityId,
        value: step.action.value,
        path: step.action.path,
        playwrightCode: step.action.playwrightCode,
        description: step.description,
        expectations: step.expectations,
        continueOnFailure: step.continueOnFailure,
      });
    }
  }
}
