# Hover Interaction Execution Model

## Purpose

This document defines the intended hover-first discovery and execution logic in
`testomniac_runner_service`.

The key rule is:

- when a navigation interaction lands on a page, hover interactions generated
  from that page state must run before lower-priority sibling interactions

## Terms

- root interaction: the interaction that reached the current page state
- dependency interaction: the parent interaction referenced by
  `dependencyTestInteractionId`
- hover interaction: an interaction tagged as hover and intended to reveal
  additional UI state
- click follow-up: a click interaction created from a hover interaction when the
  hover does not change the page state

## Required Flow

### 1. Navigation lands on a page

Suppose interaction `1` is a navigation to `/`.

After interaction `1` executes, `PageAnalyzer` inspects the resulting page
state and breaks it down into:

- scaffolds
- patterns
- actionable items
- forms

From that page state, the analyzer creates additional test interactions.

Rules:

- generated interactions must set `dependencyTestInteractionId = 1`
- hover interactions must have the highest execution priority among generated
  siblings from that page state

### 2. Executor walks the interaction tree

Execution is tree-based, not flat.

For a given completed interaction:

1. find pending interactions whose `dependencyTestInteractionId` points to that
   completed interaction
2. sort those children by priority
3. run the first child
4. repeat recursively for that child branch before moving to unrelated siblings

This means the executor should always prefer the active dependency branch over
unrelated pending interactions.

### 3. Navigation should pick hover first

If interaction `1` is a navigation, and the analyzer generated hover
interactions plus non-hover sibling interactions from that page state, the next
interaction selected by the executor should be a hover interaction.

Example:

- interaction `1`: navigate to `/`
- interaction `2`: hover on menu item 1

The executor should choose interaction `2` before lower-priority sibling
interactions generated from the same page state.

### 4. Hover with no page-state change creates click follow-up

If interaction `2` is a hover on menu item 1 and the resulting page state does
not change, the analyzer should create a click follow-up.

Example:

- interaction `2`: hover on menu item 1
- interaction `3`: click on menu item 1

Rules:

- interaction `3` must set `dependencyTestInteractionId = 2`
- the executor should run interaction `3` next because it is the first child of
  interaction `2`

### 5. Hover that reveals a popup menu creates nested hover interactions

If interaction `2` reveals a popup or submenu, the analyzer should create new
hover interactions for the revealed menu items.

Example:

- interaction `2`: hover on menu item 1
- interaction `4`: hover on submenu item 1
- interaction `5`: hover on submenu item 2

Rules:

- each revealed hover interaction must set
  `dependencyTestInteractionId = 2`
- these children should again be sorted so hover runs before lower-priority
  sibling interactions

### 6. Nested hover uses the same rule

If interaction `4` does not change the page state, the analyzer should create a
click follow-up for that hovered submenu item.

Example:

- interaction `4`: hover on submenu item 1
- interaction `6`: click on submenu item 1

Rules:

- interaction `6` must set `dependencyTestInteractionId = 4`
- the executor should treat this the same way as any other dependency branch:
  run the child click before moving away from the branch

## Invariants

These invariants should hold:

- generated child interactions always point to the interaction that revealed the
  state they depend on
- hover interactions are the highest-priority generated siblings for a newly
  reached page state
- executor selection is dependency-first, then priority-ordered
- a hover that does not reveal a new page state produces a click follow-up on
  the same branch
- a hover that reveals additional menu items produces new hover children on the
  same branch

## Example Tree

```text
1  Navigate to /
├─ 2  Hover menu item 1
│  ├─ 3  Click menu item 1              (if hover does not change page state)
│  ├─ 4  Hover submenu item 1           (if hover reveals submenu)
│  │  └─ 6  Click submenu item 1        (if nested hover does not change page state)
│  └─ 5  Hover submenu item 2
└─ 7  Lower-priority non-hover sibling interaction
```

Expected traversal:

1. run `1`
2. run `2`
3. if `2` has children, stay on branch `2` and run its highest-priority child
4. only after branch `2` is exhausted should the executor move to unrelated
   siblings such as `7`

## Implementation Expectations

`PageAnalyzer` is responsible for:

- identifying hover candidates from a page state
- assigning hover-first priority
- attaching correct `dependencyTestInteractionId` values
- creating click follow-ups when a hover does not change state
- creating nested hover interactions when a hover reveals more actionable items

The executor is responsible for:

- loading pending interactions for the current surface run
- finding children of the active dependency branch
- sorting children by priority
- executing the highest-priority child first
- continuing depth-first down the branch before returning to unrelated siblings

## Debugging Questions

When hover does not run next, one of these is wrong:

1. the analyzer did not generate hover interactions
2. generated hover interactions did not get
   `dependencyTestInteractionId` set correctly
3. hover interactions were generated with the wrong priority
4. the executor did not prefer dependency-branch children
5. the executor sorted sibling interactions incorrectly
6. hover runs were created but never selected from the pending queue
