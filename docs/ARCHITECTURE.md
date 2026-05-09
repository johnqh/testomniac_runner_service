# Testomniac Runner Service Architecture

## Purpose

`testomniac_runner_service` is the execution and discovery engine for
Testomniac. It sits between:

- a browser runtime, exposed through `BrowserAdapter`
- the persistence layer, exposed through `ApiClient`
- domain logic for coverage generation, expertise evaluation, and run execution

Its job is to:

- execute persisted test structures
- inspect resulting page states
- evaluate outcomes with expertises
- expand coverage when a run is marked as discovery

## Core Components

### BrowserAdapter

[`src/adapter.ts`](/Users/johnhuang/projects/testomniac_runner_service/src/adapter.ts)
defines the browser contract.

The runner never talks directly to Puppeteer, Playwright, or Chrome APIs. It
only uses `BrowserAdapter` methods such as:

- `goto`
- `click`
- `hover`
- `type`
- `waitForNavigation`
- `content`
- `screenshot`
- `on("console" | "response")`

This keeps execution logic portable across runtimes.

### ApiClient

[`src/api/client.ts`](/Users/johnhuang/projects/testomniac_runner_service/src/api/client.ts)
is the persistence boundary.

The runner uses it to read and write:

- test runs, suite runs, and case runs
- test suites, test cases, and test actions
- pages and page states
- findings
- discovery artifacts such as scaffolds and actionable items

### Expertises

Expertises are rule-based evaluators under
[`src/expertise`](/Users/johnhuang/projects/testomniac_runner_service/src/expertise).

They inspect an observed result and produce `Outcome`s. The default set is
constructed by `createDefaultExpertises()` and currently includes:

- tester
- SEO
- security
- performance
- content
- UI
- accessibility

Expertises do not own discovery. They evaluate an already-observed result.

### PageAnalyzer

[`src/analyzer/page-analyzer.ts`](/Users/johnhuang/projects/testomniac_runner_service/src/analyzer/page-analyzer.ts)
owns discovery-time interpretation of result page states.

Its responsibilities are:

- generate baseline expectations for discovery runs
- interpret the target page state reached by a test case
- create follow-up test cases and test case runs
- organize generated coverage into suites within the current bundle run

`PageAnalyzer` is the object responsible for target-page-state setup in
discovery mode. That responsibility should not be pushed down into the generic
executor.

## Execution Model

The package uses one orchestration model.

### Suite/Bundle Runner

[`src/orchestrator/runner.ts`](/Users/johnhuang/projects/testomniac_runner_service/src/orchestrator/runner.ts)
exports `runTestRun()`.

This is the structured execution model built around:

- `test_suite_bundle`
- `test_suite`
- `test_case`
- `test_suite_bundle_run`
- `test_suite_run`
- `test_case_run`

High-level flow:

1. Claim the root test run
2. Load the run and its bundle run
3. If `testRun.discovery` is true, create a `PageAnalyzer`
4. Repeatedly fetch open suite runs in the bundle
5. Repeatedly fetch open case runs in the current suite run
6. Execute each case through `executeTestCase()`
7. Complete suite runs, then the bundle run, then the root test run

This is the execution architecture of the system.

## Test Case Execution Boundary

[`src/orchestrator/test-case-executor.ts`](/Users/johnhuang/projects/testomniac_runner_service/src/orchestrator/test-case-executor.ts)
executes one persisted test case.

Its responsibilities are:

- load the test case
- navigate to the starting path
- execute the stored actions
- collect console and network artifacts
- extract the observed DOM state
- run expertises against that observed state
- persist findings and mark the case run complete

Important boundary:

- when `discovery` is `false`, execution is just execution plus validation
- when `discovery` is `true`, `executeTestCase()` delegates discovery expansion
  to `PageAnalyzer`

The executor should not become the owner of discovery logic. It should observe
and delegate.

## Discovery Model

Discovery is controlled by the `testRun.discovery` flag.

When `discovery` is false:

- a case run executes a persisted test case
- expertises evaluate the observed result against the case expectations
- no discovery-driven case generation should occur

When `discovery` is true:

- the executor still runs the test case and expertises
- `PageAnalyzer` is additionally invoked
- `PageAnalyzer` interprets the reached target state and creates new coverage

This separation is intentional:

- expertises answer, "Was the observed result acceptable?"
- `PageAnalyzer` answers, "What new coverage should exist because we reached
  this state?"

## Coverage Generation

Coverage is generated from observed page states.

In the current architecture, this includes:

- direct navigation coverage for discovered links
- interaction coverage for actionable elements
- scaffold-driven grouping of repeated UI structures
- page-content grouping for non-scaffold interactions

Generated coverage is persisted as test suites and test cases and attached to
the active bundle run through suite runs and case runs.

## Data Model

The runtime assumes this hierarchy:

1. Environment-scoped persistent definitions
2. Run-scoped execution records

Persistent definitions:

- `test_suite_bundle`
- `test_suite`
- `test_case`
- `test_action`

Execution records:

- `test_run`
- `test_suite_bundle_run`
- `test_suite_run`
- `test_case_run`
- `test_run_finding`

This split matters:

- definitions describe intended coverage
- run records describe one actual execution of that coverage

## Browser State Analysis Pipeline

After an action executes, the runner can inspect the result using:

- page HTML
- actionable item extraction
- scaffold detection
- pattern detection
- console logs
- network logs

These signals feed two separate consumers:

1. Expertises
   They evaluate quality, correctness, and regressions
2. PageAnalyzer
   It decides how the reached state should expand coverage in discovery mode

## Architectural Rules

The intended architecture is:

- `BrowserAdapter` owns browser control
- `ApiClient` owns persistence I/O
- `executeTestCase()` owns action execution and observation
- expertises own evaluation
- `PageAnalyzer` owns discovery-time target-state setup and follow-up case
  generation
- `runTestRun()` owns orchestration across bundle/suite/case runs

The most important rule is:

`PageAnalyzer` is the discovery object.

If a run needs to interpret a reached target page state and generate new test
cases, that logic belongs in `PageAnalyzer`, not in the generic executor.
