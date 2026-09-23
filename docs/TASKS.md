# Task registry

This file is the canonical task queue. Only the project controller changes task status to `ACCEPTED`.

Status values: `READY`, `IN_PROGRESS`, `REVIEW`, `ACCEPTED`, `BLOCKED`, `CANCELLED`.

## Active milestone: M1 — Reliable engineering baseline

### P2AT-031A — Delete agent conversations with confirmation

- Status: `REVIEW`
- Assignment target: Codex local executor, existing continuation task.
- Add deletion to the conversation sidebar, requiring confirmation naming the
  selected conversation. Cancellation must preserve it. Delete only that session
  and its associated records within the current endpoint scope; refresh selection
  coherently, including deletion of the last session. Block deletion during an
  active turn and prevent late events from restoring or contaminating deleted data.
- Verify with synthetic sessions and real UI interaction; do not delete owner data.
- Delivery evidence: `docs/P2AT_031A_SESSION_DELETE.md`; independent review APPROVE.

### P2AT-031B — Organize prompt maintenance by workflow

- Status: `READY`
- Assignment target: same Codex local executor as P2AT-031A; separate implementation commit.
- Preserve every prompt/default/custom value, migration and runtime behavior.
  Add searchable, collapsible hierarchy: system, general node lookup, current Build
  inspection, Build modification, and conversation memory. Keep each tool's short
  purpose and detailed prompt together; nest its hook beneath it. Group by primary
  use without falsely claiming tools never return Build-dependent information.
- Preserve unsaved drafts across search/group/page navigation, visible close/save
  controls, keyboard operation and sensible narrow-window layout. Verify with
  synthetic UI and before/after prompt text equality; deliver screenshots and REVIEW.

### P2AT-030A — Separate tool selection hints from detailed tool prompts

- Status: `ACCEPTED` (2026-09-23)
- Assignment target: Codex local executor; controller verified the complete offline
  Node/Python suites, prompt-editor Electron interaction and syntax checks.
- Each tool has a short editable purpose/trigger sentence in its function schema.
  The previous long description remains an editable detailed prompt and is supplied
  only after that tool is called, never as a batch of all tool prompts.
- Existing v5 custom tool text must migrate losslessly; tool names, schemas,
  permissions and archived conversations do not change.

### P2AT-028B — Live tree tools and semantic topology

- Status: `ACCEPTED` for the developer build (2026-09-23)
- Assignment target: Codex local executor; owner accepted the expanded scope in the
  working application before controller integration.
- Delivered: bounded live tree reads and Build overview; category-specific allocate
  and deallocate tools through the existing guarded Planner bridge; conservative L1
  semantic clusters and read-only WeGame preview; optional cached AI cluster labels.
  The L0 graph, save format and import semantics are unchanged.
- Acceptance: complete Node/Python suites, syntax checks, real synthetic Electron
  tree/agent bridge and write/undo checks. The tests use a locked local tree and mock
  model endpoint; no paid call, private Key or user conversation was involved.
- Remaining limits: semantic clusters are navigation aids, not allocation legality;
  AI labels may be unavailable; release packaging and bundled Python remain separate.

### P2AT-029A — External executor environment bootstrap

- Status: `ACCEPTED`
- Controller acceptance: remote commit `5bc22cfb72791a8af765eeb1826811a167ad3f0d`
  inspected; only the setup report and this status changed. Executor reports
  Node 193 pass/3 cache-dependent skips and Python 60 pass, plus synthetic UI checks.
  This accepts environment setup, not complete real-tree coverage or new features.
- Assignment target: external repository-capable coding agent, owner-forwarded prompt
- Scope: isolated clone/worktree, Node/Python dependencies, baseline offline checks
  and optional synthetic Electron checks; no product implementation.
- Deliver `docs/EXTERNAL_EXECUTOR_SETUP.md` on `task/P2AT-029A-executor-bootstrap`,
  recording exact baseline, environment versions, reproducible setup commands,
  test results, expected cache-dependent skips and remaining blockers. No secrets,
  local caches, dependency folders or user data. Do not mark ACCEPTED or merge main.
- P2AT-028B and tree writes remain paused until separately dispatched by controller.

### P2AT-028A3 — Persistent prompt close control and Chinese defaults

- Status: `ACCEPTED`
- Assignment target: `Codex local executor`
- Baseline: main 5d74d195; accepted P2AT-028A2
- Owner request: always-visible accessible close control, common Escape/button
  dirty/busy handling; translate all 5 system and 6 retained tool blocks to Chinese,
  remove the calculator demonstration and its production implementation/UI/schema.
- Preserve tool schemas/permissions/conditions/budgets and genuine overrides.
  Migrate exact old default values only, without implicit disk writes. Test scroll,
  close/cancel/confirm/busy and v1/v2 default/custom/reset/restart/provider parity.
  Synthetic evidence only, full tests/check and independent review, REVIEW only.
- Controller accepted commit `86a1764d37b201702946f00b485b2d81b57fd3d9` on 2026-09-21.
- P2AT-028B remains paused by owner request; external-executor setup comes first.

Evidence: Node 196/196 (zero skips), Python 60/60, prompt-specific 16/16,
syntax/diff checks, real synthetic Electron prompt/agent UI regressions and
independent review APPROVE. Screenshots: `docs/assets/screenshots/p2at-028a3/`.

### P2AT-028A2 — Categorized complete prompt maintenance

- Status: `ACCEPTED`
- Assignment target: `Codex local executor`
- Depends on: accepted P2AT-028A; main 571e187
- Owner request: switch between System and Tool prompt categories; expose every
  fixed instruction in full for editing, including tool descriptions and memory
  context prefix. Preserve existing overrides across migration, runtime tool
  schemas/permissions, and default model-facing bytes. No stage-2/3 work here.
