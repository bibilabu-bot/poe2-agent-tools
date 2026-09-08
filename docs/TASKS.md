# Task registry

This file is the canonical task queue. Only the project controller changes task status to `ACCEPTED`.

Status values: `READY`, `IN_PROGRESS`, `REVIEW`, `ACCEPTED`, `BLOCKED`, `CANCELLED`.

## Active milestone: M1 — Reliable engineering baseline

### P2AT-001 — Establish the automated test harness

- Status: `ACCEPTED`
- Priority: P0
- Assignment target: `Codex local executor`
- Owner: completed by Codex executor
- Depends on: none
- Scope: `apps/planner-desktop`, repository CI/config documentation as required
- Delivery: `25e5284`; accepted and merged by controller in `72cf0b3`

Goal: create a small, repeatable test harness that can exercise pure planner behavior without launching Electron or depending on live network data.

Acceptance criteria:

1. `npm test` exists in `apps/planner-desktop` and exits successfully on the committed baseline.
2. At least one meaningful pure behavior is extracted from `renderer/planner.js` into a testable module without changing user-visible behavior.
3. Tests cover happy-path and edge/failure cases for that behavior.
4. `npm run check` continues to pass and checks the new module/test syntax where appropriate.
5. No live HTTP request or Electron binary is required to run tests.
6. README or contributor documentation states the exact local test command.
7. Executor supplies the required handoff evidence from `AGENTS.md`.

Non-goals:

- broad planner refactoring;
- changing allocation rules;
- adding a UI test framework;
- implementing Build persistence;
- modifying the Web snapshot.

### P2AT-002 — Add continuous integration

- Status: `ACCEPTED`
- Priority: P0
- Assignment target: `Codex local executor`
- Depends on: P2AT-001
- Scope: `.github/workflows/`, desktop package scripts, jewel compiler checks, supporting documentation only
- Delivery: `27a89b6`; accepted and merged by controller in `a93dcfc`

Goal: run deterministic syntax, unit-test and fixture-compiler checks for pushes and pull requests.

Acceptance criteria:

1. A GitHub Actions workflow runs for pull requests and pushes to `main`.
2. CI uses Node.js 20 and installs desktop dependencies without requiring the Electron runtime binary to download or launch.
3. CI runs `npm test` and `npm run check` in `apps/planner-desktop`.
4. CI syntax-checks both jewel compiler scripts and runs the fixture compiler successfully.
5. The workflow does not modify tracked fixture output or leave an unexplained dirty working tree.
6. Commands used by CI are documented and can be reproduced locally.
7. No deployment, release publishing, secrets or broad dependency upgrades are introduced.

Non-goals:

- application packaging;
- UI/browser automation;
- adding third-party CI services;
- refactoring planner or compiler logic.

### P2AT-003 — Define Build JSON schema and migration policy

- Status: `READY`
- Priority: P1
- Assignment target: `ChatGPT chat executor`
- Depends on: none
- Scope: research/design artifact for proposed `docs/BUILD_FORMAT.md`; read-only analysis of desktop planner and preload interfaces

Goal: specify a versioned, forward-migratable persistence contract before connecting UI state.

Acceptance criteria:

1. Deliver a complete Markdown artifact suitable for `docs/BUILD_FORMAT.md`, not an outline.
2. Define a top-level schema version, stable field names and representative JSON examples.
3. Cover current normal, ascendancy, weapon-set, hidden/instill allocation, class selection, budgets and display-independent identifiers where supported by the existing code.
4. Separate required persisted build state from optional UI/session state.
5. Define validation behavior for malformed, unknown, duplicate and no-longer-existing node identifiers.
6. Define forward/backward migration rules, unknown-field preservation policy and atomic save expectations.
7. Map every proposed field to existing planner state or explicitly mark it as future work; do not invent unsupported runtime behavior silently.
8. Identify security/privacy considerations for opening user-supplied JSON.
9. List unresolved decisions that require controller approval before implementation.

Non-goals:

- editing repository files or committing a branch;
- implementing save/open behavior;
- refactoring planner state;
- choosing a database;
- designing cloud synchronization.

### P2AT-004 — Connect desktop Build save/open

- Status: `BLOCKED`
- Priority: P1
- Assignment target: `Codex local executor`
- Depends on: P2AT-001, P2AT-003

Goal: connect planner state to the existing safe IPC save/open boundary.

### P2AT-005 — Inventory and pin upstream data sources

- Status: `READY`
- Priority: P1
- Assignment target: `ChatGPT chat executor`
- Depends on: none

Goal: document provenance, license/attribution needs, update cadence and a pinning strategy for each runtime/compiler source.

## Backlog

- P2AT-006: split graph and pathfinding from the renderer.
- P2AT-007: split allocation state and undo/redo from the renderer.
- P2AT-008: integrate normalized jewel compiler output.
- P2AT-009: add Windows packaging and release automation.
- P2AT-010: establish performance fixtures and benchmarks.
