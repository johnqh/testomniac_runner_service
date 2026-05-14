# Testomniac Runner Service

Shared execution and discovery library used by Testomniac runner clients.

## Purpose

This package owns the active runtime architecture for:

- executing persisted test surfaces, cases, and element runs
- analyzing resulting browser states
- generating discovery-time follow-up coverage
- evaluating expertises and recording findings
- abstracting over the browser through `BrowserAdapter`
- abstracting over persistence through `ApiClient`

The legacy `runScan()` orchestration path has been removed. `runTestRun()` is
the runtime entry point.

## Core Model

Persistent coverage:

- `test_surface_bundle`
- `test_surface`
- `test_element`
- `test_action`

Run records:

- `test_run`
- `test_surface_bundle_run`
- `test_surface_run`
- `test_element_run`
- `test_run_finding`

## Execution Flow

1. A client calls `runTestRun()`.
2. The runner claims the `test_run`.
3. It loads the active bundle run and iterates pending surface runs.
4. For each surface run, it iterates pending element runs whose dependencies are
   ready.
5. `executeTestElement()` navigates, recreates dependency setup when needed,
   executes actions, gathers runtime artifacts, and runs expertises.
6. If the root run is a discovery run, `PageAnalyzer` creates or resolves the
   target page state and generates follow-up cases and runs.
7. The runner completes surface runs, bundle runs, and the root test run.

## Discovery Rules

- Every actionable element starts with a hover test element.
- After hover:
  - if no new actionable items appear, generate a dependent click test element
  - if new actionable items appear, generate dependent hover test elements from
    the hover target page state
- `PageAnalyzer` owns target-page-state creation and follow-up case generation.
- Expertises do not generate coverage.

## Key Components

- [`src/adapter.ts`](src/adapter.ts): browser abstraction
- [`src/api/client.ts`](src/api/client.ts): scanner API client
- [`src/orchestrator/runner.ts`](src/orchestrator/runner.ts): `runTestRun()`
- [`src/orchestrator/test-element-executor.ts`](src/orchestrator/test-element-executor.ts):
  single-case execution
- [`src/analyzer/page-analyzer.ts`](src/analyzer/page-analyzer.ts):
  discovery-time target-state and follow-up coverage logic
- [`src/expertise`](src/expertise): expertise system
- [`src/extractors`](src/extractors): actionable-item extraction
- [`src/scanner/component-detector.ts`](src/scanner/component-detector.ts):
  scaffold detection
- [`src/scanner/pattern-detector.ts`](src/scanner/pattern-detector.ts):
  pattern detection

## Expertise System

Seven expertise modules evaluate page state and create findings:

### TesterExpertise (`src/expertise/tester-expertise.ts`)
Evaluates 37+ expectation types via specialized checker modules:

| Category | Expectation Types |
|----------|------------------|
| **Page Load** | `page_loaded`, `page_responsive`, `loading_completes`, `media_loaded`, `video_playable` |
| **Console/Network** | `no_console_errors` (errors + significant warnings like "deprecated", "not found"), `no_network_errors` (4xx/5xx + status 0 DNS failures) |
| **Form Validation** | `validation_message_visible`, `error_state_visible`, `error_state_cleared`, `form_submitted_successfully`, `required_error_shown_for_field`, `field_error_clears_after_fix` |
| **Text Input** | `input_value` (text, phone, date, number, password, select inputs) |
| **Selection** | `element_checked`, `element_unchecked` (checkbox, radio, switch, tabs) |
| **Commerce** | `count_changed` (cart/quantity), `cart_summary_changed`, `collection_order_changed` |
| **Network Intent** | `network_request_made` (GET/POST/ANY), `no_duplicate_mutation_requests` |
| **Search** | `results_changed`, `results_restored`, `empty_state_visible` |
| **Navigation** | `url_unchanged`, `navigation_or_state_changed`, `variant_state_changed` |
| **Dialog** | `modal_opened`, `dialog_closed`, `focus_returned` |
| **Feedback** | `feedback_visible`, `feedback_not_duplicated` |
| **Keyboard** | `element_focused`, `expanded_state_changed` |
| **Persistence** | `state_persists_after_reload`, `back_navigation_restores_state`, `forward_navigation_reapplies_state` |
| **List** | `row_count_changed` |

