/**
 * Abstract browser interface that both Puppeteer (server) and Chrome APIs (extension) implement.
 */
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
  ): void;

  /** Get the current URL (async — needed by adapters that require async I/O for URL lookup) */
  getUrl(): Promise<string>;

  /** Submit a text entry by pressing Enter on the focused field */
  submitTextEntry(selector: string): Promise<void>;

  /** Close any tabs/windows opened during interaction, keeping only the original */
  closeOtherTabs?(): Promise<void>;
}
