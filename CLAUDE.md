# Testomniac Scanning Service

Shared TypeScript library containing all core scanning business logic, browser abstraction, extractors, planners, detectors, AI analysis, test generation, scan orchestration, and API client for the Testomniac testing platform.

**Package**: `@sudobility/testomniac_scanning_service` v0.1.1 (published to npm, public)

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
├── index.ts                        # Public API exports (all modules below)
├── adapter.ts                      # BrowserAdapter interface definition
├── api/
│   └── client.ts                   # ApiClient — HTTP client for testomniac_api (55+ methods)
├── browser/
│   ├── dom-snapshot.ts             # buildDomSnapshot: two-pass DOM element discovery
│   ├── page-utils.ts              # normalizeHtml, computeHashes (async sha256: Node + browser)
│   └── page-utils.test.ts
├── config/
│   └── constants.ts               # Timeouts, limits, URL patterns, error patterns
├── extractors/                     # Modular element extraction system (11 files)
│   ├── index.ts                   # extractActionableItems — registers extractors in priority order
│   ├── types.ts                   # ItemExtractor, DomSnapshotEntry, ExtractorCandidate, ActionKind
│   ├── helpers.ts                 # createCandidate, withResolvedSelector, uniqueBySelector
│   ├── selectors.ts               # classifyActionKind: navigate|select|fill|toggle|click
│   ├── text-inputs.ts             # <input>, <textarea>, role="textbox", contenteditable
│   ├── selects.ts                 # <select>, role="combobox"
│   ├── toggles.ts                 # checkbox, radio, role="switch"
│   ├── product-actions.ts         # E-commerce actions (cart, checkout, options)
│   ├── buttons.ts                 # <button>, input[type="submit"]
│   ├── clickables.ts              # Remaining clickable elements (links, divs, etc.)
│   └── form-extractor.ts          # extractForms: discover form structures
├── planners/
│   └── fill-value-planner.ts      # RuleBasedFillValuePlanner: multi-signal form value heuristics
├── detectors/                      # Page-level quality checks + bug/modal detection
│   ├── index.ts                   # Re-exports all detectors
│   ├── bug-detector.ts            # Comprehensive bug detection (broken links, visual, content, media)
│   ├── modal-handler.ts           # Detect & dismiss Bootstrap, ARIA dialog, Fancybox, etc.
│   ├── link-checker.ts            # Broken link detection (HEAD requests, 4xx/5xx)
│   ├── visual-checker.ts          # Broken images, missing alt, duplicate IDs/headings, empty links
│   ├── content-checker.ts         # Placeholder text, error pages, invalid prices, short pages
│   ├── functional-checker.ts      # Console errors, network failures, error-after-click
│   └── *.test.ts                  # Colocated tests
├── ai/                             # AI analysis pipeline (GPT-4o)
│   ├── analyzer.ts                # runAiAnalysis: orchestrates persona → use case → input generation
│   ├── persona-generator.ts       # Generate 1-5 user personas from page content
│   ├── use-case-generator.ts      # Generate 2-8 use cases per persona
│   ├── input-generator.ts         # Generate realistic form inputs per use case
│   └── token-tracker.ts           # AI token usage tracking (reported to API)
├── generation/                     # Test case generation (9 template files)
│   ├── generator.ts               # generateTestCases: orchestrator
│   ├── suite-tagger.ts            # Priority assignment (critical → low) by route keywords
│   ├── render.ts                  # Render test template (navigate + assert visibility)
│   ├── interaction.ts             # Interaction test template (click/hover sequences)
│   ├── form.ts                    # Form positive test template
│   ├── form-negative.ts           # Form negative/validation test template
│   ├── password.ts                # Password requirement test template
│   ├── navigation.ts              # Navigation flow test template
│   └── e2e.ts                     # E2E multi-step path enumeration + template
├── orchestrator/                   # Scan pipeline orchestration
│   ├── types.ts                   # ScanConfig, ScanEventHandler, TestExecutor, ScanResult, ScanPhase
│   ├── orchestrator.ts            # runScan(adapter, config, api, eventHandler, testExecutor?)
│   ├── mouse-scanning.ts          # Phase 1a: navigate → extract → hover/click → detect → discover
│   ├── ai-analysis.ts             # Phase 1b: GPT-4o persona/use case/input generation
│   ├── input-scanning.ts          # Phase 1c: pairwise form filling with AI-generated values
│   ├── test-generation.ts         # Phase 3: JSON test case creation
│   └── test-execution.ts          # Phase 4: test execution via TestExecutor interface
├── scanner/                        # Scanner utility modules
│   ├── action-classifier.ts       # normalizeHref, shouldExpectNavigation, getActionPriority
│   ├── navigator.ts               # Cross-page navigation tracking
│   ├── action-queue.ts            # In-memory action queue
│   ├── state-manager.ts           # Page state tracker
│   ├── loop-guard.ts              # Action dedup + caps (200/page, 5000 total)
│   ├── phase-timer.ts             # Per-phase duration tracking
│   ├── component-detector.ts      # Reusable UI component detection across pages
│   ├── email-detector.ts          # Email verification flow detection
│   ├── scroll-scanner.ts          # Lazy-loaded element discovery via scrolling
│   ├── pairwise.ts                # Pairwise combination generator
│   ├── issue-detector.ts          # detectDeadClick, detectErrorOnPage, detectConsoleErrors
│   └── *.test.ts                  # Colocated tests
├── plugins/                        # Plugin interface + registry
│   ├── types.ts                   # Plugin, PluginContext, PluginResult, PluginIssue interfaces
│   └── registry.ts                # registerPlugin, getPlugin, getEnabledPlugins
└── domain/
    ├── types.ts                   # Re-exports from @sudobility/testomniac_types
    └── url-ownership.ts           # normalizeBaseUrl, getRegistrableDomain, emailMatchesUrlDomain
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

