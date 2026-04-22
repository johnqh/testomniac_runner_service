# Testomniac Scanning Service

Shared TypeScript library containing core scanning logic, browser abstraction, detectors, and API client for the Testomniac testing platform.

**Package**: `@sudobility/testomniac_scanning_service` v0.0.3 (published to npm, public)

## Tech Stack

- **Language**: TypeScript (strict mode)
- **Runtime**: Bun
- **Package Manager**: Bun (do not use npm/yarn/pnpm for installing dependencies)
- **Build**: TypeScript compiler (tsc) to `dist/`
- **Test**: Vitest
- **Module**: ES Module (ESM only)

## Project Structure

```
src/
├── index.ts                    # Public API exports
├── adapter.ts                  # BrowserAdapter interface definition
├── api/
│   └── client.ts               # ApiClient — HTTP client for testomniac_api (55+ methods)
├── browser/
│   ├── page-utils.ts           # normalizeHtml, computeHashes (4-hash dedup)
│   └── page-utils.test.ts
├── config/
│   └── constants.ts            # Timeouts, limits, URL patterns, error patterns
├── detectors/
│   ├── index.ts                # Re-exports all detectors
│   ├── link-checker.ts         # Broken link detection (HEAD requests, 4xx/5xx)
│   ├── visual-checker.ts       # Broken images, missing alt, duplicate IDs/headings, empty links
│   ├── content-checker.ts      # Placeholder text, error pages, invalid prices, short pages
│   ├── functional-checker.ts   # Console errors, network failures, error pages after clicks
│   └── *.test.ts               # Colocated tests
├── domain/
│   ├── types.ts                # Re-exports from @sudobility/testomniac_types
│   └── url-ownership.ts        # normalizeBaseUrl, getRegistrableDomain, emailMatchesUrlDomain
├── scanner/
│   ├── action-queue.ts         # In-memory action queue (add, next, complete, hasOpen)
│   ├── state-manager.ts        # Page state tracker (update, getCurrentPageStateId, matches)
│   ├── loop-guard.ts           # Prevents infinite loops (200 actions/page, 5000 total)
│   ├── phase-timer.ts          # Per-phase duration tracking
│   ├── issue-detector.ts       # detectDeadClick, detectErrorOnPage, detectConsoleErrors, detectNetworkErrors
│   ├── component-detector.ts   # Reusable UI component detection across pages
│   ├── email-detector.ts       # Email verification flow detection
│   ├── scroll-scanner.ts       # Discover lazy-loaded elements via scrolling
│   ├── pairwise.ts             # Pairwise test combination generator
│   └── *.test.ts               # Colocated tests
└── detectors/
    └── *.test.ts
```

## Commands

```bash
bun run build        # Compile TypeScript to dist/ (tsc -p tsconfig.build.json)
bun run dev          # Watch mode (tsc --watch)
bun run test         # Run Vitest tests
bun run test:watch   # Vitest watch mode
bun run typecheck    # TypeScript check only (tsc --noEmit)
bun run lint         # ESLint
bun run lint:fix     # ESLint auto-fix
bun run format       # Prettier write
bun run format:check # Prettier check
bun run verify       # typecheck + lint + test + build (run before publish)
```

## Public API Exports

Everything exported from `src/index.ts`:

```typescript
// Browser abstraction
export type { BrowserAdapter } from "./adapter"

// Scanner modules
export { ActionQueue } from "./scanner/action-queue"
export { StateManager } from "./scanner/state-manager"
export { LoopGuard } from "./scanner/loop-guard"
export { PhaseTimer } from "./scanner/phase-timer"
export { ComponentDetector } from "./scanner/component-detector"
export { EmailDetector } from "./scanner/email-detector"
export { ScrollScanner } from "./scanner/scroll-scanner"
export { generatePairwiseCombinations } from "./scanner/pairwise"

// Issue detection
export { detectDeadClick, detectErrorOnPage, detectConsoleErrors, detectNetworkErrors } from "./scanner/issue-detector"

// Detectors (page-level quality checks)
export { LinkChecker, VisualChecker, ContentChecker, FunctionalChecker } from "./detectors"

// Page utilities
export { normalizeHtml, computeHashes } from "./browser/page-utils"

// Domain types (re-exported from @sudobility/testomniac_types)
export * from "./domain/types"

// URL utilities
export { normalizeBaseUrl, getRegistrableDomain, emailMatchesUrlDomain } from "./domain/url-ownership"

// Configuration constants
export * from "./config/constants"

// API client
export { ApiClient, getApiClient } from "./api/client"
```

