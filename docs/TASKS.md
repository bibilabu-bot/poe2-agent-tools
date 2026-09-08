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

- Status: `ACCEPTED`
- Priority: P1
- Assignment target: `ChatGPT chat executor`
- Owner: completed by ChatGPT chat executor; approved by controller and integrated through P2AT-003A
- Depends on: none
- Scope: research/design artifact for proposed `docs/BUILD_FORMAT.md`; read-only analysis of desktop planner and preload interfaces
- Delivery: complete `docs/BUILD_FORMAT.md` received by controller on 2026-09-08, accepted, and integrated through P2AT-003A

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

### P2AT-003A — Integrate the approved Build JSON contract

- Status: `REVIEW`
- Priority: P0
- Assignment target: `Codex local executor`
- Depends on: P2AT-003 research delivery
- Scope: `docs/BUILD_FORMAT.md`, `docs/DECISIONS.md`, `docs/TASKS.md`, `docs/PROJECT_STATUS.md`

Goal: integrate the accepted P2AT-003 artifact and controller decisions without redesigning or implementing persistence.

Controller decisions to encode:

1. U1 accepted: schema v1 uses canonical English names for `instilledPassives`; a durable-ID migration may follow later.
2. U2 accepted: schema v1 does not require a data-revision fingerprint; P2AT-005 may add provenance later.
3. U3 accepted limits: 5 MiB maximum file size; 20,000 entries per allocation array; 256 characters per known identifier/name; maximum validation traversal depth 64; retain/display at most 100 detailed diagnostics while preserving aggregate counts.
4. U4 accepted: write the optional schema-v1 `ui` object by default, while keeping it non-semantic.
5. U5 accepted: show one import summary with aggregate counts and at most 100 expandable details; never one modal per affected node.
6. Accept proposed ADR-006: Build JSON is a versioned durable compatibility boundary.

Acceptance criteria:

1. The complete approved artifact is committed as `docs/BUILD_FORMAT.md` with proposal language updated to accepted policy where necessary.
2. ADR-006 is appended to `docs/DECISIONS.md` with status `Accepted` and the controller decisions above are traceable.
3. P2AT-003 is marked `ACCEPTED`; P2AT-003A remains for controller acceptance and P2AT-004 stays `BLOCKED` until that acceptance.
4. `docs/PROJECT_STATUS.md` records the accepted schema-v1 contract.
5. No application code, schema implementation or unrelated documentation is changed.

### P2AT-004 — Connect desktop Build save/open

- Status: `BLOCKED`
- Priority: P1
- Assignment target: `Codex local executor`
- Depends on: P2AT-001, P2AT-003A
- Blocked by: P2AT-003A controller acceptance

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