- Acceptance: editing both categories survives switching/save/restart, actual
  provider requests use overrides, defaults restore, atomic/bounded saves and
  synthetic UI regressions pass. Accepted by controller on 2026-09-21 after
  195 Node tests (194 pass, one environment-gated skip), 57 Python tests,
  syntax checks, synthetic Electron prompt checks and two independent reviews.

### P2AT-028A — Govern and inspect effective system prompts

- Status: `ACCEPTED`
- Assignment target: `Codex local executor`
- Depends on: accepted P2AT-026A and P2AT-027C; main eb60779
- Scope: behavior-preserving versioned Python prompt builder, safe settings inspection,
  full template/trigger documentation, combination and privacy regressions.

Owner addition (2026-09-21): Agent-page editor for all four prompt blocks, bounded
local durable overrides, explicit save/default reset, no running-request mutation.
Default prompts remain byte-identical; editing does not change tool permissions.

Acceptance: exact existing base/memory/RAG/unavailable text and ordering retained;
all flag combinations locked by tests; settings shows runtime template and feature
state, never expanded private MEMORY_CONTEXT_DATA, keys or conversation content.
No hosted model calls, tree tools, archive changes or stages 2/3 before acceptance.
Independent review, offline/full regression and real synthetic UI evidence required.
Deliver a separate task branch/commit in REVIEW; controller owns acceptance/merge.

Controller acceptance (2026-09-21): accepted at `5cdd7aa09a9caa45b819e63870e8c094187b2d2c`.
Default prompt text remained byte-identical across all eight feature combinations;
independent Python and Electron reviews found no blocking issue. Controller reran the
full offline suite, syntax checks and the synthetic prompt-editor UI, including save,
restart, busy rejection and confirmed reset. Prompt overrides are local preferences,
do not grant tools and never expose expanded memory, conversation text or credentials.

Controller acceptance (2026-09-20): P2AT-026A and P2AT-027A/B/C are accepted for the developer build at `88f8e837e7748c3e81f10c788bb71e435ada769d`, including user-approved context/memory/settings/read-only retrieval follow-ups and atomic session-selection correction. Earlier REVIEW/no-main statements below describe executor delivery gates, superseded by this controller acceptance. This is not installer or bundled-Python acceptance. Independent Node 193/193, Python 44/44 and real synthetic Electron regressions passed; no private archive/Key or paid service was used. See `docs/CONTROLLER_ACCEPTANCE_027.md`.

### P2AT-027A — Unify page navigation and left Planner tools

- Status: `ACCEPTED`
- Assignment target: `Codex local executor`
- Depends on: P2AT-026A REVIEW branch; mastery correction 114e47e
- Scope: common page header and left vertical collapsible Planner tools only.

Acceptance: identical top-right Planner/Agent/Settings navigation geometry; existing
Build/allocation/search/display/stat controls and state preserved; narrow overlay,
Canvas resize and hit coordinates correct. Real rendering screenshots, tests and an
independent commit on the existing isolated branch. No allocation/data contract changes.

### P2AT-027B — Move Settings scrolling to the window edge

- Status: `ACCEPTED`
- Assignment target: `Codex local executor`
- Depends on: P2AT-027A
- Scope: full-width single Settings page scroll owner, centered readable inner form.

Acceptance: scrollbar at right window edge, fixed page navigation, dark thin styling,
mouse and keyboard scrolling; no nested main scrollbar; all separate model profiles,
secure Key storage and connection behavior retained. Edge assertions/screenshots and
independent commit. No real paid requests.

### P2AT-027C — Restore independent sessions and simplify chat layout

- Status: `ACCEPTED`
- Assignment target: `Codex local executor`
- Depends on: P2AT-027A, P2AT-027B, P2AT-026A SQLite memory
- Scope: collapsible session overview, persisted selection/list, central chat/composer.

Acceptance: genuine SQLite conversation namespaces isolate history, notebooks, context,
keyword/semantic search and run events; endpoint boundaries unchanged. First user text
provides title without model calls; recent ordering; new chat preserves all archives;
restart restores selected session. Disable switching while generating with stop guidance.
Explain any minimal backward-compatible migration and test archive preservation before
implementation; destructive conversion requires escalation. Synthetic two-session,
restart, error/cancel and late-event regressions, independent boundary review, real UI
screenshots, separate commit. Preserve streaming, stop, details, follow-scroll; no delete,
sync, parallel generation, index rebuild or unsafe model HTML. Remain REVIEW, no main merge.

### P2AT-026A — Move the agent runtime to Python

- Status: `ACCEPTED`
- Priority: P0
- Assignment target: `Codex local executor`
- Depends on: P2AT-024A
- Scope: Python agent/tool/runner/provider/session runtime, bounded JSON-lines subprocess bridge, mock-only tests and documentation; no Planner tools or UI redesign

Goal: keep the existing Electron UI and encrypted credential lifecycle while moving actual agent behavior, tool execution, conversation ownership and model protocol handling into a project-independent Python runtime.

Owner-approved follow-up: migrate the basic Python loop to LangGraph model/tools nodes,
preserving existing provider compatibility, limits, transactional history, local persistence
and UI. No durable graph checkpoints, summarization or bundled Python are included.
Task remains REVIEW; this branch is not merged into main.

Owner-approved context follow-up (2026-09-20): select at most 100,000 historical
characters by complete contiguous recent turns; exclude the entire active turn
and tool work from that budget. Selection is non-destructive and runs before every
model call. Existing archive, input and transport safety limits remain separate.
No summarization, intent classification or UI redesign is included.

