import type { BrowserAdapter } from "../adapter";
import type { ApiClient } from "../api/client";
import type { ScanConfig, ScanEventHandler } from "./types";
import { extractActionableItems } from "../extractors";
import { computeHashes, extractVisibleText } from "../browser/page-utils";
import { LoopGuard } from "../scanner/loop-guard";
import { StateManager } from "../scanner/state-manager";
import { Navigator } from "../scanner/navigator";
import {
  getActionPriority,
  looksLikeEnterCommitField,
  normalizeHref,
} from "../scanner/action-classifier";
import { fillValuePlanner } from "../planners/fill-value-planner";
import { runDetectionRules } from "../detectors/issue-creator";
import { detectAndHandleModal, dismissModal } from "../detectors/modal-handler";
import { HOVER_DELAY_MS, POST_ACTION_SETTLE_MS } from "../config/constants";
import { detectReusableRegions } from "../scanner/component-detector";
import { decomposeHtml } from "../scanner/html-decomposer";
import { ReusableElementCache } from "../scanner/reusable-element-cache";
import { PageCache } from "../scanner/page-cache";
import { sha256 } from "../browser/page-utils";
import type {
  ActionableItem,
  ActionDefinitionResponse,
} from "@sudobility/testomniac_types";
import type { DetectionContext } from "../detectors/detection-rule";

