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
  ElementIdentity,
  ElementLocator,
} from "@sudobility/testomniac_types";
import {
  resolvePlaywrightRole,
  LocatorStrategy,
} from "@sudobility/testomniac_types";
import type { DetectionContext } from "../detectors/detection-rule";
import { IdentityCache } from "../identity/identity-cache";
import {
  matchElementIdentity,
  type ElementFingerprint,
} from "../identity/element-matcher";
import {
  toPlaywrightLocator,
  buildScopeChain,
} from "../identity/playwright-locator";

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

  const identityCache = new IdentityCache(config.appId, api);
  await identityCache.preload();

  // Track which reusable elements have been tested to avoid duplicates
  const testedReusableElements = new Set<number>();

  // Track the current action chain for detection context
  let actionChainStack: ActionDefinitionResponse[] = [];

  // Determine the start origin (don't re-navigate — the caller already did)
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
    // Check for cancellation
    if (config.signal?.aborted) break;

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
        const currentUrl = await adapter.getUrl();

        // Only navigate if we're not already on the target URL
        if (currentUrl.split("#")[0] !== targetUrl.split("#")[0]) {
          await adapter.goto(targetUrl, {
            waitUntil: "networkidle0",
            timeout: 30_000,
          });
        }

        // Wait for page to settle (SPA rendering, animations, lazy loading)
        await new Promise(r => setTimeout(r, 2000));

        const afterUrl = await adapter.getUrl();
        const pageRecord = await pageCache.findOrCreate(afterUrl);

        // Capture page state with HTML decomposition
        const html = await adapter.content();
        console.log(`[mouse-scanning] HTML length: ${html.length}`);
        const items = await extractActionableItems(adapter);
        console.log(
          `[mouse-scanning] Extracted ${items.length} items (${items.filter(i => i.visible).length} visible)`
        );
        const visibleText = extractVisibleText(html);
        const hashes = await computeHashes(html, items);

        const existing = await api.findMatchingPageState(
          pageRecord.id,
          hashes,
          sizeClass
        );

        // If page state already exists, reuse it but still create actions for this scan
        let pageState = existing;

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

        if (!pageState) {
          // Create new page state only if no existing match
          pageState = await api.createPageState({
            pageId: pageRecord.id,
            sizeClass,
            hashes,
            contentText: visibleText.slice(0, 5000),
            bodyHtmlElementId: bodyElement.id,
            contentHtmlElementId: contentElement.id,
          });
        }
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

        // Insert actionable items and capture their DB IDs
        let insertedItems: Array<{
          id: number;
          selector: string | null;
          actionKind: string | null;
          reusableHtmlElementId?: number | null;
        }> = [];
        if (items.length > 0) {
          insertedItems = await api.insertActionableItems(
            contentElement.id,
            items
          );
        }

        // Match / create element identities for visible items
        for (const inserted of insertedItems) {
          const original = items.find(o => o.selector === inserted.selector);
          if (!original || !original.visible) continue;

          const attrs = (original.attributes || {}) as Record<string, string>;
          const role = resolvePlaywrightRole(
            original.tagName,
            original.inputType,
            original.role
          );

          const fp: ElementFingerprint = {
            role,
            computedName: original.accessibleName || original.textContent || "",
            tagName: original.tagName,
            labelText:
              attrs.labelText || attrs._groupName ? undefined : attrs.labelText,
            groupName: attrs._groupName || undefined,
            placeholder: attrs.placeholder || undefined,
            altText:
              original.tagName === "IMG"
                ? original.accessibleName || undefined
                : undefined,
            testId: attrs._testId || undefined,
            inputType: original.inputType,
            formContext: attrs._formContext || undefined,
            headingContext: attrs._headingContext || undefined,
            landmarkAncestor: attrs._landmarkAncestor || undefined,
            cssSelector: original.selector,
          };
          // Fix labelText assignment
          fp.labelText = attrs.labelText || undefined;

          const partialIdentity: ElementIdentity = {
            ...fp,
            playwrightLocator: "",
            isUniqueOnPage: true,
            locators: [],
          };
          const locator = toPlaywrightLocator(partialIdentity);
          const scopeChain = buildScopeChain(partialIdentity);

          const locators: ElementLocator[] = [];
          if (fp.testId) {
            locators.push({
              strategy: LocatorStrategy.TestId,
              value: `getByTestId('${fp.testId}')`,
              priority: 0,
            });
          }
          if (fp.labelText) {
            locators.push({
              strategy: LocatorStrategy.Label,
              value: `getByLabel('${fp.labelText}')`,
              priority: 1,
            });
          }
          if (fp.placeholder) {
            locators.push({
              strategy: LocatorStrategy.Placeholder,
              value: `getByPlaceholder('${fp.placeholder}')`,
              priority: 2,
            });
          }
          if (fp.computedName && role !== "generic") {
            locators.push({
              strategy: LocatorStrategy.RoleName,
              value: `getByRole('${role}', { name: '${fp.computedName}' })`,
              priority: 3,
            });
          }
          if (fp.computedName) {
            locators.push({
              strategy: LocatorStrategy.Text,
              value: `getByText('${fp.computedName}')`,
              priority: 4,
            });
          }
          locators.push({
            strategy: LocatorStrategy.Css,
            value: original.selector,
            priority: 10,
          });

          const match = matchElementIdentity(fp, identityCache.getAll());
          if (match) {
            await api.updateElementIdentity(match.identity.id, {
              lastSeenScanId: config.runId,
              playwrightLocator: locator,
              playwrightScopeChain: scopeChain,
              cssSelector: original.selector,
              locators,
            });
            identityCache.add({
              ...match.identity,
              lastSeenScanId: config.runId,
            });
          } else {
            const created = await api.findOrCreateElementIdentity({
              appId: config.appId,
              scanId: config.runId,
              role,
              computedName: fp.computedName,
              tagName: fp.tagName,
              labelText: fp.labelText,
              groupName: fp.groupName,
              placeholder: fp.placeholder,
              altText: fp.altText,
              testId: fp.testId,
              inputType: fp.inputType,
              formContext: fp.formContext,
              headingContext: fp.headingContext,
              landmarkAncestor: fp.landmarkAncestor,
              playwrightLocator: locator,
              playwrightScopeChain: scopeChain,
              isUniqueOnPage: true,
              cssSelector: original.selector,
              locators,
            });
            identityCache.add(created);
          }
        }

        // Create actions for visible items sorted by priority
        const sortedInserted = insertedItems
          .filter(i => {
            const original = items.find(o => o.selector === i.selector);
            return original && original.visible && !original.disabled;
          })
          .sort((a, b) => {
            const origA = items.find(o => o.selector === a.selector);
            const origB = items.find(o => o.selector === b.selector);
            return (
              getActionPriority(origA || ({} as ActionableItem)) -
              getActionPriority(origB || ({} as ActionableItem))
            );
          });

        for (const inserted of sortedInserted) {
          // Skip if reusable element already tested in this run
          if (inserted.reusableHtmlElementId) {
            if (testedReusableElements.has(inserted.reusableHtmlElementId))
              continue;
            testedReusableElements.add(inserted.reusableHtmlElementId);
          }

          const actionType =
            inserted.actionKind === "fill"
              ? "fill"
              : inserted.actionKind === "select"
                ? "select"
                : inserted.actionKind === "radio_select"
                  ? "radio_select"
                  : "click";

          await api.createActionAndExecution(config.appId, config.runId, {
            type: actionType,
            startingPageStateId: pageState.id,
            actionableItemId: inserted.id,
          });
        }

        // Reset action chain on navigate and push current action
        actionChainStack = [
          {
            id: action.actionId,
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

        // Resolve the actionable item by ID
        let item: ActionableItem | null = null;
        let itemSelector: string | null = null;
        if (action.actionableItemId) {
          const found = await api.getActionableItem(action.actionableItemId);
          if (found) {
            item = found as unknown as ActionableItem;
            itemSelector = found.selector;
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

        // Build human-readable description for the action
        const elementDesc = item
          ? `"${(item.accessibleName || item.textContent || "").slice(0, 40)}" ${(item.tagName || "").toLowerCase()}`
          : itemSelector || currentUrl;

        events.onActionCompleted({
          type: action.type ?? "unknown",
          selector: elementDesc,
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