Owner-approved durable-memory follow-up (2026-09-20): full minimal per-turn index in
every model input, current-turn ordinal, transactional structured/freeform notebook,
keyword search returning metadata only, and full original-turn reads supporting
consecutive ranges. SQLite archives completed turns separately from bounded working
context; first index is extractive, not an LLM semantic summary. Four-strategy log
evidence is required. Same local profile/endpoint remains the conversation identity;
no multi-account model, Planner coupling, UI redesign or bundled Python is added.
See `docs/MEMORY_ACCEPTANCE.md`; task remains REVIEW and main is not merged.

Owner-approved inspection follow-up (2026-09-20): add expandable per-turn tool
diagnostics with bounded/redacted arguments, results, execution duration and memory
search/read round references. Persist display details with completed UI turns and
verify actual expansion, collapse and reload. Do not expose model hidden reasoning.
This is a focused timeline addition, not a Planner/UI redesign; status remains REVIEW.

Delivered boundaries: Electron remains the trusted renderer/credential/process boundary. It launches a hidden isolated Python process with explicit UTF-8 stdin/stdout handling and communicates through request-ID-correlated JSON lines. The existing Electron `net.fetch` adapter remains responsible only for `/models` discovery so the migrated build preserves the accepted Windows proxy/TLS behavior; Python owns agent execution, conversation, tools and completion protocols. Cancellation terminates the runtime process so blocked standard-library HTTP work cannot survive in the background; the next request restores the connection configuration and only fully completed bounded conversation checkpoints. Completed user/assistant turns plus bounded operational steps and elapsed time persist in the local renderer profile and are bound to the exact normalized API endpoint; credentials remain separately encrypted and hidden reasoning is never stored or displayed. Interrupted, malformed, cross-endpoint and partial SSE turns are never restored or committed. Explicit SSE error events fail the run. Automated tests use no real credential or paid request; a separately authorized local acceptance smoke may use the user's cached configuration without printing the key. This remains a development-environment migration: packaging a bundled Python executable for release remains follow-up work, and the task stays `REVIEW`.

Owner-approved settings follow-up (2026-09-20): add a Settings page alongside
Planner and Agent, relocate existing chat configuration without remounting chat or
Planner, and store independent embedding/reranker profiles with OS-encrypted keys.
Defaults are text-embedding-v4 / 1024 dimensions and qwen3.7-text-rerank. Saving is
not a connectivity test or RAG implementation. No implicit sharing of chat keys or
upload of conversation/knowledge data. Task remains REVIEW.

Owner-approved RAG follow-up (2026-09-20): read-only passive-node knowledge retrieval
and current-conversation summary semantic retrieval. No attribute classification or
fine-tuning. Explicit index construction uses verified source data and existing
translation rules, hosted embedding and reranking, local resumable vectors and atomic
publication. Tool metadata is followed by original-evidence reads; no allocation or
Planner state mutation. Acceptance must ask the natural-language life-regeneration /
energy-shield question and identify node 52 with its overflow and no-recharge clauses,
without routing or answer hardcoding. See `docs/RAG_ACCEPTANCE.md`. Remains REVIEW;
development environment only, bundled Python still deferred, no merge to main.

### P2AT-024A — Add a project-independent agent MVP

- Status: `ACCEPTED`
- Priority: P0
- Assignment target: `Codex local executor`
- Depends on: none
- Scope: reusable agent core, OpenAI-compatible main-process provider, narrow IPC, a separate in-app Agent view, tests and documentation

Goal: provide a runnable general agent foundation, separate from the passive tree, and prove the bounded tool loop with ordinary chat plus one side-effect-free calculator.

Delivered boundaries: `BaseAgent`, `BaseTool`, `ToolRegistry`, injected `ModelProvider`, bounded `AgentRunner`, memory-only conversation with user-approved OS-encrypted credential persistence, Models/Chat Completions/Responses JSON adapters, and an Agent page preserving the mounted Planner view. Only Chat Completions SSE is supported. The only registered tool is finite-number arithmetic. No Planner mutation, files, shell, search, RAG, durable conversational memory, multi-agent graph or account system is included.

Acceptance evidence is recorded in `docs/AGENT_FRAMEWORK.md`. Real provider acceptance requires a user-entered key in the application; committed tests use mocks and do not imply live-service success. Only the controller may mark this task accepted.

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

- Status: `ACCEPTED`
- Priority: P0
- Assignment target: `Codex local executor`
- Depends on: P2AT-005A
- Scope: desktop main-process resource resolution and cache integrity, focused offline tests, cache metadata/documentation and CI integration as needed
- Delivery: `9b1e541`; accepted and merged by controller in `772c8f3`

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

### P2AT-011 — Research PoE community-tool precedent and GGG policy

- Status: `READY`
- Priority: P0 research track
- Assignment target: `ChatGPT chat executor`
- Depends on: P2AT-005A, ADR-008
- Scope: read-only external research covering GGG's published policies and representative established PoE/PoE2 community tools

Goal: determine how established community tools obtain, cache, transform, attribute, fund and redistribute game data/assets, and distinguish documented GGG policy from community custom or unverified assumption.

Acceptance criteria:

1. Use primary sources for GGG policy: Developer Docs, Terms of Use, privacy/API policy, OAuth/API registration material, official forum or staff statements, and official GitHub repositories where relevant.
2. Study representative tools including Path of Building Community/PoB2, FilterBlade/NeverSink, poe.ninja, Craft of Exile and at least three additional maintained tools with materially different delivery models.
3. For every tool, record distribution model, data acquisition path, whether game data/assets are bundled or fetched, licensing/attribution, disclaimer, monetization/sponsorship and any documented GGG approval or enforcement history.
4. Separate verified facts, reasonable inference and unknowns. Public availability, popularity or long operation must not be treated as legal permission.
5. Identify practices that appear broadly tolerated, practices explicitly authorized, and practices prohibited or high-risk under published policy.
6. Evaluate the project's intended model: free public release, voluntary sponsorship, China-focused availability, possible domestic mirror/offline pack and no paid feature gate.
7. Produce a minimal-permission strategy, a conservative release path that does not wait for permission, and exact questions to send to GGG or upstream maintainers.
8. Include dated direct links and short source excerpts within copyright limits; note inaccessible or contradictory evidence.
9. Deliver a complete Chinese Markdown report suitable for later integration into `docs/`; do not modify the repository.

