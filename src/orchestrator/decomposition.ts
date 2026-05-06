import type { BrowserAdapter } from "../adapter";
import type { ApiClient } from "../api/client";
import type { DecompositionJobResponse } from "@sudobility/testomniac_types";
import type { ScanConfig, ScanEventHandler } from "./types";
import { extractActionableItems } from "../extractors";
import {
  PlaywrightAction,
  ExpectationType,
  ExpectationSeverity,
} from "../domain/types";
import type { TestCase, TestStep } from "../domain/types";

const LOG = (...args: unknown[]) => console.log("[decomposition]", ...args);

/**
 * Process a decomposition job: extract actionable items from the live page
 * and generate click/hover test cases. Returns created test case IDs.
 */
export async function processDecompositionJob(
  job: DecompositionJobResponse,
  adapter: BrowserAdapter,
  config: ScanConfig,
  api: ApiClient,
  events: ScanEventHandler
): Promise<number[]> {
  LOG(`Processing job ${job.id} for pageState ${job.pageStateId}`);

  const pageState = await api.getPageState(job.pageStateId);
  if (!pageState) {
    throw new Error(`Page state ${job.pageStateId} not found`);
  }
  LOG(`Page state found: pageId=${pageState.pageId}`);

  const page = await api.getPage(pageState.pageId);
  if (!page) {
    throw new Error(`Page ${pageState.pageId} not found`);
  }
  LOG(`Page found: relativePath=${page.relativePath}`);

  // Extract actionable items from the live page
  const items = await extractActionableItems(adapter);
  LOG(
    `Extracted ${items.length} actionable items:`,
    items.map(i => ({
      selector: i.selector?.slice(0, 60),
      actionKind: i.actionKind,
      tagName: i.tagName,
      role: i.role,
      accessibleName: i.accessibleName?.slice(0, 40),
      visible: i.visible,
      disabled: i.disabled,
    }))
  );

  // Filter to visible, enabled, interactive items
  const interactiveItems = items.filter(
    i => i.visible && !i.disabled && i.selector
  );
  LOG(
    `${interactiveItems.length} items after filtering (visible, enabled, has selector)`
  );

  if (interactiveItems.length === 0) {
    LOG("No interactive items found — skipping decomposition");
    return [];
  }

  // Create a test suite for this decomposition job
  const suite = await api.insertTestSuite(config.runnerId, {
    title: `Page State #${job.pageStateId}`,
    description: `Auto-generated test suite for page state ${job.pageStateId} on ${page.relativePath}`,
    startingPageStateId: job.pageStateId,
    startingPath: page.relativePath,
    sizeClass: config.sizeClass,
    priority: 3,
    suite_tags: ["auto-generated"],
    decompositionJobId: job.id,
  });
  LOG(`Created test suite: id=${suite.id}, title=${suite.title}`);
  events.onTestSuiteCreated({ suiteId: suite.id, title: suite.title });

  // Generate one test case per actionable item (cap at 20 to avoid explosion)
  const maxItems = Math.min(interactiveItems.length, 20);
  const createdIds: number[] = [];

  for (let i = 0; i < maxItems; i++) {
    const item = interactiveItems[i];
    const actionKind = item.actionKind || "click";
    const label =
      item.accessibleName ||
      item.tagName ||
      item.selector?.slice(0, 30) ||
      "element";

    // Determine test action type
    let actionType: string;
    if (actionKind === "navigate" || actionKind === "click") {
      actionType = "click";
    } else if (actionKind === "fill") {
      actionType = "fill";
    } else if (actionKind === "select") {
      actionType = "select";
    } else {
      actionType = "click";
    }

    const steps: TestStep[] = [
      {
        action: {
          actionType: PlaywrightAction.Click,
          pageStateId: pageState.id,
          path: item.selector!,
          playwrightCode: `await page.click('${item.selector!.replace(/'/g, "\\'")}');`,
          description: `${actionType} on ${label}`,
        },
        expectations: [
          {
            expectationType: ExpectationType.NoConsoleErrors,
            severity: ExpectationSeverity.ShouldPass,
            description: "No console errors after interaction",
            playwrightCode: "expect(consoleErrors).toHaveLength(0);",
          },
        ],
        description: `${actionType} on ${label}`,
        continueOnFailure: false,
      },
    ];

    const testCase: TestCase = {
      title: `${actionType}: ${label}`,
      type: "interaction",
      sizeClass: config.sizeClass,
      suite_tags: ["auto-generated", "mouse-scanning"],
      page_id: page.id,
      priority: 3,
      startingPageStateId: pageState.id,
      startingPath: page.relativePath,
      steps,
      globalExpectations: [],
    };

    LOG(
      `Creating test case ${i + 1}/${maxItems}: "${testCase.title}" selector=${item.selector?.slice(0, 60)}`
    );

    const tc = await api.insertTestCase(config.runnerId, testCase);
    createdIds.push(tc.id);

    // Create test actions for each step
    for (const [index, step] of steps.entries()) {
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

  LOG(`Decomposition complete: created ${createdIds.length} test cases`);
  return createdIds;
}