## Main Entry Point: `runScan()`

The orchestrator is the primary consumer API. Both `testomniac_scanner` and `testomniac_extension` call it:

```typescript
runScan(
  adapter: BrowserAdapter,    // ChromeAdapter or PuppeteerAdapter
  config: ScanConfig,         // runId, appId, baseUrl, phases, options
  api: ApiClient,             // HTTP client for testomniac_api
  eventHandler: ScanEventHandler,  // Progress callbacks
  testExecutor?: TestExecutor      // Optional test runner (server-side only)
): Promise<ScanResult>
```

### ScanConfig

```typescript
interface ScanConfig {
  runId: number;
  appId: number;
  baseUrl: string;
  phases: ScanPhase[];          // ["mouse_scanning", "ai_analysis", "input_scanning", ...]
  sizeClass?: string;
  openaiApiKey?: string;
  openaiModel?: string;
  testWorkerCount?: number;
}
```

### ScanEventHandler

Callback interface for progress reporting. Consumers implement this to bridge events to their UI (side panel messages for extension, Pino logging for scanner):

```typescript
interface ScanEventHandler {
  onPageFound(page): void;
  onPageStateCreated(state): void;
  onActionCompleted(action): void;
  onIssueDetected(issue): void;
  onPhaseChanged(phase): void;
  onStatsUpdated(stats): void;
  onScreenshotCaptured(data): void;
  onScanComplete(summary): void;
  onError(error): void;
}
```

### TestExecutor

Optional interface for test execution. Only the server-side scanner provides this (via Puppeteer worker pool):

```typescript
interface TestExecutor {
  executeTestCase(actions: TestAction[], screen: Screen): Promise<{ passed: boolean; error?: string; durationMs: number }>;
}
```

## Scan Pipeline Phases

```
Phase: mouse_scanning
  Navigate → buildDomSnapshot → extractActionableItems → hover/click each →
  bug detection → modal dismissal → discover pages → enqueue
  Output: pages, page_states, actionable_items, actions, issues

Phase: ai_analysis
  Feed page content to GPT-4o → generate personas, use cases, input values
  Output: personas, use_cases, input_values

Phase: input_scanning
  Fill forms with pairwise combinations of AI-generated values
  Output: form fill actions, new page_states

Phase: test_generation
  Create JSON test cases: render, interaction, form, navigation, E2E
  Assign priority tags based on route keywords
  Output: test_cases with actions_json

Phase: test_execution
  Delegate to TestExecutor interface for actual execution
  Output: test_runs (pass/fail), issues for failures
```

## BrowserAdapter Interface

The core abstraction that allows the same scanning logic to work with both Puppeteer (server-side scanner) and Chrome DevTools Protocol (browser extension):

