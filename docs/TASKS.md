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

- Status: `ACCEPTED`
- Priority: P0
- Assignment target: `Codex local executor`
- Depends on: P2AT-003 research delivery
- Scope: `docs/BUILD_FORMAT.md`, `docs/DECISIONS.md`, `docs/TASKS.md`, `docs/PROJECT_STATUS.md`
- Delivery: `100fd1a`; accepted and merged by controller in `727699b`

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

- Status: `ACCEPTED`
- Priority: P1
- Assignment target: `Codex local executor`
- Depends on: P2AT-004A, P2AT-004B, P2AT-004C
- Type: tracking task; implement through the bounded subtasks below
- Delivery: P2AT-004A/B/C accepted; completed by controller merge `c467d8e`

Goal: connect planner state to the existing safe IPC save/open boundary.

### P2AT-004A — Implement the pure Build schema codec

- Status: `ACCEPTED`
- Priority: P0
- Assignment target: `Codex local executor`
- Depends on: P2AT-001, P2AT-003A
- Scope: a new pure module under `apps/planner-desktop/renderer/`, its Node tests, and desktop test/check scripts or documentation as needed
- Delivery: `3071bf6`; accepted and merged by controller in `ac3dfb0`

Goal: implement deterministic schema-v1 document creation, structural validation, normalization, diagnostics and opaque preservation without DOM, Electron, filesystem or network dependencies.

Acceptance criteria:

1. The codec is usable in both the isolated browser renderer and Node tests without enabling `nodeIntegration`.
2. It enforces the accepted format discriminator, schema version, required fields and U3 limits from `docs/BUILD_FORMAT.md`.
3. It canonicalizes known fields, string node identifiers and deterministic array ordering without mutating caller input.
4. It reports fatal errors separately from bounded warnings/details.
5. It handles duplicates, cross-category redundancy, malformed known values and unsupported newer schema versions according to the contract.
6. It preserves unknown fields and unresolved identifiers in an inert sidecar/normalized representation suitable for later load/edit/save cycles.
7. Tests cover valid round trips, all allocation categories, unknown-field preservation, unresolved-ID preservation, duplicate handling, invalid limits, malformed structure and future-version rejection.
8. `npm test`, `npm run check` and CI remain green; no Electron binary or live network is required.

Non-goals:

- reading or writing files;
- changing Electron IPC;
- wiring buttons or mutating live planner state;
- implementing schema versions beyond v1;
- modifying the Web snapshot.

### P2AT-004B — Harden Build file IPC and atomic storage

- Status: `ACCEPTED`
- Priority: P0
- Assignment target: `Codex local executor`
- Depends on: P2AT-004A
- Scope: `apps/planner-desktop/electron/`, focused Node tests, preload contract, package checks and supporting desktop documentation
- Delivery: `f1b5cb8`; accepted and merged by controller in `69f6bbb`

Goal: enforce bounded reads, structured errors and atomic writes behind the existing Build-specific preload/main-process boundary.

Acceptance criteria:

1. Opening rejects files larger than 5 MiB before returning content to the renderer and returns UTF-8 text for codec processing rather than applying state in the main process.
2. Open/save results distinguish cancellation, read failure, size violation, malformed request and write failure with stable structured error codes; normal user-facing results do not expose stack traces.
3. Saving accepts only a bounded serialized Build payload and writes readable UTF-8 content ending in a newline.
4. Save uses a unique temporary sibling file, closes/syncs it as appropriate, and replaces the destination while preserving the invariant that a failed operation does not leave a partial destination file.
5. Temporary/backup artifacts are cleaned up when practical; failure-path tests prove an existing destination remains valid.
6. Filesystem capability remains limited to Build-specific dialogs and operations through preload; no generic path/read/write API is exposed.
7. Testable file operations are extracted from Electron lifecycle/dialog code so success, oversize, malformed request and injected read/write/replace failures can be tested without launching Electron.
8. `npm test`, `npm run check`, jewel fixture verification and CI remain green without an Electron binary or live network.

Non-goals:

- wiring Save/Open controls to live Planner state;
- interpreting semantic Build fields in the main process;
- changing schema v1;
- implementing cloud sync, automatic backups or recent-file lists;
- modifying the Web snapshot.

### P2AT-004C — Connect Build persistence to Planner state and UI

- Status: `ACCEPTED`
- Priority: P0
- Assignment target: `Codex local executor`
- Depends on: P2AT-004A, P2AT-004B
- Scope: desktop renderer UI/state integration, focused pure adapter tests, and desktop documentation; do not modify the Web prototype
- Delivery: `ab8fbcd`, safety follow-up `f81b51e`; accepted and merged by controller in `c467d8e`

Goal: connect schema-v1 persistence to live planner state transactionally, expose Save/Open controls and present bounded import diagnostics.

Acceptance criteria:

