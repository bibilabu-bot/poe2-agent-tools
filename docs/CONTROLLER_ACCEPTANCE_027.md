# Controller acceptance — P2AT-026A and P2AT-027A/B/C

Date: 2026-09-20. Accepted by controller direction for the developer build only.
Code baseline: `88f8e837e7748c3e81f10c788bb71e435ada769d`.

## Scope

- Python/LangGraph agent loop and controlled Electron subprocess bridge, bounded working context, durable SQLite archive/notebook and user-approved read-only retrieval follow-ups.
- Aligned Planner/Agent/Settings navigation, vertical Planner tool rail and window-edge Settings scrolling.
- Independent local sessions with scoped context/search/notebooks, persisted selected session, history pagination and simplified chat presentation.
- Atomic session-selection correction: validate all stored turns and notebook before changing in-memory or persisted selection. Failed selection responses prevent sending until UI/backend selection has been reconciled. Frontend and backend independent reviewers approved the correction.
- Existing mastery visual correction: explicit validated adjacent-node membership, not shared texture/visual-group inference.

## Independently reproduced checks

Run from `apps/planner-desktop` with Python requirements installed, `P2AT_PYTHON` selecting that interpreter, its Scripts/bin directory on PATH, and `P2AT_OFFICIAL_TREE` pointing to the approved byte-verified official tree:

```text
npm test
npm run check
node --test ../../tools/validate-upstream-lock.test.mjs
node ../../tools/validate-upstream-lock.mjs
node ../../tools/jewel-compiler/verify-fixture.mjs
electron tools/check-page-layout.cjs --settings
electron tools/check-agent-sessions.cjs --atomic-selection
electron tools/check-mastery-visuals.cjs
electron tools/check-agent-error-visibility.cjs
electron tools/check-agent-details.cjs
```

Node 193/193 and Python 44/44 passed, no skipped tests. Canonical lock tests 7/7 and formal validation passed. All six jewel fixture outputs matched. Syntax and diff checks passed.

Electron checks used separate temporary profiles and synthetic data. Page geometry and scrolling passed at 1366, 600 and 360px widths. Session tests used real Python/preload/service/SQLite with a localhost synthetic SSE server, covering independent sessions, restart, cancellation, failed history reads and corrupt-record selection rollback. The atomic scenario confirmed restart and the next message remained in session A after damaged session B was rejected. Mastery checks covered 359 mastery nodes, including 96 cross-visual-group memberships, with local/remote, deallocation, both weapon sets and preview-only rendering assertions.

The independently generated screenshots are in the isolated acceptance checkout; committed delivery screenshots remain historical evidence. No real user database, Key, model request or paid embedding/reranker request was used during this controller verification. Earlier live-service evidence belongs to its explicitly authorized executor acceptance, not this run.

## Limits and deferred work

- Python 3.11+ and installed requirements are still needed. This is not bundled-Python, packaging, installer, cross-platform distribution or clean-machine release acceptance.
- Agent retrieval is read-only. It does not authorize automatic passive allocation, graph mutation or complete Build optimization.
- Third-party model compatibility and knowledge-index availability depend on user configuration; local synthetic acceptance does not establish a service SLA or eliminate provider costs.
- Completed archives are preserved separately from bounded context; no deletion/sync or multi-account design is introduced.
- Planner layout checks render production DOM/styles and an empty Canvas; mastery checks render production functions with locked real data. They do not claim a fresh full live-network game-data bootstrap.
- Existing Build schema-v1 implementation, deferred jewel-v2 implementation and upstream licensing/release gates remain unchanged.

The controller owns final main integration/push. This metadata records scoped acceptance, not an executor authorization to modify main.
