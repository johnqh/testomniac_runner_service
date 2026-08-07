import type { ApiClient } from "../api/client.js";
import type { PageResponse } from "@sudobility/testomniac_types";

/**
 * In-memory cache of pages for an app, backed by the API.
 * Key is the normalized URL (stripped of fragment).
 * Avoids redundant API calls for the same URL during a scan.
 */
export class PageCache {
  private cache = new Map<string, PageResponse>();
  private runnerId: number;
  private api: ApiClient;

  constructor(runnerId: number, api: ApiClient) {
    this.runnerId = runnerId;
    this.api = api;
  }

  /** Preload all existing pages for this app from the API. */
  async preload(): Promise<void> {
    const pages = await this.api.getPagesByRunner(this.runnerId);
    for (const page of pages) {
      this.cache.set(this.normalizeUrl(page.relativePath), page);
    }
  }

  /** Find or create a page by URL. Returns cached result if available. */
  async findOrCreate(url: string): Promise<PageResponse> {
    const key = this.normalizeUrl(url);
    const cached = this.cache.get(key);
    if (cached) return cached;

    const page = await this.api.findOrCreatePage(this.runnerId, url);
    this.cache.set(key, page);
    return page;
  }

  /** Check if a URL has already been seen (without API call). */
  has(url: string): boolean {
    return this.cache.has(this.normalizeUrl(url));
  }

  get size(): number {
    return this.cache.size;
  }

  private normalizeUrl(url: string): string {
    return url.split("#")[0];
  }
}