## BrowserAdapter Interface

The core abstraction that allows the same scanning logic to work with both Puppeteer (server-side scanner) and Chrome DevTools Protocol (browser extension):

```typescript
interface BrowserAdapter {
  // Navigation
  goto(url: string, options?: { waitUntil?: string; timeout?: number }): Promise<void>
  waitForNavigation(options?: { timeout?: number }): Promise<void>
  url(): Promise<string>

  // DOM
  content(): Promise<string>
  evaluate<T>(fn: (...args: any[]) => T, ...args: any[]): Promise<T>
  waitForSelector(selector: string, options?: { timeout?: number; visible?: boolean }): Promise<void>

  // Interaction
  click(selector: string, options?: { timeout?: number }): Promise<void>
  hover(selector: string, options?: { timeout?: number }): Promise<void>
  type(selector: string, text: string): Promise<void>
  select(selector: string, value: string): Promise<void>
  pressKey(key: string): Promise<void>

  // Capture
  screenshot(options?: { type?: string; quality?: number }): Promise<Uint8Array>
  setViewport(width: number, height: number): Promise<void>

  // Events
  on(event: string, handler: (...args: any[]) => void): void

  // Lifecycle
  close(): Promise<void>
}
```

**Implementations**:
- `ChromeAdapter` in `testomniac_extension/src/adapters/ChromeAdapter.ts` (CDP via chrome.debugger)
- `PuppeteerAdapter` in `testomniac_scanner/src/adapters/PuppeteerAdapter.ts` (Puppeteer page wrapper)

## ApiClient

HTTP client for the `testomniac_api` scanner endpoints. Initialized via singleton factory:

```typescript
const client = getApiClient(baseUrl, apiKey);
```

**Method categories** (55+ methods):
- **Run management**: `getPendingRun()`, `updateRunPhase()`, `updateRunStats()`, `updatePhaseDuration()`, `completeRun()`
- **Page/state tracking**: `findOrCreatePage()`, `createPageState()`, `findMatchingPageState()`, `getPageState()`
- **Actionable items**: `insertActionableItems()`, `getItemsByPageState()`
- **Actions**: `createAction()`, `getNextOpenAction()`, `startAction()`, `completeAction()`, `getActionChain()`
- **Personas/use cases**: `createPersona()`, `createUseCase()`, `createInputValue()`
- **Forms/tests**: `insertForm()`, `insertTestCase()`, `createTestRun()`, `completeTestRun()`
- **Issues**: `createIssue()`, `getIssuesByRun()`
- **Other**: AI usage tracking, report emails, component saving

All methods communicate via HTTP with `X-Scanner-Key` header authentication.

## Detectors

### Link Checker
Extracts all `<a href>` links from HTML, resolves relative URLs, sends HEAD requests to same-origin links. Reports 4xx/5xx as broken links with status code, URL, and link text.

### Visual Checker
- Broken images: `<img>` with empty/invalid `src`
- Missing alt text on images
- Duplicate element IDs
- Duplicate heading text
- Empty links (no text, no img alt, no aria-label)

### Content Checker
- Placeholder text: Lorem ipsum, TODO, FIXME, test@test, etc.
- Error page patterns: 404, 500, 503, "Something went wrong"
- Invalid prices: zero or negative amounts
- Very short pages (<50 chars, likely error states)