Non-goals:

- giving a definitive legal opinion;
- contacting GGG or maintainers;
- claiming implied approval from silence or precedent;
- changing download, packaging or licensing code.

### P2AT-006 — Extract and stabilize graph/pathfinding behavior

- Status: `ACCEPTED`
- Priority: P0
- Assignment target: `Codex local executor`
- Depends on: P2AT-001
- Type: tracking task; begin with P2AT-006A
- Delivery: completed by P2AT-006A; accepted and merged by controller in `60a84d9`

Goal: move passive-tree topology and path decisions behind tested pure modules so allocation and jewel features can evolve without changing renderer behavior accidentally.

### P2AT-006A — Characterize and extract the pure passive graph core

- Status: `ACCEPTED`
- Priority: P0
- Assignment target: `Codex local executor`
- Depends on: P2AT-001
- Scope: graph construction/query and shortest eligible path behavior currently embedded in `apps/planner-desktop/renderer/planner.js`, focused pure tests, script loading and supporting architecture documentation
- Delivery: `1f4c176`; accepted and merged by controller in `60a84d9`

Goal: establish a browser-and-Node-compatible pure graph module that reproduces current adjacency and path-selection behavior without changing visible Planner behavior.

Acceptance criteria:

1. Before extraction, focused characterization tests capture current graph construction and path decisions for normal, ascendancy, weapon-set, hidden/conditional and disconnected-node fixtures.
2. A pure renderer module owns graph construction, neighbor queries and deterministic shortest eligible path selection without DOM, Canvas, Electron, filesystem or network dependencies.
3. The module supports string node IDs and does not mutate caller-owned node/edge/catalog inputs.
4. Traversal eligibility is supplied through explicit predicates/options; graph code does not read mutable Planner globals.
5. Deterministic tie-breaking is documented and tested so equal-length paths do not change across runtimes or input ordering.
6. `planner.js` consumes the extracted module as the single implementation path; the old duplicate graph/pathfinding implementation is removed rather than retained as fallback.
7. Allocation state mutation, undo/redo, UI rendering and Build persistence remain behaviorally unchanged.
8. Tests cover cycles, duplicate/reversed edges, self-edges, missing endpoints, multiple starts, unreachable targets and stable equal-length ties, plus current category-specific behavior.
9. Existing 49 desktop tests, canonical-lock tests, jewel fixture verification and syntax checks remain green.
10. Actual Electron desktop smoke testing confirms tree load, ordinary allocation/deallocation, weapon-set allocation and ascendancy selection still work.

Non-goals:

- redesigning allocation rules or undo/redo;
- implementing jewel behavior;
- changing node visuals, controls, Build schema or data sources;
- broad renderer decomposition beyond graph/pathfinding.

Acceptance note: adjacency entries intentionally retain duplicate and reversed input edges to preserve legacy graph-degree behavior. Traversal remains deterministic because starts and neighbors are sorted and BFS ignores already discovered nodes.

### P2AT-008A — Add the first visible jewel socket workflow

- Status: `CANCELLED`
- Priority: P0
- Assignment target: `Codex local executor`
- Depends on: P2AT-006A
- Scope: consume committed normalized jewel socket/catalog data, add socket selection and jewel equip/remove UI, render jewel radius feedback, focused pure modules/tests, Build persistence extension only if required by the approved schema-v1 extension rules, and supporting documentation

Goal: deliver the first end-to-end, user-visible jewel interaction without prematurely implementing every jewel rule family.

Cancelled without implementation: investigation proved that the requested radius behavior cannot be implemented from verified inputs. The safe deliverable is split into P2AT-008E (codec/state) and a later ordinary-socket UI task; radius will be a separate evidence-dependent task.

Acceptance criteria:

1. Planner loads committed normalized socket and jewel catalog data through a documented, deterministic local path; startup does not require a new live network request.
2. Clicking a recognized jewel socket exposes a clear jewel panel or picker with the selected socket identity and compatible available jewels.
3. A user can equip, replace and remove a jewel, and the canvas visibly distinguishes empty, selected and occupied sockets.
4. Jewels with a numeric radius display a clearly visible radius overlay centered on the socket; radius membership is computed in a pure, browser-and-Node-compatible module using graph coordinates and tested boundary rules.
5. The UI shows a concise summary of the equipped jewel and nodes inside its radius. Unsupported rule effects are explicitly labeled as not yet applied; the Planner must not silently pretend they work.
6. Equip/remove state survives Save Build and Open Build. Any schema-v1 representation must follow `docs/BUILD_FORMAT.md` preservation and compatibility rules and include round-trip tests.
7. Invalid socket IDs, unknown jewel IDs, malformed catalog entries and missing optional radius values fail safely without corrupting live Planner state.
8. Existing allocation, ascendancy, weapon-set, undo/redo and Build open/save behavior remain unchanged.
9. Automated tests cover radius boundaries, deterministic membership, equip/replace/remove, persistence round-trip, unknown preserved IDs and failure rollback; the existing desktop, canonical-lock and jewel-fixture checks remain green.
10. Windows Electron smoke testing demonstrates tree load, selecting a real socket, equipping a fixture jewel, seeing its radius, saving, resetting and reopening the Build.

Non-goals:

- implementing all nine jewel rule families;
- changing passive allocation legality based on jewel effects;
- downloading or recompiling upstream jewel sources at runtime;
- redesigning the whole sidebar or renderer;
- Windows packaging, mirrors or installer work.

### P2AT-008B — Specify the jewel identity, radius, socket mapping and persistence contract

