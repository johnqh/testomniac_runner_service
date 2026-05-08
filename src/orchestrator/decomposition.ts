import type { BrowserAdapter } from "../adapter";
import type { ApiClient } from "../api/client";
import type {
  ActionableItem,
  HtmlComponentType,
} from "@sudobility/testomniac_types";
import type { DecompositionJobResponse } from "@sudobility/testomniac_types";
import type { ScanConfig, ScanEventHandler } from "./types";
import { extractActionableItems } from "../extractors";
import { computeDecomposedHashes } from "../browser/page-utils";
import {
  detectScaffoldRegions,
  type DetectedScaffoldRegion,
} from "../scanner/component-detector";
import {
  getBody,
  getContentBody,
  getFixedBody,
} from "../scanner/html-decomposer";
import { detectPatternsWithInstances } from "../scanner/pattern-detector";
import { toRelativePath } from "../crawler/url-normalizer";
import {
  PlaywrightAction,
  ExpectationType,
  ExpectationSeverity,
} from "../domain/types";
import type { TestCase, TestStep } from "../domain/types";

const LOG = (...args: unknown[]) => console.warn("[decomposition]", ...args);

interface PersistedScaffoldRegion extends DetectedScaffoldRegion {
  scaffoldId: number;
}

interface GeneratedTestCaseDefinition {
  title: string;
  actionType: string;
  item: ActionableItem;
  steps: TestStep[];
}

function inferFillValue(item: ActionableItem): string {
  const inputType = (item.inputType || "").toLowerCase();
  const label =
    `${item.accessibleName || ""} ${item.textContent || ""}`.toLowerCase();

  if (inputType === "email" || label.includes("email")) {
    return "testomniac@example.com";
  }
  if (inputType === "tel" || label.includes("phone")) {
    return "4155550100";
  }
  if (inputType === "number") {
    return "1";
  }
  if (inputType === "search" || label.includes("search")) {
    return "test";
  }
  if (
    inputType === "url" ||
    label.includes("url") ||
    label.includes("website")
  ) {
    return "https://example.com";
  }
  if (inputType === "password") {
    return "Testomniac123!";
  }

  return "Testomniac";
}

async function resolveSelectValue(
  adapter: BrowserAdapter,
  selector: string
): Promise<string | null> {
  return adapter.evaluate((...args: unknown[]) => {
    const targetSelector = args[0] as string;

    try {
      const select = document.querySelector(targetSelector);
      if (!(select instanceof HTMLSelectElement)) {
        return null;
      }

      const options = Array.from(select.options).filter(
        option => !option.disabled
      );
      const preferred =
        options.find(option => option.value && option.value !== select.value) ||
        options.find(option => option.value) ||
        options.find(option => option.textContent?.trim());

      return preferred?.value || null;
    } catch {
      return null;
    }
  }, selector);
}