### ContentExpertise (`src/expertise/content-expertise.ts`)
- Meaningful body text (min 120 chars)
- Single H1 heading
- Placeholder content detection (lorem ipsum, TODO, coming soon)
- Image alt text coverage
- Language consistency
- Broken link pattern detection (URL typos like `/stored/` instead of `/store/`)
- Label/context mismatch (e.g., "Select Shirt Size" on a coat product)
- Currency display consistency (selected currency matches price symbols)
- Duplicate element IDs
- Heading hierarchy gaps (h1 → h3 skipping h2)
- Hardcoded localhost/dev/staging URLs in production
- Outdated copyright year in footer
- Orphaned form labels (for="id" where ID doesn't exist)

### UiExpertise (`src/expertise/ui-expertise.ts`)
- Main content landmark presence
- Scaffold duplication (multiple headers/footers)
- Active error patterns on page load
- Interactive control density
- Social share button integrity (functional links vs dead divs)
- Breadcrumb consistency

### SecurityExpertise (`src/expertise/security-expertise.ts`)
- API keys in URLs
- Insecure HTTP requests

### PerformanceExpertise (`src/expertise/performance-expertise.ts`)
- Render-blocking resource failures
- Duplicate mutation requests (same POST/PUT called multiple times)
- Slow network responses (> 3 seconds)

### SeoExpertise (`src/expertise/seo-expertise.ts`)
- Title, meta description, keywords, canonical, Open Graph tags

### AccessibilityExpertise (`src/expertise/accessibility-expertise.ts`)
- Document language, main landmark, form label association, image alt text, dialog labeling

## Page Health Evaluator (`src/scanner/page-health-evaluator.ts`)

Browser-side checks running via `adapter.evaluate()` during each test interaction:

| Check | Detects |
|-------|---------|
| `broken_image` | Images with `naturalWidth === 0` (failed to load) |
| `element_overlap` | Interactive elements obscured by overlapping content (via `elementFromPoint`) |
| `dead_social_button` | Social share icons without links or click handlers |
| `cart_math_error` | Subtotal + shipping ≠ grand total |
| `grammar_error` | Singular/plural mismatches ("1 results"), result count vs actual item count |
| `defunct_service` | Links to MySpace, Google+, Vine |
| `missing_price` | Product pages without visible price or "Login for Pricing" |
| `inconsistent_grid` | Product grid items with >50% height deviation |
| Result count validation | "Showing N results" vs actual visible items |
| Filter count validation | Sidebar filter count sum vs total products |
| `empty_link` | Visible links with `href="#"` or empty href |
| `broken_anchor` | `href="#id"` where `#id` doesn't exist on page |
| `missing_noopener` | External `target="_blank"` links without `rel="noopener"` |

## Test Interaction Generators

Discovery-time generators in `src/analyzer/page-analyzer/generators/`:

| Generator | Surface | Test Types | Key Expectations |
|-----------|---------|------------|-----------------|
| `render.ts` | Render: {path} | render | page_loaded, no_network_errors, no_console_errors |
| `forms.ts` | Forms: {path} | form, form_negative, form_correction, password, search | validation, submission, network requests, feedback |
| `login.ts` | Login: {path} | form, interaction | error_visible (invalid/wrong creds), navigation_away (success), SSO clicks |
| `semantic-journeys.ts` | Journeys: {path} | semantic-journey | commerce flows, auth flows, CRUD operations with count/cart/network checks |
| `e2e.ts` | E2E: {path} | e2e | Dependency-chain multi-step journeys |
| `dialogs.ts` | Dialogs: {path} | dialog | dialog_closed, focus_returned (button + Escape) |
| `keyboard-disclosure.ts` | Keyboard: {path} | keyboard | expanded_state_changed, element_focused |
| `variants.ts` | Variants: {path} | variant | selection, purchase (add to cart), guard (required validation) |
| `content.ts` | Page: {path} | interaction | Click/hover/fill interactions on main page content |
| `scaffolds.ts` | Scaffold: {type} | interaction | Click/hover within headers, footers, sidebars |
| `navigation.ts` | Direct Navigations | navigation | Discovered same-origin link navigation |
| `hover-follow-up.ts` | (parent surface) | interaction | Follow-up clicks after hover reveals new elements |

## Login Flow (`src/orchestrator/login-manager.ts`)

- **LoginManager**: State machine with `isInLoginFlow` (suspends scope boundary) and `isLoggedIn` tracking
- **Login detection** (`src/scanner/login-detector.ts`): Heuristic signals — URL patterns, password fields, email+password forms, SSO buttons, login headings. Confidence: high/medium/low.
- **SSO handler** (`src/orchestrator/sso-handler.ts`): Provider-specific flows for Google, Microsoft, GitHub, Facebook, Apple, Twitter, LinkedIn, Okta, SAML with generic fallback.
- **Max 3 re-login attempts** before giving up.

## URL Scope Boundary (`src/crawler/scope-checker.ts`)

- `isWithinScopePath(url, baseUrl, scanScopePath)`: Checks same-origin + path prefix match
- Enforced at 3 points: link extraction, pre-execution, test generation
- Suspended during login flow via `LoginManager.isInLoginFlow()`

## AI Boundary

`PageAnalyzer` is not the AI pipeline. Structural decomposition in the active
runtime is deterministic. Separate AI helpers exist under `src/ai`, but they
are not the discovery orchestrator.

## Commands

```bash
bun run typecheck
bun run test
bun run build
```

## Related Packages

- `testomniac_extension`: Chrome-hosted runner client
- `testomniac_api`: persistence and read APIs