1. Desktop UI exposes clear Save Build and Open Build controls that are disabled until the passive-tree data needed for semantic validation is ready.
2. Save serializes the current canonical class/ascendancy, budgets, all five allocation categories and the approved default UI state through `build-codec.js`, then uses the Build-specific preload API.
3. Open decodes with current node/class/ascendancy/instill catalogs, constructs a complete candidate state before mutation, and leaves the current Build unchanged on cancel, fatal diagnostics, IPC failure or application failure.
4. Successful open reconstructs zero-cost class/ascendancy start nodes, applies state in dependency order, clears undo/redo and transient preview/selection state, rebuilds derived indexes, refreshes controls and redraws.
5. Unknown fields and unresolved identifiers from an opened file remain associated with that document and survive a subsequent normal save; starting/resetting a new Build clears that preservation sidecar intentionally.
6. Import presents one concise summary with aggregate warning counts and at most 100 expandable details; no per-node modal loop and no raw stack/internal-path disclosure.
7. The desktop inline script and its standalone `renderer/planner.js` migration copy remain behaviorally synchronized, or the task replaces duplication with one clearly documented runtime source without broad refactoring.
8. Pure state-adapter tests cover full round trip, all allocation categories, start-node reconstruction, failed transactional application, unresolved preservation and reset behavior.
9. Existing 30 tests plus new tests and `npm run check` pass offline; CI remains green.
10. Actual Electron desktop runtime is launched on Windows and a manual round trip is demonstrated: create a non-empty Build, save it, change/reset state, reopen it, and verify restoration.
11. Handoff includes screenshots of the visible controls and restored Build plus the saved fixture JSON or an exact sanitized example used for runtime verification.

Non-goals:

- changing schema v1 or file IPC contracts without a reported blocker;
- equipment, skills, jewel socket contents, cloud sync or recent-file lists;
- broad Planner decomposition or visual redesign;
- modifying `apps/planner-web`.

### P2AT-005 — Inventory and pin upstream data sources

- Status: `ACCEPTED`
- Priority: P1
- Assignment target: `ChatGPT chat executor`
- Depends on: none

Goal: document provenance, license/attribution needs, update cadence and a pinning strategy for each runtime/compiler source.

### P2AT-005A — Integrate upstream policy and canonical source lock

- Status: `ACCEPTED`
- Priority: P1
- Assignment target: `Codex local executor`
- Depends on: P2AT-005
- Scope: `docs/UPSTREAM_DATA.md`, `docs/DECISIONS.md`, `docs/TASKS.md`, `docs/PROJECT_STATUS.md`, `data/upstream-sources.lock.json`, offline lock validation and CI wiring
- Delivery: `a9e386c`; accepted and merged by controller in `afb3630`

Goal: integrate the accepted P2AT-005 research and ADR-007, record immutable identities for all current runtime and compiler sources, and enforce the lock schema without changing any source consumer.

Acceptance criteria:

1. The canonical lock covers every current fixed runtime resource, all eight current portrait files and every jewel compiler manifest source.
2. GitHub sources use full commit SHAs and per-file SHA-256/byte counts; PoE2DB uses a timestamped content snapshot without a fabricated Git revision.
3. Source status distinguishes `active`, `optional` and `future-reference`; candidate promotion remains human-approved.
4. Pure offline tests validate schema, unique IDs, revisions, hashes, enums and required fields.
5. Existing desktop tests/checks and jewel fixture verification remain green.
6. No runtime/compiler consumer behavior, large upstream dataset or installer content is changed.

Non-goals:

- migrating the Planner runtime or jewel compiler to consume the lock;
- automating promotion;
- resolving license questions or approving redistribution;
- packaging upstream data.

### P2AT-005B — Make Planner runtime consume the canonical source lock

- Status: `READY`
- Priority: P0
- Assignment target: `Codex local executor`
- Depends on: P2AT-005A
- Scope: desktop main-process resource resolution and cache integrity, focused offline tests, cache metadata/documentation and CI integration as needed

Goal: replace the Planner runtime's moving branch URLs with immutable URLs and integrity metadata from the accepted canonical source lock.

Acceptance criteria:

1. Runtime core resources and class portraits resolve from `data/upstream-sources.lock.json`; production identity no longer comes from `main` or a named branch.
2. Downloaded bytes are accepted into cache only after both byte-count and SHA-256 verification; a mismatch is rejected and cannot replace a previously valid cached file.
3. Existing cached files are verified against the active lock before use. Invalid or stale cache entries are not parsed as approved data.
4. Bundled resources remain preferred when present, but their integrity is checked against the same lock before they are treated as the active snapshot.
5. Resource writes use safe temporary-file replacement and clean up failed candidates where practical.
6. Errors distinguish unavailable network content from integrity failure without exposing internal paths or stack traces to the renderer.
7. Tests cover immutable resolution, valid cache reuse, stale/corrupt cache rejection, size/hash mismatch, failed replacement and portrait resolution without live network or Electron launch.
8. Desktop tests/checks, canonical-lock tests, jewel fixture verification and CI remain green.

Non-goals:

- changing the jewel compiler to consume the lock;
- automatically promoting upstream revisions;
- bundling license-unconfirmed resources;
- redesigning the renderer, cache UI or Build schema.

## Backlog

- P2AT-006: split graph and pathfinding from the renderer.
- P2AT-007: split allocation state and undo/redo from the renderer.
- P2AT-008: integrate normalized jewel compiler output.
- P2AT-009: add Windows packaging and release automation.
- P2AT-010: establish performance fixtures and benchmarks.
- P2AT-011: audit redistribution rights and attribution for a free public installer and optional offline data pack before release packaging.