async function buildGeneratedTestCase(
  adapter: BrowserAdapter,
  item: ActionableItem,
  pageStateId: number
): Promise<GeneratedTestCaseDefinition | null> {
  const actionKind = item.actionKind || "click";
  const label =
    item.accessibleName ||
    item.tagName ||
    item.selector?.slice(0, 30) ||
    "element";

  let actionType: string;
  let playwrightAction: PlaywrightAction;
  let playwrightCode: string;
  let value: string | undefined;

  if (actionKind === "navigate" || actionKind === "click") {
    actionType = "click";
    playwrightAction = PlaywrightAction.Click;
    playwrightCode = `await page.click('${item.selector!.replace(/'/g, "\\'")}');`;
  } else if (actionKind === "fill") {
    actionType = "fill";
    playwrightAction = PlaywrightAction.Fill;
    value = inferFillValue(item);
    playwrightCode = `await page.fill('${item.selector!.replace(/'/g, "\\'")}', '${value.replace(/'/g, "\\'")}');`;
  } else if (actionKind === "select") {
    actionType = "select";
    playwrightAction = PlaywrightAction.SelectOption;
    value = (await resolveSelectValue(adapter, item.selector!)) ?? undefined;
    if (!value) {
      return null;
    }
    playwrightCode = `await page.selectOption('${item.selector!.replace(/'/g, "\\'")}', '${value.replace(/'/g, "\\'")}');`;
  } else if (actionKind === "radio_select") {
    actionType = "radio_select";
    playwrightAction = PlaywrightAction.Click;
    playwrightCode = `await page.click('${item.selector!.replace(/'/g, "\\'")}');`;
  } else {
    actionType = "click";
    playwrightAction = PlaywrightAction.Click;
    playwrightCode = `await page.click('${item.selector!.replace(/'/g, "\\'")}');`;
  }

  const steps: TestStep[] = [
    {
      action: {
        actionType: playwrightAction,
        pageStateId,
        path: item.selector!,
        value,
        playwrightCode,
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

  return {
    title: `${actionType}: ${label}`,
    actionType,
    item,
    steps,
  };
}

async function classifyItemsByScaffold(
  adapter: BrowserAdapter,
  items: ActionableItem[],
  scaffolds: PersistedScaffoldRegion[]
): Promise<{
  pageItems: ActionableItem[];
  scaffoldItems: Map<number, ActionableItem[]>;
}> {
  if (items.length === 0 || scaffolds.length === 0) {
    return { pageItems: items, scaffoldItems: new Map() };
  }

  const assignments = await adapter.evaluate(
    (...args: unknown[]) => {
      const selectors = args[0] as string[];
      const scaffoldSelectors = args[1] as Array<{
        scaffoldId: number;
        selector: string;
      }>;

      return selectors.map(selector => {
        try {
          const el = document.querySelector(selector);
          if (!el) return null;
          for (const scaffold of scaffoldSelectors) {
            try {
              const scaffoldEl = document.querySelector(scaffold.selector);
              if (
                scaffoldEl &&
                (el === scaffoldEl || scaffoldEl.contains(el))
              ) {
                return scaffold.scaffoldId;
              }
            } catch {
              // Ignore invalid scaffold selector.
            }
          }
        } catch {
          // Ignore invalid item selector.
        }
        return null;
      });
    },
    items.map(item => item.selector!),
    scaffolds.map(scaffold => ({
      scaffoldId: scaffold.scaffoldId,
      selector: scaffold.selector,
    }))
  );

  const scaffoldItems = new Map<number, ActionableItem[]>();
  const pageItems: ActionableItem[] = [];

  for (const [index, item] of items.entries()) {
    const scaffoldId = assignments[index];
    if (typeof scaffoldId === "number") {
      const existing = scaffoldItems.get(scaffoldId) ?? [];
      existing.push(item);
      scaffoldItems.set(scaffoldId, existing);
    } else {
      pageItems.push(item);
    }
  }

  return { pageItems, scaffoldItems };
}

function findExistingSuiteId(
  suites: Array<{ id: number; scaffoldId: number | null; title: string }>,
  scaffoldId: number
): number | null {
  const suite = suites.find(item => item.scaffoldId === scaffoldId);
  return suite?.id ?? null;
}

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

  const targetUrl = new URL(page.relativePath, config.baseUrl).toString();
  const currentUrl = await adapter.getUrl();
  if (toRelativePath(currentUrl) !== toRelativePath(targetUrl)) {
    LOG(`Navigating to ${targetUrl} for decomposition job ${job.id}`);
    await adapter.goto(targetUrl, { waitUntil: "networkidle0" });
  }

  // Extract actionable items from the live page
  const currentHtml = await adapter.content();
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

  // Detect scaffolds (header, footer, breadcrumb, etc.)
  const scaffolds = await detectScaffoldRegions(adapter);
  LOG(
    `Detected ${scaffolds.length} scaffolds:`,
    scaffolds.map(s => ({ type: s.type, selector: s.selector }))
  );

  // Persist scaffolds and link to page state
  const persistedScaffolds: PersistedScaffoldRegion[] = [];
  if (scaffolds.length > 0) {
    const scaffoldIds: number[] = [];
    for (const scaffold of scaffolds) {
      try {
        const saved = await api.findOrCreateScaffold({
          runnerId: config.runnerId,
          type: scaffold.type,
          hash: scaffold.hash,
          html: scaffold.outerHtml,
        });
        scaffoldIds.push(saved.id);
        persistedScaffolds.push({ ...scaffold, scaffoldId: saved.id });
        LOG(`Scaffold saved: type=${scaffold.type} id=${saved.id}`);
      } catch (err) {
        LOG(
          `Failed to save scaffold ${scaffold.type}:`,
          err instanceof Error ? err.message : err
        );
      }
    }
    if (scaffoldIds.length > 0) {
      try {
        await api.linkPageStateScaffolds(job.pageStateId, scaffoldIds);
        LOG(
          `Linked ${scaffoldIds.length} scaffolds to page state ${job.pageStateId}`
        );
      } catch (err) {
        LOG(
          `Failed to link scaffolds:`,
          err instanceof Error ? err.message : err
        );
      }
    }
  }

  const patterns = await detectPatternsWithInstances(adapter);
  const bodyHtml = getBody(currentHtml);
  const { contentBody } = getContentBody(bodyHtml, scaffolds);
  const patternInstances = patterns.flatMap(pattern => pattern.instances);
  const { fixedBody } = getFixedBody(contentBody, patternInstances);
  const decomposedHashes = await computeDecomposedHashes(
    fixedBody,
    scaffolds,
    patterns
  );

  const existingDecomposedState = await api.findMatchingPageStateDecomposed(
    page.id,
    decomposedHashes,
    config.sizeClass
  );
  await api.updatePageStateDecomposedHashes(pageState.id, decomposedHashes);
  await api.insertPageStatePatterns(
    pageState.id,
    patterns.map(pattern => ({
      type: pattern.type,
      selector: pattern.selector,
      count: pattern.count,
    }))
  );
  if (existingDecomposedState && existingDecomposedState.id !== pageState.id) {
    LOG(
      `Skipping decomposition for pageState ${pageState.id}; matched existing decomposed state ${existingDecomposedState.id}`
    );
    return [];
  }

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

  const { pageItems, scaffoldItems } = await classifyItemsByScaffold(
    adapter,
    interactiveItems,
    persistedScaffolds
  );
  LOG(
    `Classified ${pageItems.length} page items and ${Array.from(scaffoldItems.values()).reduce((count, value) => count + value.length, 0)} scaffold items`
  );

  const existingSuites = await api.getTestSuitesByRunner(config.runnerId);
  const existingCases = await api.getTestCasesByRunner(config.runnerId);
  let pageSuiteId: number | null = null;

  // Generate one test case per actionable item (cap at 20 to avoid explosion)
  const createdIds: number[] = [];

  const pageDefinitions = (
    await Promise.all(
      pageItems
        .slice(0, 20)
        .map(item => buildGeneratedTestCase(adapter, item, pageState.id))
    )
  ).filter((definition): definition is GeneratedTestCaseDefinition =>
    Boolean(definition)
  );

  if (pageDefinitions.length > 0) {
    const pageSuite = await api.insertTestSuite(config.runnerId, {
      title: `Page State #${job.pageStateId}`,
      description: `Auto-generated test suite for page state ${job.pageStateId} on ${page.relativePath}`,
      startingPageStateId: job.pageStateId,
      startingPath: page.relativePath,
      sizeClass: config.sizeClass,
      priority: 3,
      suite_tags: ["auto-generated", "page-interactions"],
      decompositionJobId: job.id,
    });
    pageSuiteId = pageSuite.id;
    LOG(`Created test suite: id=${pageSuite.id}, title=${pageSuite.title}`);
    events.onTestSuiteCreated({
      suiteId: pageSuite.id,
      title: pageSuite.title,
    });
  }

  for (const [index, definition] of pageDefinitions.entries()) {
    if (!pageSuiteId) break;
    const testCase: TestCase = {
      title: definition.title,
      type: "interaction",
      sizeClass: config.sizeClass,
      suite_tags: ["auto-generated", "mouse-scanning", "page-interactions"],
      page_id: page.id,
      priority: 3,
      startingPageStateId: pageState.id,
      startingPath: page.relativePath,
      steps: definition.steps,
      globalExpectations: [],
    };

    LOG(
      `Creating page test case ${index + 1}/${pageDefinitions.length}: "${testCase.title}" selector=${definition.item.selector?.slice(0, 60)}`
    );

    const tc = await api.insertTestCase(config.runnerId, testCase, pageSuiteId);
    createdIds.push(tc.id);

    for (const [stepIndex, step] of definition.steps.entries()) {
      await api.createTestAction({
        testCaseId: tc.id,
        stepOrder: stepIndex,
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

  for (const scaffold of persistedScaffolds) {
    const itemsForScaffold = scaffoldItems.get(scaffold.scaffoldId) ?? [];
    if (itemsForScaffold.length === 0) {
      continue;
    }

    let scaffoldSuiteId = findExistingSuiteId(
      existingSuites,
      scaffold.scaffoldId
    );
    if (!scaffoldSuiteId) {
      const suite = await api.insertTestSuite(config.runnerId, {
        title: `Shared Scaffold: ${scaffold.type}`,
        description: `Auto-generated shared scaffold suite for ${scaffold.type}`,
        startingPageStateId: job.pageStateId,
        startingPath: page.relativePath,
        sizeClass: config.sizeClass,
        scaffoldId: scaffold.scaffoldId,
        scaffoldType: scaffold.type as HtmlComponentType,
        priority: 2,
        suite_tags: ["auto-generated", "shared-scaffold"],
      });
      scaffoldSuiteId = suite.id;
      existingSuites.push(suite);
      LOG(
        `Created scaffold suite ${suite.id} for scaffold ${scaffold.scaffoldId}`
      );
      events.onTestSuiteCreated({ suiteId: suite.id, title: suite.title });
    }

    const scaffoldDefinitions = (
      await Promise.all(
        itemsForScaffold
          .slice(0, 20)
          .map(item => buildGeneratedTestCase(adapter, item, pageState.id))
      )
    ).filter((definition): definition is GeneratedTestCaseDefinition =>
      Boolean(definition)
    );

    for (const definition of scaffoldDefinitions) {
      const duplicate = existingCases.find(
        testCase =>
          testCase.scaffoldId === scaffold.scaffoldId &&
          testCase.title === definition.title
      );
      if (duplicate) {
        continue;
      }

      const testCase: TestCase = {
        title: definition.title,
        type: "interaction",
        sizeClass: config.sizeClass,
        suite_tags: ["auto-generated", "mouse-scanning", "shared-scaffold"],
        page_id: page.id,
        scaffoldId: scaffold.scaffoldId,
        priority: 2,
        startingPageStateId: pageState.id,
        startingPath: page.relativePath,
        steps: definition.steps,
        globalExpectations: [],
      };

      const tc = await api.insertTestCase(
        config.runnerId,
        testCase,
        scaffoldSuiteId
      );
      existingCases.push(tc);
      createdIds.push(tc.id);

      for (const [stepIndex, step] of definition.steps.entries()) {
        await api.createTestAction({
          testCaseId: tc.id,
          stepOrder: stepIndex,
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

  LOG(`Decomposition complete: created ${createdIds.length} test cases`);
  return createdIds;
}
