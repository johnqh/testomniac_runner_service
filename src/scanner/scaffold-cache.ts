import type { ApiClient } from "../api/client";
import type {
  HtmlComponentType,
  ScaffoldResponse,
} from "@sudobility/testomniac_types";

export class ScaffoldCache {
  private cache = new Map<string, ScaffoldResponse>();
  private runnerId: number;
  private api: ApiClient;

  constructor(runnerId: number, api: ApiClient) {
    this.runnerId = runnerId;
    this.api = api;
  }

  async preload(): Promise<void> {
    const existing = await this.api.getScaffolds(this.runnerId);
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
  ): Promise<ScaffoldResponse> {
    const cached = this.cache.get(hash);
    if (cached) return cached;

    const result = await this.api.findOrCreateScaffold({
      runnerId: this.runnerId,
      type,
      html,
      hash,
    });
    this.cache.set(hash, result);
    return result;
  }

  get(hash: string): ScaffoldResponse | undefined {
    return this.cache.get(hash);
  }

  get size(): number {
    return this.cache.size;
  }
}
