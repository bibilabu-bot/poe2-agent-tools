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
