/**
 * Abstract browser interface that both Puppeteer (server) and Chrome APIs (extension) implement.
 */
export interface RuntimeArtifacts {
  consoleLogs: string[];
  networkLogs: Array<{
    method: string;
    url: string;
    status: number;
    contentType: string;
    timestampMs?: number;
  }>;
}

export interface BrowserAdapter {
  /** Navigate to a URL */
  goto(
    url: string,
    options?: { waitUntil?: string; timeout?: number }
  ): Promise<void>;

  /** Click an element by CSS selector */
  click(selector: string, options?: { timeout?: number }): Promise<void>;

  /** Hover over an element by CSS selector */
  hover(selector: string, options?: { timeout?: number }): Promise<void>;

  /** Type text into an element */
  type(selector: string, text: string): Promise<void>;

  /** Wait for an element to appear */
  waitForSelector(
    selector: string,
    options?: { visible?: boolean; timeout?: number }
  ): Promise<boolean>;

  /** Wait for navigation to complete */
  waitForNavigation(options?: {
    waitUntil?: string;
    timeout?: number;
  }): Promise<void>;

  /** Execute JavaScript in the page context */
  evaluate<T>(
    fn: string | ((...args: unknown[]) => T),
    ...args: unknown[]
  ): Promise<T>;

  /** Get the full page HTML */
  content(): Promise<string>;

  /**
   * Optional single-round-trip page read. Adapters where injection round
   * trips dominate (e.g. the Chrome extension) may batch html + body text in
   * one call. Omit it and the executor falls back to content().
   */
  capturePageSnapshot?(): Promise<{ html: string; bodyTextLength: number }>;

  /** Get the current URL */
  url(): string;

  /** Take a screenshot */
  screenshot(options?: {
    type?: string;
    quality?: number;
  }): Promise<Uint8Array>;

  /** Set viewport dimensions */
  setViewport(width: number, height: number): Promise<void>;

  /** Press a keyboard key */
  pressKey(key: string): Promise<void>;

  /** Select an option in a <select> element */
  select(selector: string, value: string): Promise<void>;

  /** Close the page/tab */
  close(): Promise<void>;

  /** Subscribe to page events */
  on(
    event: "console" | "response",
    handler: (...args: unknown[]) => void
  ): () => void;

  /** Get the current URL (async — needed by adapters that require async I/O for URL lookup) */
  getUrl(): Promise<string>;

  /** Submit a text entry by pressing Enter on the focused field */
  submitTextEntry(selector: string): Promise<void>;

  /** Close any tabs/windows opened during interaction, keeping only the original */
  closeOtherTabs?(): Promise<void>;

  /** Return buffered runtime artifacts, when supported by the adapter. */
  getRuntimeArtifacts?(): RuntimeArtifacts;

  /** Clear any buffered runtime artifacts, when supported by the adapter. */
  resetRuntimeArtifacts?(): void;

  /** Wait for a new tab/window to open. Returns a tab identifier, or null on timeout. */
  waitForNewTab?(timeoutMs?: number): Promise<number | null>;

  /** Switch the adapter to operate on a different tab/window. */
  switchToTab?(tabId: number): Promise<void>;

  /** Return the current tab identifier. */
  getCurrentTabId?(): number;

  /**
   * Resolve once the network has been quiet (no non-persistent in-flight
   * requests) for the idle window, or once the hard cap elapses. Optional:
   * adapters that cannot observe network activity simply omit it.
   */
  waitForNetworkIdle?(opts?: {
    idleMs?: number;
    floorMs?: number;
    staleMs?: number;
    timeout?: number;
    pollMs?: number;
  }): Promise<void>;
}