export async function runMouseScanning(
  adapter: BrowserAdapter,
  config: ScanConfig,
  api: ApiClient,
  events: ScanEventHandler
): Promise<void> {
  const sizeClass = config.sizeClass || "desktop";
  const loopGuard = new LoopGuard();
  const stateManager = new StateManager();
  const navigator = new Navigator({
    stateManager,
    api,
    appId: config.appId,
    runId: config.runId,
    sizeClass,
    baseUrl: config.baseUrl,
  });

  // Caches — preload from API to avoid redundant network calls
  const pageCache = new PageCache(config.appId, api);
  await pageCache.preload();

  const reusableCache = new ReusableElementCache(config.appId, api);
  await reusableCache.preload();

  // Track which reusable elements have been tested to avoid duplicates
  const testedReusableElements = new Set<number>();

  // Track the current action chain for detection context
  let actionChainStack: ActionDefinitionResponse[] = [];

  // Navigate to base URL
  await adapter.goto(config.baseUrl, {
    waitUntil: "networkidle0",
    timeout: 30_000,
  });
  const startOrigin = new URL(config.baseUrl).origin;

  // Create initial page record (page state created when navigate action is processed)
  const initialPage = await pageCache.findOrCreate(config.baseUrl);
  navigator.markPageAsNavigable(initialPage.id);

  // Check if there's already an open action execution (created by POST /scan)
  let action = await api.getNextOpenAction(config.runId);
  if (!action) {
    // No existing execution — create navigate action + execution
    await api.createActionAndExecution(config.appId, config.runId, {
      type: "navigate",
      targetUrl: config.baseUrl,
    });
    action = await api.getNextOpenAction(config.runId);
  }

  // Main action-driven loop
  while (action) {
    if (
      !loopGuard.shouldCreate(
        "action",
        action.id,
        stateManager.getCurrentPageStateId() ?? 0
      )
    ) {
      await api.completeAction(action.id, {});
      action = await api.getNextOpenAction(config.runId, sizeClass);
      continue;
    }
    loopGuard.record(
      "action",
      action.id,
      stateManager.getCurrentPageStateId() ?? 0
    );

    await api.startAction(action.id);

    try {
      if (action.type === "navigate") {
        const targetUrl = action.targetUrl ?? config.baseUrl;
        await adapter.goto(targetUrl, {
          waitUntil: "networkidle0",
          timeout: 30_000,
        });

        const currentUrl = await adapter.getUrl();
        const pageRecord = await pageCache.findOrCreate(currentUrl);

        // Capture page state with HTML decomposition
        const html = await adapter.content();
        const items = await extractActionableItems(adapter);
        const visibleText = extractVisibleText(html);
        const hashes = await computeHashes(html, items);

        const existing = await api.findMatchingPageState(
          pageRecord.id,
          hashes,
          sizeClass
        );
        if (existing) {
          stateManager.update(existing.id, currentUrl);
          events.onPageFound({ url: currentUrl, pageId: pageRecord.id });
          events.onPageStateCreated({
            pageStateId: existing.id,
            pageId: pageRecord.id,
          });
          await api.completeAction(action.id, {});
          action = await api.getNextOpenAction(config.runId, sizeClass);
          continue;
        }

        // Detect reusable regions and decompose HTML
        const reusableRegions = await detectReusableRegions(adapter);
        const resolvedReusableElements: Array<{
          type: string;
          selector: string;
          reusableId: number;
        }> = [];
        for (const region of reusableRegions) {
          const reusable = await reusableCache.findOrCreate(
            region.type,
            region.outerHtml,
            region.hash
          );
          resolvedReusableElements.push({
            type: region.type,
            selector: region.selector,
            reusableId: reusable.id,
          });
        }

        const { contentHtml } = decomposeHtml(html, reusableRegions);

        // Create html elements for body and content
        const bodyHash = await sha256(html);
        const contentHash = await sha256(contentHtml);
        const bodyElement = await api.findOrCreateHtmlElement(html, bodyHash);
        const contentElement = await api.findOrCreateHtmlElement(
          contentHtml,
          contentHash
        );

        // Tag actionable items with their containing reusable element
        if (resolvedReusableElements.length > 0) {
          const containmentMap = (await adapter.evaluate(
            (...args: unknown[]) => {
              const regionSels = args[0] as string[];
              const itemSels = args[1] as string[];
              const result: Record<string, string | null> = {};
              for (const itemSel of itemSels) {
                const el = document.querySelector(itemSel);
                if (!el) {
                  result[itemSel] = null;
                  continue;
                }
                let found = false;
                for (const regionSel of regionSels) {
                  try {
                    const container = document.querySelector(regionSel);
                    if (container && container.contains(el)) {
                      result[itemSel] = regionSel;
                      found = true;
                      break;
                    }
                  } catch {
                    // skip
                  }
                }
                if (!found) result[itemSel] = null;
              }
              return result;
            },
            resolvedReusableElements.map(r => r.selector),
            items.map(i => i.selector)
          )) as Record<string, string | null>;

          const selectorToReusableId = new Map(
            resolvedReusableElements.map(r => [r.selector, r.reusableId])
          );
          for (const item of items) {
            const containingSelector = containmentMap[item.selector];
            if (containingSelector) {
              item.reusableHtmlElementId =
                selectorToReusableId.get(containingSelector);
            }
          }
        }

        await adapter.screenshot({ type: "jpeg", quality: 72 });
        const pageState = await api.createPageState({
          pageId: pageRecord.id,
          sizeClass,
          hashes,
          contentText: visibleText.slice(0, 5000),
          bodyHtmlElementId: bodyElement.id,
          contentHtmlElementId: contentElement.id,
        });
        stateManager.update(pageState.id, currentUrl);
        events.onPageFound({ url: currentUrl, pageId: pageRecord.id });
        events.onPageStateCreated({
          pageStateId: pageState.id,
          pageId: pageRecord.id,
        });

        // Link page state to reusable elements
        const reusableIds = resolvedReusableElements.map(r => r.reusableId);
        if (reusableIds.length > 0) {
          await api.linkPageStateReusableElements(pageState.id, reusableIds);
        }

        // Insert actionable items (now includes reusableHtmlElementId tags)
        if (items.length > 0) {
          await api.insertActionableItems(contentElement.id, items);
        }

        // Create actions for visible items sorted by priority
        const sortedItems = [...items]
          .filter(i => i.visible && !i.disabled)
          .sort((a, b) => getActionPriority(a) - getActionPriority(b));

        for (const item of sortedItems) {
          // Skip if reusable element already tested in this run
          if (item.reusableHtmlElementId) {
            if (testedReusableElements.has(item.reusableHtmlElementId))
              continue;
            testedReusableElements.add(item.reusableHtmlElementId);
          }

          const actionType =
            item.actionKind === "fill"
              ? "fill"
              : item.actionKind === "select"
                ? "select"
                : item.actionKind === "radio_select"
                  ? "radio_select"
                  : "click";

          await api.createActionAndExecution(config.appId, config.runId, {
            type: actionType,
            startingPageStateId: pageState.id,
          });
        }

        // Reset action chain on navigate and push current action
        actionChainStack = [
          {
            id: action.id,
            appId: config.appId,
            type: action.type,
            startingPageStateId: action.startingPageStateId ?? null,
            targetUrl: action.targetUrl ?? null,
            actionableItemId: action.actionableItemId ?? null,
            htmlElementId: null,
            inputValue: null,
            createdAt: null,
          },
        ];

        // Run detection rules
        const detectionContext: DetectionContext = {
          adapter,
          html,
          visibleText,
          pageUrl: currentUrl,
          pageRecord,
          pageState,
          items,
          appId: config.appId,
          scanId: config.runId,
          currentActionChain: actionChainStack,
        };
        const detectedIssues = await runDetectionRules(detectionContext, api);
        for (const issue of detectedIssues) {
          events.onIssueDetected({
            type: issue.ruleName,
            description: issue.observedOutcome,
          });
        }

        // Discover new pages from links (enqueue for later, don't count as "found")
        for (const item of items.filter(i => i.href && i.visible)) {
          const normalized = normalizeHref(item.href!, config.baseUrl);
          if (!normalized) continue;
          try {
            if (new URL(normalized).origin !== startOrigin) continue;
          } catch {
            continue;
          }
          const newPage = await pageCache.findOrCreate(normalized);
          await navigator.ensureNavigationActionExists(newPage.id, normalized);
        }
      } else {
        // Non-navigate action: click, fill, select, toggle
        if (action.startingPageStateId) {
          await navigator.ensureOnPage(adapter, action.startingPageStateId);
        }

        const currentUrl = await adapter.getUrl();

        // Resolve the actionable item if we have an ID
        let item: ActionableItem | null = null;
        let itemSelector: string | null = null;
        if (action.actionableItemId) {
          const pageStateId =
            action.startingPageStateId ?? stateManager.getCurrentPageStateId();
          if (pageStateId) {
            const stateItems = await api.getItemsByPageState(pageStateId);
            const found = stateItems.find(
              i => i.id === action!.actionableItemId
            );
            if (found) {
              item = found as unknown as ActionableItem;
              itemSelector = found.selector;
            }
          }
        }

        if (itemSelector) {
          const found = await adapter.waitForSelector(itemSelector, {
            visible: true,
            timeout: 3000,
          });

          if (found) {
            // Hover first
            try {
              await adapter.hover(itemSelector, { timeout: 3000 });
              await new Promise(r => setTimeout(r, HOVER_DELAY_MS));
            } catch {
              // hover failed, continue
            }

            // Dismiss any modal triggered by hover
            const modalResult = await detectAndHandleModal(adapter);
            if (modalResult.found) {
              await dismissModal(adapter);
            }

            // Execute the action
            try {
              if (action.type === "fill" && item) {
                const value = fillValuePlanner.planValue(item);
                await adapter.type(itemSelector, value);
                if (looksLikeEnterCommitField(item)) {
                  await adapter.submitTextEntry(itemSelector);
                }
              } else if (action.type === "select") {
                await adapter.select(itemSelector, "");
              } else if (action.type === "radio_select") {
                await adapter.click(itemSelector, { timeout: 3000 });
              } else {
                await adapter.click(itemSelector, { timeout: 3000 });
              }
            } catch {
              // Action execution failed
            }

            // Post-action settle
            await new Promise(r => setTimeout(r, POST_ACTION_SETTLE_MS));

            // Dismiss any modal triggered by action
            const postModal = await detectAndHandleModal(adapter);
            if (postModal.found) {
              await dismissModal(adapter);
            }

            // Check for navigation — enqueue new page but don't count as "found"
            const afterUrl = await adapter.getUrl();
            if (afterUrl !== currentUrl) {
              try {
                const afterOrigin = new URL(afterUrl).origin;
                if (afterOrigin !== startOrigin) {
                  await adapter.goto(currentUrl, {
                    waitUntil: "networkidle0",
                    timeout: 30_000,
                  });
                } else {
                  // Enqueue for later navigation — page state will be created then
                  const newPage = await pageCache.findOrCreate(afterUrl);
                  await navigator.ensureNavigationActionExists(
                    newPage.id,
                    afterUrl
                  );
                  await adapter.goto(currentUrl, {
                    waitUntil: "networkidle0",
                    timeout: 30_000,
                  });
                }
              } catch {
                await adapter.goto(currentUrl, {
                  waitUntil: "networkidle0",
                  timeout: 30_000,
                });
              }
            }

            // Screenshot after action
            try {
              const screenshot = await adapter.screenshot({
                type: "jpeg",
                quality: 72,
              });
              const base64 = uint8ToBase64(screenshot);
              events.onScreenshotCaptured({
                dataUrl: `data:image/jpeg;base64,${base64}`,
                pageUrl: currentUrl,
              });
            } catch {
              // Screenshot failed
            }
          }
        }

        events.onActionCompleted({
          type: action.type ?? "unknown",
          selector: itemSelector || undefined,
          pageUrl: currentUrl,
        });
      }
    } catch (error) {
      events.onError({
        message: error instanceof Error ? error.message : "Action failed",
        phase: "mouse_scanning",
      });
    }

    if (action) {
      await api.completeAction(action.id, {});
    }
    action = await api.getNextOpenAction(config.runId, sizeClass);
  }
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