- Status: `CANCELLED`
- Priority: P0
- Assignment target: `ChatGPT chat-mode research/design`
- Depends on: P2AT-003A, P2AT-006A
- Type: read-only research and design; deliver one complete Markdown proposal, do not modify the repository

Goal: remove the contract ambiguity blocking P2AT-008A by defining an implementable, deterministic and forward-compatible jewel data and Build persistence contract grounded in the repository's real runtime tree and compiler outputs.

Cancelled after two research drafts: the useful questions were retained, but the draft could not establish the required runtime evidence. P2AT-008C supplied evidence and P2AT-008D produced the accepted normative contract instead.

Acceptance criteria:

1. Reconcile `planner-jewel-contract.json` with every committed `dist/*.json` shape and list each required compiler correction.
2. Define stable jewel definition IDs, jewel instance IDs and socket node IDs, including normalization, collision handling and future upstream rename/removal behavior.
3. Establish how runtime passive-tree nodes are recognized as normal or sinister jewel sockets and whether `jewel_sockets.json` is authoritative, derived, or validation-only.
4. Define one coordinate space, distance formula, multiplier application, named/numeric radius representation and inclusive boundary rule, with worked examples.
5. Propose the smallest Build persistence evolution that can save socket contents safely. It must specify schema versioning, v1-to-new-version migration, unknown jewel/socket preservation, deterministic ordering, limits, validation, warnings/fatal errors and downgrade behavior.
6. State whether schema v2 is necessary. If it is, provide the exact normative JSON shape and migration rules rather than an outline.
7. Separate jewel definitions from per-Build jewel instances, including rarity, explicit modifiers, corruption/quality or other instance fields that may arrive later without forcing another immediate redesign.
8. Define safe behavior when catalog data is missing, stale or newer than the application and when a socket no longer exists in the current tree.
9. Provide a staged implementation plan that unblocks a visible radius/equip MVP first and leaves complex rule families for later.
10. Identify every actual product decision requiring controller or user approval; give a recommended default and concrete trade-off for each.

Non-goals:

- implementing code or editing repository files;
- fully specifying every jewel rule family's evaluation algorithm;
- changing upstream acquisition, licensing, packaging or mirrors;
- treating current fixture IDs `100` and `101` as real runtime mappings without evidence.

### P2AT-008C — Extract real socket and jewel-radius evidence

- Status: `ACCEPTED`
- Priority: P0
- Assignment target: `Codex local executor`
- Depends on: P2AT-006A
- Type: local read-only investigation; no product implementation
- Delivery: read-only report accepted by controller on 2026-09-10; durable findings recorded in `docs/JEWEL_EVIDENCE.md`

Goal: inspect the exact passive-tree bytes consumed by the Planner and the locked jewel compiler sources to establish verifiable socket recognition and radius semantics before finalizing P2AT-008B.

Acceptance criteria:

1. Identify every passive-tree input actually consumed by the current Planner, its canonical lock identity and the precise parser/normalization path into runtime nodes.
2. Enumerate real jewel-socket candidates from verified current data and report node IDs, names, relevant raw fields, normalized fields and counts; fixture IDs `100`/`101` must be checked rather than assumed.
3. Determine which evidence, if any, distinguishes normal, Sinister, no-radius and blighted sockets. Unsupported categories must be reported explicitly as absent or unproven.
4. Trace `PassiveTreeJewelDistanceMultiplier` from source through compiler output and any upstream reference implementation. Report the exact formula, units, boundary comparison and named-radius mapping only where supported by code/data evidence.
5. Compare socket coordinates across raw official data, `tree-pre.json`, compiler outputs and Planner world coordinates, documenting every transformation.
6. Inspect all locked jewel inputs and relevant compiler parsing code for stable upstream jewel identifiers. Report available canonical keys and whether a durable definition ID can be derived without display-name identity.
7. Provide reproducible read-only commands or a temporary diagnostic procedure, counts/hashes and compact evidence excerpts sufficient for independent controller verification.
8. Classify every finding as `VERIFIED`, `INFERENCE` or `NO EVIDENCE`; do not turn candidates into normative rules.
9. Conclude exactly which P2AT-008B sections can be finalized and which remain externally blocked.
10. Do not alter application/compiler behavior, committed data, task status or `main`; deliver one Markdown report and keep any diagnostics outside tracked repository files.

Non-goals:

- designing schema v2 again;
- implementing jewel UI, persistence, compiler corrections or rules;
- downloading unpinned moving-branch content;
- legal, packaging or mirror research.

### P2AT-008D — Integrate the minimal jewel and Build-v2 contract

- Status: `ACCEPTED`
- Priority: P0
- Assignment target: `Codex local executor`
- Depends on: P2AT-003A, P2AT-008C
- Scope: normative documentation and data-contract integration only; no Planner UI or runtime behavior
- Delivery: `324fae3`; accepted and merged by controller in `12f7a6f`

Goal: convert the accepted evidence and controller decisions into an exact, implementable contract for ordinary socket equipment and Build persistence without inventing radius behavior.

Acceptance criteria:

