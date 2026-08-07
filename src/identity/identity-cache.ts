import type { ApiClient } from "../api/client.js";
import type { ElementIdentityResponse } from "@sudobility/testomniac_types";

export class IdentityCache {
  private runnerId: number;
  private api: ApiClient;
  private identities: ElementIdentityResponse[] = [];

  constructor(runnerId: number, api: ApiClient) {
    this.runnerId = runnerId;
    this.api = api;
  }

  async preload(): Promise<void> {
    this.identities = await this.api.getElementIdentitiesByRunner(
      this.runnerId
    );
  }

  getAll(): ElementIdentityResponse[] {
    return this.identities;
  }

  add(identity: ElementIdentityResponse): void {
    const idx = this.identities.findIndex(i => i.id === identity.id);
    if (idx >= 0) {
      this.identities[idx] = identity;
    } else {
      this.identities.push(identity);
    }
  }
}