```typescript
interface BrowserAdapter {
  goto(url, options?): Promise<void>
  waitForNavigation(options?): Promise<void>
  url(): Promise<string>
  content(): Promise<string>
  evaluate<T>(fn, ...args): Promise<T>
  waitForSelector(selector, options?): Promise<void>
  click(selector, options?): Promise<void>
  hover(selector, options?): Promise<void>
  type(selector, text): Promise<void>
  select(selector, value): Promise<void>
  pressKey(key): Promise<void>
  screenshot(options?): Promise<Uint8Array>
  setViewport(width, height): Promise<void>
  on(event, handler): void
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
- **Other**: AI usage tracking, report emails, component saving, `getApp()`

All methods communicate via HTTP with `X-Scanner-Key` header authentication.

## Extractors

The extraction system uses a two-pass approach in `dom-snapshot.ts`:

**Pass 1**: Query comprehensive CSS selectors for interactive elements (inputs, buttons, links, ARIA roles, event handlers, tabindex, contenteditable)

**Pass 2**: Find `cursor:pointer` elements missed by Pass 1 (framework-specific clickable divs, etc.)

6 extractors registered in priority order: textInputs, selects, toggles, productActions, buttons, clickables. Each returns candidates that are deduplicated and classified into action kinds: `navigate`, `select`, `fill`, `toggle`, `click`.

## Detectors

### Bug Detector
Comprehensive bug detection combining broken link checking, visual analysis, content analysis, and media issues. Runs inline during mouse scanning.

### Modal Handler
Detects and dismisses Bootstrap, Popup Maker, ARIA dialog, Fancybox modals. Uses close button, overlay click, or Escape key.

### Link Checker / Visual Checker / Content Checker / Functional Checker
Individual page-level quality check modules. Pure functions that take HTML/text and return issue arrays.

## Fill Value Planner

`RuleBasedFillValuePlanner` uses multi-signal heuristics for form field values:
1. HTML input type (email, password, tel, date, etc.)
2. HTML5 autocomplete attribute
3. Keyword matching on combined signals (name, id, placeholder, label) — English, Spanish, French, German
4. Default by tag

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

`computeHashes()` is **async** and uses universal SHA-256 (Node.js `crypto.createHash` when available, falls back to Web `crypto.subtle` for browser environments). Creates 4 hashes for deduplication:
- **htmlHash**: SHA-256 of raw HTML
- **normalizedHtmlHash**: SHA-256 of whitespace-normalized HTML
- **textHash**: SHA-256 of visible text only
- **actionableHash**: SHA-256 of sorted visible interactive items

## Dependencies

**Peer (required)**:
- `@sudobility/testomniac_types` ^0.0.21

**Peer (optional)**:
- `openai` >=6.0.0
- `react` >=18.0.0

**Dev**: TypeScript ~5.9.3, Vitest 4, ESLint 9, Prettier 3

## Related Projects (Testomniac Ecosystem)

This library is the **shared foundation** consumed by both scanning clients:

- **testomniac_scanner** — Server-side Puppeteer worker. Thin wrapper that calls `runScan()` with `PuppeteerAdapter` and a `TestExecutor` backed by a worker pool. Provides auth, email, runner, and plugin implementations.
- **testomniac_extension** — Chrome extension. Thin wrapper that calls `runScan()` with `ChromeAdapter`. Only runs `mouse_scanning` phase. Bridges events to side panel UI.
- **testomniac_api** — REST API backend that `ApiClient` communicates with. Stores all scan data.
- **testomniac_types** (`@sudobility/testomniac_types`) — Shared type definitions re-exported by this library.

## Coding Patterns

- **`runScan()` is the single entry point**: Both consumers call `runScan()` with their adapter, config, and event handler. All scanning phases, extraction, detection, and orchestration are managed internally.
- **Pure functions for detectors**: All detector modules export pure functions that take HTML/text and return issue arrays. No side effects, easy to test.
- **Interface-driven browser abstraction**: `BrowserAdapter` is a plain TypeScript interface, not a class. Implementations in consumer packages.
- **Singleton API client**: `getApiClient(baseUrl, apiKey)` returns a cached instance. Call once during initialization.
- **Async `computeHashes`**: Uses a universal `sha256()` that auto-detects Node vs browser runtime. Callers must `await` it.
- **Colocated tests**: Test files live next to source files (`*.test.ts` pattern). Run with `bun run test`.
- **Hash-based dedup**: Page states are compared via 4-level hashing, not string equality.
- **Constants, not config**: Timeouts, limits, and patterns are hardcoded constants. To change them, edit `config/constants.ts` and republish.
- **Plugin interface is defined here, implementations live in consumers**: `Plugin`, `PluginContext`, `PluginResult` types and the registry are in this library. Actual plugin code (SEO, security, content, UI consistency) lives in `testomniac_scanner`.

## Gotchas

- **Published to npm**: This is a library, not an application. Changes require `bun run verify` + `npm publish`. Consumer packages must update their dependency version.
- **No runtime dependencies**: All dependencies are peer or dev. Consumers must provide `@sudobility/testomniac_types` at minimum.
- **`computeHashes` is async**: Uses `await sha256()` internally with universal Node + browser support. The extension shims `node:crypto` via `SubtleCrypto` at the Vite level, but `page-utils.ts` also has its own runtime detection.
- **Constants are compile-time**: Changing a constant requires republishing. Consumer packages pick up changes only after updating their dependency.
- **LoopGuard caps are per-instance**: Each scanner run creates its own `LoopGuard` instance. The 200/5000 limits apply per run, not globally.
- **No logging**: This library does not import any logger. Consumers are responsible for logging around detector/scanner calls.
- **Plugin types reference Puppeteer and OpenAI**: `PluginContext` in `plugins/types.ts` references `Page` from `puppeteer-core` and `OpenAI`. These are optional peer dependencies. The extension does not use plugins.
- **`buildDomSnapshot` runs inside `page.evaluate()`**: The DOM snapshot code executes in the browser context. It cannot reference Node.js modules or closures from the calling scope.
