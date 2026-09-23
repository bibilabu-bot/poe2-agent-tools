# P2AT-031A — Conversation deletion (ACCEPTED)

Controller acceptance: 2026-09-23, owner UI verification and explicit merge approval.
Integration regression: 29 Python session/prompt tests and 18 Node service tests passed.

The sidebar exposes a keyboard-accessible delete action on hover/focus (always
visible for touch). A confirmation names the conversation and warns that deletion
cannot be undone. Cancel changes nothing. Only the current service's selected
target is removed, never another endpoint, preferences, prompts or credentials.

The archive transaction removes the notebook, turns, search text, display trace,
metadata and failure diagnostics. An attached retrieval database removes only
summary vectors not shared by other conversations or public node records. A
mid-delete SQL failure rolls back both stores. Deleting the current conversation
selects a remaining one; deleting the last leaves a durable empty state. Explicit
New conversation is required before sending again. The additive `session_endpoints`
table also prevents obsolete renderer-cache import after deletion.

Active turns and unconfirmed calls are rejected. Electron generation and renderer
epoch checks reject late events/history; the archive rejects commits to deleted
parents. This is logical application deletion, not forensic disk erasure or backup
deletion. Attached SQLite transaction rollback is tested for ordinary errors; no
cross-file power-loss durability guarantee is claimed.

## Evidence (2026-09-23)

- Complete `npm test` passed with the locked official-tree cache; Python 106/106.
- `npm run check` and `git diff --check` passed.
- Focused coverage includes 8 Python session tests and 18 Electron service tests.
- Real synthetic Electron `tools/check-agent-sessions.cjs --delete`: confirmation,
  cancellation, current/last deletion, active-turn rejection, restart empty state,
  and a clean new conversation all passed. Only temporary synthetic user data and
  a local mock model were used. The running owner's app was not restarted.
- The prior prompt-test failure was an outdated fixture injecting a provider
  without configuring a session. It now follows production configuration and
  verifies the exact full system prompt; production `SESSION_REQUIRED` is retained.
- Independent review: APPROVE, no blockers.

Screenshots: [confirmation](assets/screenshots/p2at-031a/delete-confirm.png),
[last conversation deleted](assets/screenshots/p2at-031a/sessions-empty.png).

No default prompt text, Build format or Planner graph changes. This is executor
delivery evidence; controller acceptance above does not imply a packaged release.
