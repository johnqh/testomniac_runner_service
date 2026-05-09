# testomniac_runner_service

Shared scanning and test-generation engine for Testomniac.

This package owns the browser-automation abstraction and the logic that turns a
URL or page state into persisted test coverage.

## What It Does

The runner service provides:

- A `BrowserAdapter` interface used by different runtimes
- Page discovery and capture
- DOM/actionable-item extraction
- Page decomposition into scaffolds and patterns
- Rule/expertise-based finding generation
- Test-case and test-action generation
- Test execution loops

It is consumed by the Chrome extension today, and its browser abstraction is
designed to support server-side runners as well.

## Main Entry Points

- [src/adapter.ts](/Users/johnhuang/projects/testomniac_runner_service/src/adapter.ts)
  Browser runtime contract
- [src/index.ts](/Users/johnhuang/projects/testomniac_runner_service/src/index.ts)
  Package exports
- [src/orchestrator/runner.ts](/Users/johnhuang/projects/testomniac_runner_service/src/orchestrator/runner.ts)
  Suite/bundle execution loop exported as `runTestRun`
- [src/orchestrator/test-case-executor.ts](/Users/johnhuang/projects/testomniac_runner_service/src/orchestrator/test-case-executor.ts)
  Executes a single persisted test case in the newer runner
- [src/analyzer/page-analyzer.ts](/Users/johnhuang/projects/testomniac_runner_service/src/analyzer/page-analyzer.ts)
  Owns discovery-time target page state creation and follow-up case generation

## Coverage Model

The package creates coverage in two complementary ways:

1. Direct navigation coverage
   Every discovered same-origin path gets a navigation case
2. Stateful interaction coverage
   `PageAnalyzer` uses observed target page states to generate actionable
   interaction coverage, scaffold-driven flows, and page-content flows

As test actions execute, newly reached states are captured and turned into more
coverage.

## Browser Runtime

The browser runtime is intentionally abstracted behind `BrowserAdapter`.
Current adapter implementations include:

- The Chrome extension adapter in `testomniac_extension`
- Potential server/browser adapters for non-extension execution

## Local Development

```bash
bun install
bun run typecheck
bun test
bun run build
```

## Related Repos

- `testomniac_api`
  Persistence and run orchestration API
- `testomniac_extension`
  Chrome extension that invokes this package
- `testomniac_types`
  Shared request, response, and domain types