1. Add an accepted normative Build schema v2 section while preserving every schema-v1 field and rule; define automatic in-memory v1-to-v2 migration without rewriting a file until the user saves.
2. Specify exact `build.jewels.instances` and `build.jewels.placements` JSON shapes, required/optional fields, types, limits, deterministic ordering, duplicate/reference validation, diagnostics and transactional application behavior.
3. Specify preservation for unknown instance fields, unknown definition IDs, missing socket IDs and future properties without allowing unresolved data to affect runtime behavior.
4. Define project-owned immutable jewel definition IDs, valid syntax, registry lifecycle, collision/non-reuse rules and initial fixture mappings without deriving identity from display names at runtime.
5. Revise `planner-jewel-contract.json` so definitions, instances and placements are distinct and its socket identity/category fields agree with `docs/JEWEL_EVIDENCE.md`.
6. Specify that only the 12 verified ordinary socket IDs are supported in the first MVP; ascendancy and Sinister/Blighted sockets are preserved or rejected as documented but never treated as ordinary.
7. Radius fields may be preserved as catalog metadata, but runtime radius membership and visualization must be explicitly unsupported until verified formula evidence is accepted.
8. Give complete valid/invalid JSON examples and a migration/diagnostic matrix sufficient for codec implementation tests.
9. Reconcile all touched architecture/status documentation and record the decision as an ADR; do not mark the task `ACCEPTED`.
10. Run JSON parsing, Markdown fence checks and `git diff --check`; application tests are required only if existing executable files are touched.

Non-goals:

- implementing the codec, UI, compiler or radius engine;
- supporting special socket mechanics;
- acquiring new upstream evidence;
- changing schema-v1 interpretation.

### P2AT-008E — Implement Build-v2 jewel codec and pure state validation

- Status: `READY`
- Priority: P0
- Assignment target: `Codex local executor`
- Depends on: P2AT-004C, P2AT-008D
- Scope: pure Build codec migration/serialization, governed local jewel/socket catalog, pure jewel state validation and adapter integration; no visible jewel UI

Goal: make schema-v2 jewel instances and ordinary-socket placements safe, deterministic application state so the following UI task only needs to expose already-tested operations.

Acceptance criteria:

1. `build-codec.js` accepts schema v1 and v2, migrates v1 to an in-memory v2 value with empty jewel state, and serializes every explicit Save as canonical schema v2 without changing schema-v1 meanings.
2. Implement the exact P2AT-008D limits, ID grammar, ordering, duplicate/reference diagnostics, unknown-field preservation and future-version rejection.
3. Add a governed packaged catalog containing the six approved definition IDs and twelve eligible ordinary socket descriptors with official raw IDs; runtime behavior must not depend on compiler fixture IDs `100`/`101`.
4. A pure browser/Node module validates catalogs and implements create/equip/replace/remove operations without DOM, Canvas, Electron, filesystem, network or Planner globals.
5. Unknown definitions, sockets, special sockets, fields and properties are preservation-only and inactive; explicit removal clears only the contract-approved related preservation data.
6. The Build state adapter extracts and transactionally applies jewel state while retaining the existing rollback/unsafe-save protections.
7. Radius membership, overlay and jewel rule effects remain disabled; the code exposes no guessed radius calculation.
8. Tests cover v1 migration, v2 round trips, deterministic serialization, all diagnostics, catalog failures, equip/replace/remove, preservation, rollback and caller-input immutability.
9. Existing desktop, canonical-lock, syntax and jewel-fixture checks remain green; no Electron binary or live network is required.
10. Supporting architecture/status documentation describes implementation truth and does not mark the task `ACCEPTED`.

Non-goals:

- adding visible socket controls or Canvas changes;
- implementing special sockets, radius or rule effects;
- changing IPC/file replacement behavior;
- downloading or recompiling upstream sources at runtime.

## Backlog

- P2AT-007: split allocation state and undo/redo from the renderer.
- P2AT-008: continue normalized jewel integration and implement rule families after P2AT-008A.
- P2AT-009: add Windows packaging and release automation.
- P2AT-010: establish performance fixtures and benchmarks.

### P2AT-012 — Research official PoE2 `.build` compatibility and migration

- Status: `ACCEPTED`
- Priority: P0
- Assignment target: `ChatGPT deep research/chat-mode research`
- Depends on: P2AT-003A, P2AT-008D
- Type: read-only external and repository research; may run in parallel with P2AT-008E
- Delivery: research artifact accepted on 2026-09-10; controller decisions recorded in ADR-010 and `docs/OFFICIAL_BUILD_INTEROP.md`

Goal: determine how the official experimental PoE2 Build Planner `.build` JSON format can become the product's user-facing file format without silently losing the Planner's richer state or producing files the game rejects.

Acceptance criteria:

1. Transcribe the current official GGG Build Planner v1 contract from primary documentation, including every field, type, identifier namespace, markup rule, file location and official example.
2. Establish which behaviors are documented versus only observed or claimed by community implementations, especially unknown-field handling, required fields, watcher behavior and version evolution.
3. Compare official `.build` identity and semantics with every current `poe2-agent-tools` schema-v2 field: class, ascendancy, budgets, five allocation categories, UI state, preservation sidecar, jewel instances and placements.
4. Resolve the numeric skill-ID versus official `PassiveSkills` table-ID mapping problem for ordinary, ascendancy, weapon-set, instilled and jewel-socket passives, identifying authoritative data sources and loss cases.
5. Determine whether a single file can be both strict game-compatible `.build` and lossless native Planner storage. Test or source evidence for unknown top-level/nested fields; do not assume JSON extensions are ignored.
6. Evaluate at least three architectures: strict official-only storage, official document plus namespaced extension, and a lossless native `.build` profile with explicit official export. Give compatibility, data-loss and user-confusion trade-offs.
7. Define import/export and migration expectations for existing `.json` schema-v1/v2 files, official `.build` files and future official format versions, including backups and no-silent-loss rules.
8. Survey maintained open-source converters/validators against the official spec and record concrete interoperability fixtures or tests worth adopting; community code is supporting evidence, not authority.
9. Identify what can be implemented immediately and what requires an installed-game acceptance test or additional GGG documentation.
10. Deliver one cited Markdown report with a recommended architecture and a staged task breakdown; do not modify the repository or claim the recommendation is already approved.

Non-goals:

- implementing codecs, changing file dialogs or renaming current files;
- overriding the in-progress P2AT-008E contract implementation;
- assuming official `.build` can encode jewels or private fields without evidence;
- legal/licensing research beyond attribution of technical sources.

