# Testomniac Runner Service

Shared execution and discovery library used by Testomniac runner clients.

## Purpose

This package owns the active runtime architecture for:

- executing persisted test suites, cases, and case runs
- analyzing resulting browser states
- generating discovery-time follow-up coverage
- evaluating expertises and recording findings
- abstracting over the browser through `BrowserAdapter`
- abstracting over persistence through `ApiClient`

The legacy `runScan()` orchestration path has been removed. `runTestRun()` is
the runtime entry point.

## Core Model

Persistent coverage:

- `test_suite_bundle`
- `test_suite`
- `test_case`
- `test_action`

Run records:

- `test_run`
- `test_suite_bundle_run`
- `test_suite_run`
- `test_case_run`
- `test_run_finding`

## Execution Flow

1. A client calls `runTestRun()`.
2. The runner claims the `test_run`.
3. It loads the active bundle run and iterates pending suite runs.
4. For each suite run, it iterates pending case runs whose dependencies are
   ready.
5. `executeTestCase()` navigates, recreates dependency setup when needed,
   executes actions, gathers runtime artifacts, and runs expertises.
6. If the root run is a discovery run, `PageAnalyzer` creates or resolves the
   target page state and generates follow-up cases and runs.
7. The runner completes suite runs, bundle runs, and the root test run.

## Discovery Rules

- Every actionable element starts with a hover test case.
- After hover:
  - if no new actionable items appear, generate a dependent click test case
  - if new actionable items appear, generate dependent hover test cases from
    the hover target page state
- `PageAnalyzer` owns target-page-state creation and follow-up case generation.
- Expertises do not generate coverage.

## Key Components

- [`src/adapter.ts`](src/adapter.ts): browser abstraction
- [`src/api/client.ts`](src/api/client.ts): scanner API client
- [`src/orchestrator/runner.ts`](src/orchestrator/runner.ts): `runTestRun()`
- [`src/orchestrator/test-case-executor.ts`](src/orchestrator/test-case-executor.ts):
  single-case execution
- [`src/analyzer/page-analyzer.ts`](src/analyzer/page-analyzer.ts):
  discovery-time target-state and follow-up coverage logic
- [`src/expertise`](src/expertise): expertise system
- [`src/extractors`](src/extractors): actionable-item extraction
- [`src/scanner/component-detector.ts`](src/scanner/component-detector.ts):
  scaffold detection
- [`src/scanner/pattern-detector.ts`](src/scanner/pattern-detector.ts):
  pattern detection

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
