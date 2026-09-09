# Architecture decision log

Decisions are append-only. Superseded entries remain for historical context.

## ADR-001 — Desktop application is the primary product

- Date: 2026-09-08
- Status: Accepted

`apps/planner-desktop` is the primary development target. `apps/planner-web` remains a migration reference until an explicit decision changes its role.

Reason: the desktop shell already provides the security boundary, filesystem interfaces and cache mechanism needed for offline-capable planning.

## ADR-002 — Preserve behavior before decomposing the planner

- Date: 2026-09-08
- Status: Accepted

Meaningful automated tests must be established before broad decomposition of `renderer/planner.js`.

Reason: allocation, conditional-node and weapon-set behavior is intertwined; extracting modules without a regression baseline creates unacceptable risk.

## ADR-003 — Compiler output is a versioned Planner input

- Date: 2026-09-08
- Status: Accepted

The jewel compiler owns normalization of upstream data. The Planner consumes a documented generated contract and must not independently scrape upstream sources at runtime.

Reason: this separates unreliable data acquisition from deterministic application behavior.

## ADR-004 — Controller/executor conversation separation

- Date: 2026-09-08
- Status: Accepted

The controller conversation manages scope, priorities, decisions and acceptance only. Implementation occurs in newly opened executor conversations, one task at a time.

Reason: keeping implementation detail out of the controller context provides a durable project-level view and cleaner handoffs across computers and sessions.

## ADR-005 — Route tasks by execution environment

- Date: 2026-09-08
- Status: Accepted

Every dispatched task names either a Codex local executor or a ChatGPT chat executor.

Codex is used when work requires a checkout, code changes, local tools, tests or Git commits. ChatGPT chat mode is preferred for self-contained research, architecture proposals, reviews and document drafts that can be grounded through the repository URL, branch and directory references.

Reason: this preserves local execution reliability while using faster or more capable chat-mode reasoning for tasks that do not benefit from local computer access.

## ADR-006 — Build JSON is a versioned durable compatibility boundary

- Date: 2026-09-08
- Status: Accepted

`poe2-agent-tools` stores user Builds in an explicitly versioned JSON contract.

The application:

- persists semantic source state instead of renderer-derived state;
- migrates supported older schema versions explicitly;
- rejects newer unsupported schema versions rather than destructively rewriting them;
- preserves unknown fields and unresolved identifiers when safely editing supported documents;
- keeps filesystem access behind the Electron preload/main-process boundary;
- saves Build files atomically.

The accepted schema-v1 implementation policies are:

- U1: `instilledPassives` uses canonical English names; a durable-ID migration may follow later.
- U2: schema v1 does not require a data-revision fingerprint; P2AT-005 may add provenance later.
- U3: limits are 5 MiB per file, 20,000 entries per allocation array, 256 characters per known identifier/name, validation traversal depth 64, and at most 100 retained/displayed diagnostic details while aggregate counts remain available.
- U4: writers include the optional, non-semantic schema-v1 `ui` object by default.
- U5: imports show one summary with aggregate counts and at most 100 expandable details, never one modal per affected node.

Reason: Build files are user-owned durable data and must survive planner refactors, localization changes, upstream passive-tree changes and future schema extensions without silent corruption or data loss. The complete normative contract is recorded in `docs/BUILD_FORMAT.md`.

## ADR-007 — Upstream data uses an approved canonical source lock

- Date: 2026-09-09
- Status: Accepted

Runtime and compiler data identity is recorded in `data/upstream-sources.lock.json` using three layers: a complete upstream commit when the source is Git-backed, a per-file SHA-256 and byte count, and a dataset-level `snapshotId`. Non-Git sources use a timestamped content snapshot and must not be assigned a fabricated revision.

Sources are classified as `active`, `optional` or `future-reference`. Candidate revisions may be discovered and verified automatically, but promotion into the canonical lock requires human approval.

`drydream/poe2drydream` remains pinned as a short-term runtime source while a replacement audit remains open. Sources whose redistribution rights are not confirmed must not be committed as large datasets or bundled in an installer. PoE2DB is a snapshot-backed, manually reviewed auxiliary source, and `ChineseTranslation.lua` remains a pinned download that is not distributed with the installer.

The near-term delivery model is first-time online initialization followed by verified offline cache use. Runtime and compiler migration to consume the lock is deferred to later implementation work.

Reason: immutable, reviewable source identity prevents silent upstream drift while keeping data provenance, integrity, promotion and redistribution decisions explicit.

## ADR-008 — Public releases are free and may accept voluntary sponsorship

- Date: 2026-09-09
- Status: Accepted

`poe2-agent-tools` is intended for free public release. The project may accept voluntary donations or sponsorship, but access to the application, core features and governed game-data support must not depend on payment.

Free distribution and voluntary sponsorship do not create or expand rights to third-party code, game data, translations or artwork. Before a formal public installer or offline data pack redistributes third-party content, every included source must have a documented redistribution basis and required attribution. Content whose rights remain unconfirmed stays download-only or is replaced with content the project is permitted to distribute.

Reason: the product should remain freely accessible while allowing community support, without treating non-commercial intent as a substitute for copyright permission.