### P2AT-013 — Establish official `.build` fixtures and passive-ID mapping oracle

- Status: `ACCEPTED`
- Priority: P0
- Assignment target: `Codex local executor`
- Depends on: P2AT-012
- Type: pure interoperability foundation; may run in parallel with P2AT-008E

Goal: create pinned, reproducible fixtures and a pure numeric-skill-ID/official-raw-ID mapping layer without yet changing Save/Open dialogs or claiming game acceptance.

Acceptance criteria:

1. Record a machine-readable local copy of the documented GGG Build v1 field/type contract and derived test fixtures, with source URL/access date and no undocumented restrictions presented as official.
2. Include fixtures for minimal/documented shapes, scalar/array level intervals, weapon sets, skills/supports, inventory hints, unknown fields, missing/invalid known fields and encoding probes.
3. Build a pure browser/Node mapping oracle from verified official tree node data: numeric skill ID to `PassiveSkills.Id` and reverse lookup, with explicit missing/duplicate/ambiguous results.
4. Report exact coverage for current normal, weapon-set, ascendancy, instilled/hidden and accepted ordinary jewel-socket categories using locked current data.
5. Preserve native numeric identity; the mapper is boundary-only and must never mutate Build state or guess a mapping.
6. Pin every community implementation relied upon or exclude it from normative behavior; official GGG documentation remains authoritative.
7. Tests cover known mappings including `2491 ↔ jewel_slot1974`, missing IDs, duplicate raw IDs, malformed nodes, deterministic output and caller-input immutability.
8. Unknown-field and encoding fixtures remain labelled unverified until P2AT-018 runs actual game/site tests.
9. No file dialog, native codec, GGG codec, UI, game-directory write or network-at-runtime behavior is added.
10. Existing desktop, lock, syntax and jewel-fixture checks remain green; task stays `REVIEW`.

Non-goals:

- implementing official `.build` import/export;
- changing native schema v2 or P2AT-008E;
- claiming game or website compatibility from structural validation alone;
- adding private fields to game-bound fixtures.

### P2AT-021A — Research WeGame public-share Build contract

- Status: `ACCEPTED`
- Priority: P1
- Assignment target: `Codex local executor`
- Depends on: P2AT-013
- Type: bounded public-share research and offline fixtures

Goal: establish evidence for the complete Build-bearing contract exposed by one supplied
WeGame PoE2 public share without implementing a production network importer.

Delivery: `docs/WEGAME_SHARE_IMPORT_RESEARCH.md`, one sanitized fixture bundle, exact
request/schema inventory, lock-verified passive-ID coverage, and offline validation tools.

The research must not claim endpoint stability, redistribution permission, weapon-set
numbering, lossless native import, or game compatibility from this single capture. Status
remains `REVIEW`; only the controller may accept it.

Suggested follow-ups:

- P2AT-021B — implement the passive-first contract, bounded adapter and controlled Electron transport;
- P2AT-021C — wire reviewed passive candidates into UI and perform real-machine acceptance.

### P2AT-021B — Implement WeGame passive-first import core

- Status: `ACCEPTED`
- Accepted delivery: `fa82c8de2e6bf0633df6782283cad9c7521bb736`; controller verified 95/95 desktop tests with the locked official tree, zero skips, syntax and diff checks.
- Priority: P1
- Assignment target: `Codex local executor`
- Depends on: P2AT-013, P2AT-021A
- Scope: pure versioned import adapter, Electron-only controlled fetch service, narrow preload API, offline tests and contract documentation; no Planner UI

Goal: turn an exact public WeGame share URL into a bounded, transaction-ready preview of normal, ascendancy and ordinary-socket allocations while preserving every unresolved source semantic.

Delivery requirements include strict URL/redirect/response controls, only `GetRoleInfo` and `GetTalentTree`, locked-tree P2AT-013 identity validation, inactive source-labelled specialisations, complete inactive `skill_overrides`, no inferred jewel placements, stable errors and mock-only network tests. Native schema v2 is unchanged.

### P2AT-021C — Connect WeGame passive import UI

- Status: `ACCEPTED`
- Priority: P0
- Assignment target: `Codex local executor`
- Depends on: P2AT-021B acceptance
- Scope: visible URL import/preview/confirmation flow, transactional Planner application and Windows Electron acceptance

Goal: let a user review the P2AT-021B candidate, confirm unresolved class/ascendancy meaning, see inactive weapon-specialisation and override warnings, and apply only supported passive allocations without partial mutation.

Acceptance: visible URL entry, bounded preview, explicit class/ascendancy confirmation and partial-import acknowledgment; cancel/error leaves the old Build unchanged. Validate every active ID against the live Planner catalog before transactional replacement, rebuild starts and derived state, and retain the existing rollback/unsafe-save safeguards. Do not apply overrides, equipment, skills or jewel contents. Inactive candidate data is memory-only and is not saved in native unknown fields; disclose this before application. Keep the existing budget values and warn on over-budget imports. Test replacement of a nonempty Build, cancellation, bad input/network failures, rollback and native save/reopen of supported allocations. Deliver a Windows Electron preview with screenshots, exact launch instructions and a real public-link test when reachable; distinguish live and fixture evidence. No schema revision, visual redesign or unrelated refactoring.

Owner-approved validation decision (2026-09-18): the P2AT-021B candidate continues to preserve source specialisations inertly, while the P2AT-021C UI may, only after explicit review and confirmation, map exact `set1` to Weapon Set I and exact `set2` to Weapon Set II. The UI must show actual applicable counts, bounded omission details and real budget accounting before replacement. The observed public sample applied `16/17` and `17/17`; node `52669` was explicitly omitted because the current Planner catalog lacks it. This is a validated experimental mapping for the current product, not a general Tencent numbering guarantee. Task remains `REVIEW` until controller acceptance.

