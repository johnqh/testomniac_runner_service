import type { ApiClient } from "../api/client";
import type {
  HtmlComponentType,
  ReusableHtmlElementResponse,
} from "@sudobility/testomniac_types";

export class ReusableElementCache {
  private cache = new Map<string, ReusableHtmlElementResponse>();
  private appId: number;
  private api: ApiClient;

  constructor(appId: number, api: ApiClient) {
    this.appId = appId;
    this.api = api;
  }

  async preload(): Promise<void> {
    const existing = await this.api.getReusableHtmlElements(this.appId);
    for (const el of existing) {
      if (el.htmlHash) {
        this.cache.set(el.htmlHash, el);
      }
    }
  }

  async findOrCreate(
    type: HtmlComponentType,
    html: string,
    hash: string
  ): Promise<ReusableHtmlElementResponse> {
    const cached = this.cache.get(hash);
    if (cached) return cached;

    const result = await this.api.findOrCreateReusableHtmlElement({
      appId: this.appId,
      type,
      html,
      hash,
    });
    this.cache.set(hash, result);
    return result;
  }

  get(hash: string): ReusableHtmlElementResponse | undefined {
    return this.cache.get(hash);
  }

  get size(): number {
    return this.cache.size;
  }
}
