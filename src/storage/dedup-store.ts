/**
 * Key-value dedup store abstraction.
 *
 * PageAnalyzer uses multiple dedup collections to avoid redundant test
 * generation and finding reporting.  This interface allows each consumer
 * to provide its own storage backend:
 *
 * - Extension: chrome.storage.local (survives service-worker restarts,
 *   no memory pressure)
 * - Server runner: in-memory Sets (no size constraints)
 */
export interface DedupStore {
  /** Check if a key exists in the named collection. */
  has(collection: string, key: string): Promise<boolean>;

  /** Add a key to the named collection. */
  add(collection: string, key: string): Promise<void>;
}

/**
 * Default in-memory implementation.  Used by the server runner and as
 * a fallback when no store is provided.
 */
export class InMemoryDedupStore implements DedupStore {
  private collections = new Map<string, Set<string>>();

  private getCollection(name: string): Set<string> {
    let set = this.collections.get(name);
    if (!set) {
      set = new Set();
      this.collections.set(name, set);
    }
    return set;
  }

  async has(collection: string, key: string): Promise<boolean> {
    return this.getCollection(collection).has(key);
  }

  async add(collection: string, key: string): Promise<void> {
    this.getCollection(collection).add(key);
  }
}