### P2AT-023A — Reclaim the Planner canvas with a collapsible tool layout

- Status: `ACCEPTED`
- Acceptance scope: transitional functional layout only; owner considers visual design unfinished.
- Priority: P1
- Assignment target: `Codex local executor`
- Depends on: P2AT-021C review baseline `5c162b9e23ed65ac74e35bd2de0a6fad11951563`
- Scope: desktop Planner HTML/CSS, an isolated layout-state helper, focused tests and Windows Electron visual/interaction evidence

Goal: give the passive tree most of the window while preserving every existing Planner function behind a compact top toolbar and a single collapsible tool panel.

Acceptance criteria:

1. Common import, file, history and view actions remain grouped in the top toolbar; destructive reset remains in a low-frequency panel with its existing confirmation.
2. A compact labelled rail exposes the existing class/ascendancy, allocation, search, display/settings and statistics/details functions without inventing product behavior.
3. Clicking the active tool collapses it; selecting another tool shows only that panel. Form, search and allocation state survives panel switches.
4. With panels collapsed, the canvas receives at least 90% of the content width at 1366×768. Narrow windows use an overlay panel rather than permanently squeezing the tree.
5. Layout changes resize the Canvas backing store and preserve DPR, camera, zoom, Build state and hit testing without reloading data or duplicating listeners.
6. Tool triggers are keyboard accessible with `aria-expanded`/`aria-controls`, visible focus, guarded Escape close and focus restoration. Motion respects reduced-motion.
7. Existing WeGame preview/confirmation, native Save/Open, unsafe-save guard and all Planner controls retain their behavior.
8. Focused layout-state/resize regression checks, the full desktop test/check suite, four 1366×768 and 1920×1080 screenshots, and one Windows Electron interaction pass are supplied.
9. The implementation stays independently reviewable on `task/P2AT-023A-clean-layout`; P2AT-021C remains a REVIEW dependency and is not represented as accepted.

Non-goals:

- changing WeGame import semantics, schema, localization resources or loading screens;
- adding a UI framework, new product features or decorative effects;
- modifying or merging `main`.

### P2AT-022A — Research WeGame localization resources

- Status: `ACCEPTED`
- Priority: P1
- Assignment target: `Codex local executor`
- Depends on: P2AT-005B, P2AT-021A
- Type: bounded public-resource research; does not block or modify P2AT-021B

Goal: determine whether resources actually loaded by the supplied WeGame public share can
serve as a complete, version-compatible Chinese localization source.

Delivery: `docs/WEGAME_LOCALIZATION_RESEARCH.md`, an offline coverage reporter and an
ignored local research cache. The result is partial: the tree module is broad and aligns
with every locked runtime `tree-pre` numeric node, but contains untranslated strings and
conflicts with locked official raw/numeric identity. It does not establish a full-game
item/skill translation catalog. Production loader/renderer and upstream locks are unchanged;
only the controller may accept or authorize source promotion.
### P2AT-022B — Repair whole-line passive-tree localization

- Status: `ACCEPTED`
- Acceptance includes P2AT-025A runtime-name identity correction; source-candidate classification and redistribution boundaries remain unchanged.
- Priority: P0
- Assignment target: `Codex local executor`
- Depends on: P2AT-022A research evidence `1f4cf3a` (REVIEW), P2AT-023A layout baseline `4006c74` (REVIEW)
- Scope: desktop passive names/stats display and search, fixed WeGame localization candidate cache, offline reports/tests and Windows Electron evidence

Goal: remove mixed Chinese/English output caused by partial term replacement and use only source-labelled whole-name/whole-stat translations that pass identity, numeric, markup and semantic conflict gates.

Acceptance evidence is recorded in `docs/LOCALIZATION_REPAIR.md`. The task does not upgrade canonical tree data, promote the candidate or dependencies to ACCEPTED, commit the upstream dataset, or extend localization to equipment and skills.

### P2AT-020A — Prototype a particle-driven loading experience

- Status: `READY`
- Priority: P1
- Assignment target: `Codex local executor`
- Depends on: none
- Type: isolated visual prototype; may run in parallel with P2AT-008E and P2AT-013

Goal: create an original, runnable loading-screen prototype inspired by the particle typography and wave-field atmosphere observed at `https://ai.novacode.top/login`, suitable for later integration without copying third-party code, branding or assets.

Acceptance criteria:

1. Add the prototype only under a new isolated experiment directory; do not modify current Planner production HTML/JS/CSS, package scripts or persistence code.
2. Render an original PoE2 Agent Tools title treatment using locally generated particles, a dark game-appropriate palette and a secondary flowing particle field.
3. Demonstrate coherent enter, ambient and completion/exit states tied to mock loading progress rather than a perpetual decorative loop.
4. Provide at least two selectable density/quality presets and automatic degradation based on frame time or device constraints.
5. Honor `prefers-reduced-motion`, expose keyboard-accessible pause/resume and continue to communicate loading progress without animation.
6. Use no remote runtime assets, trackers, copied NovaCode source, logos, fonts or particle data; document the reference as visual inspiration only.
7. Cap device-pixel ratio and particle count, stop animation when hidden, clean up timers/listeners/animation frames and avoid unbounded allocations per frame.
8. Include deterministic pure tests for particle target generation, seeded layout/state transitions and quality selection where practical.
9. Provide measured performance at desktop 1920×1080 for both presets, screenshots and a short local review procedure.
10. Existing repository tests/checks remain green; task stays `REVIEW` and production integration is a separate controller-approved task.

Non-goals:

- integrating into the current Electron loading path;
- copying or reverse-engineering the referenced site's source code;
- using the referenced site's name, logo or assets;
- adding runtime network dependencies or a heavy 3D engine;
- changing Planner functionality.