### Functional Checker
- Console error filtering (ignores common noise: favicon, extension errors, CORS warnings)
- Network response analysis (5xx errors, failed requests)
- Error-after-click detection

## Key Constants

```typescript
SCAN_TIMEOUT_MS = 300_000        // 5 min total scan timeout
ACTION_TIMEOUT_MS = 10_000       // 10 sec per action
TEST_TIMEOUT_MS = 30_000         // 30 sec per test
NETWORK_IDLE_TIMEOUT_MS = 5_000  // 5 sec network idle
POST_ACTION_SETTLE_MS = 2_000    // 2 sec post-action settle
HOVER_DELAY_MS = 500             // 500ms hover delay
MAX_PAGE_LIMIT = 100             // Max pages per run
MAX_E2E_PATHS = 20               // Max end-to-end test paths
MAX_E2E_DEPTH = 6                // Max steps in E2E path
SCREENSHOT_QUALITY = 72          // JPEG quality
DEFAULT_WORKERS = 3              // Concurrent test workers
```

## Page State Hashing

`computeHashes()` creates 4 hashes for deduplication:
- **htmlHash**: SHA-256 of raw HTML (detects any change)
- **normalizedHtmlHash**: SHA-256 of whitespace-normalized HTML (structural changes only)
- **textHash**: SHA-256 of visible text only (content changes)
- **actionableHash**: SHA-256 of sorted visible interactive items (UI state changes like dropdowns)

## Dependencies

**Peer (required)**:
- `@sudobility/testomniac_types` ^0.0.21

**Peer (optional)**:
- `openai` >=6.0.0
- `react` >=18.0.0

**Dev**: TypeScript ~5.9.3, Vitest 4, ESLint 9, Prettier 3

## Related Projects (Testomniac Ecosystem)

This library is the **shared foundation** consumed by both scanning clients:

- **testomniac_scanner** — Server-side Puppeteer worker. Imports `BrowserAdapter`, `ApiClient`, all detectors, scanner modules, and constants. Implements `PuppeteerAdapter`.
- **testomniac_extension** — Chrome extension. Imports `BrowserAdapter`, `ApiClient`, constants. Implements `ChromeAdapter`.
- **testomniac_api** — REST API backend that `ApiClient` communicates with. Stores all scan data.
- **testomniac_types** (`@sudobility/testomniac_types`) — Shared type definitions re-exported by this library.

## Coding Patterns

- **Pure functions for detectors**: All detector modules export pure functions that take HTML/text and return issue arrays. No side effects, easy to test.
- **Interface-driven browser abstraction**: `BrowserAdapter` is a plain TypeScript interface, not a class. Implementations in consumer packages.
- **Singleton API client**: `getApiClient(baseUrl, apiKey)` returns a cached instance. Call once during initialization.
- **Colocated tests**: Test files live next to source files (`*.test.ts` pattern). Run with `bun run test`.
- **Hash-based dedup**: Page states are compared via 4-level hashing, not string equality.
- **Constants, not config**: Timeouts, limits, and patterns are hardcoded constants. To change them, edit `config/constants.ts` and republish.

## Gotchas

- **Published to npm**: This is a library, not an application. Changes require `bun run verify` + `npm publish`. Consumer packages must update their dependency version.
- **No runtime dependencies**: All dependencies are peer or dev. Consumers must provide `@sudobility/testomniac_types` at minimum.
- **`computeHashes` needs crypto**: Uses Node.js `crypto.createHash('sha256')`. The extension shims this via `SubtleCrypto`; the scanner uses Node.js crypto natively.
- **Constants are compile-time**: Changing a constant requires republishing. Consumer packages pick up changes only after updating their dependency.
- **LoopGuard caps are per-instance**: Each scanner run creates its own `LoopGuard` instance. The 200/5000 limits apply per run, not globally.
- **No logging**: This library does not import any logger. Consumers are responsible for logging around detector/scanner calls.
