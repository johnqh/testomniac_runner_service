import type { BrowserAdapter } from "../adapter";
import type { ApiClient } from "../api/client";
import { StateManager } from "./state-manager";

export class Navigator {
  private pagesWithNavAction = new Set<number>();
  private stateManager: StateManager;
  private api: ApiClient;
  private sizeClass: string;
  private baseUrl: string;

  constructor(opts: {
    stateManager: StateManager;
    api: ApiClient;
    appId: number;
    runId: number;
    sizeClass: string;
    baseUrl: string;
  }) {
    this.stateManager = opts.stateManager;
    this.api = opts.api;
    this.sizeClass = opts.sizeClass;
    this.baseUrl = opts.baseUrl;
  }

  async ensureOnPage(
    adapter: BrowserAdapter,
    startingPageStateId: number | null
  ): Promise<void> {
    if (startingPageStateId == null) return;
    if (this.stateManager.matches(startingPageStateId)) return;

    const resolved = await this.resolvePageUrl(startingPageStateId);
    if (!resolved) return;

    await adapter.goto(resolved.url, {
      waitUntil: "networkidle0",
      timeout: 30_000,
    });
    this.stateManager.update(startingPageStateId, resolved.url);
  }

  async ensureNavigationActionExists(
    pageId: number,
    _url: string
  ): Promise<void> {
    if (this.pagesWithNavAction.has(pageId)) return;
    this.pagesWithNavAction.add(pageId);
  }

  markPageAsNavigable(pageId: number): void {
    this.pagesWithNavAction.add(pageId);
  }

  private async resolvePageUrl(
    pageStateId: number
  ): Promise<{ pageId: number; url: string } | null> {
    const pageState = await this.api.getPageState(pageStateId);
    if (!pageState) return null;

    const pageRecord = await this.api.getPage(pageState.pageId);
    if (!pageRecord) return null;

    return { pageId: pageRecord.id, url: pageRecord.relativePath };
  }

  async resolveTargetPageUrl(targetPageId: number | null): Promise<string> {
    if (targetPageId == null) return this.baseUrl;

    const pageRecord = await this.api.getPage(targetPageId);
    if (!pageRecord) return this.baseUrl;
    return pageRecord.relativePath;
  }

  getStateManager(): StateManager {
    return this.stateManager;
  }
}
