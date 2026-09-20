# Page layout follow-ups — REVIEW

## P2AT-027C atomic selection correction

Baseline: `1294e3fd1220c1ffc65a7ccf53865fc33f0a7139`. Controller review found
that selection persisted its ID before parsing target history. A corrupt second turn
could leave B selected with A's in-memory history. Selection now verifies endpoint,
all target turn JSON/sequence/completion, notebook, bounded candidate working history,
display read and response data before publishing the durable ID and in-memory pair.
No fallible history/response reads follow publication; failures preserve old state.

Frontend enters an unconfirmed, non-sendable state before dispatching selection.
Any error (including one returned after a backend mutation) keeps sending disabled;
retry re-reads backend selection and its history before restoring readiness.

Regression: `test_failed_selection_keeps_memory_database_restart_and_next_send_on_a`
uses actual synthetic SQLite with A-private and B's normal first/corrupt second turn,
plus unfinished-turn and injected display/list read errors. It verifies old ID/history,
durable selection, restart and subsequent provider inputs/archive ownership.
`npx electron tools/check-agent-sessions.cjs --atomic-selection` exercises production
Python/service/preload/renderer against a temporary SQLite and local mock SSE: corrupt
second turn, select success followed by response error, retry, next send and restart.
Both pass. Screenshot: `docs/assets/screenshots/p2at-027/sessions-atomic-failure.png`.
Full npm test and syntax checks pass (Node 193, Python 44). Independent frontend
and backend reviews approve; candidate-response list failure is injected on the second
list call so the test reaches the new pre-publication read rather than the initial guard.
No user archive or paid endpoint accessed. Remains REVIEW pending controller acceptance.

Branch: `task/P2AT-026A-python-agent-runtime`; never merge main from executor.

## P2AT-027A

Baseline: `114e47e14e5ed8ec1d794f1cbe465cb3d593d82e`.
Common 72px page headers align all three navigation groups at the top right.
The existing tool rail is moved into the content grid, preserving mounted controls
and panel state. Narrow windows overlay the panel beside the 64px rail. Canvas resize
uses actual stage size instead of its former 320/420px minimum, preserving coordinates
even at a 360px window width. Allocation, mastery, graph and Build contracts unchanged.

Evidence: `npx electron tools/check-page-layout.cjs` runs production markup/styles,
layout mount, page switch handlers and extracted Canvas resize/coordinate functions
in an isolated offscreen Chromium window, with no private data/network. It checks
identical navigation geometry, control state, Canvas dimensions/center coordinate and
pointer reachability of rail buttons at 1366×768, 600×650 and 360×560, open/closed.
Screenshots: `docs/assets/screenshots/p2at-027/navigation-*.png`.
This is real DOM/layout rendering with an empty canvas, not a game-data startup test.
Full npm test (Python 39/39), npm run check and layout fixture passed.
Independent review found a narrow hidden-panel overlap; corrected the offscreen
translation and added elementFromPoint regression coverage.

## P2AT-027B

Baseline: `dcf6a1c54ae9d2402a6b6ec6127b1044e72a9df5`.
The full-width `settings-scroll` main owns page scrolling; `settings-content` retains
its centered 900px reading width. Header stays outside the scroll region. Existing
controls/IDs, profile handlers, credential lifecycle and testing behavior are unchanged.
`npx electron tools/check-page-layout.cjs --settings` checks right edge equals window
width at 1366/600/360px, no nested scrolling containers, actual PageDown and wheel
scrolling at the window edge, and header top remains zero. All checks pass; screenshots
are `docs/assets/screenshots/p2at-027/settings-{1366,600,360}.png`.
Independent read-only review reports no issues. Synthetic/no-network fixture only;
no credentials read and no real connection/model requests made. REVIEW.

## P2AT-027C

Baseline: `a8374d7557f9409ec2193b3b4d00c5fb38c3070c`.
The left collapsible session list uses actual SQLite conversation IDs, existing
endpoint ownership and active-conversation selection. Titles are first-user excerpts
(48 characters after credential redaction); order uses most recent completed turn or
new-session creation time. No title model call, deletion, sync or parallel generation.
The center chat removes large card borders, retaining streaming, stop, tool details
and the bottom composer. Session switching clears drafts explicitly.

### Backward-compatible storage

The migration only creates `conversation_metadata` and `turn_display` if absent.
It does not alter, drop, rewrite or prune conversations, turns, notebooks or selected
IDs. The first synthetic test creates the old schema directly, upgrades it and compares
original message/notebook bytes, restores selection after reopening and checks all IDs.
New completed turns and display details commit atomically; failure/length/cancel never
create completed archive entries. New persisted records redact configured credentials
and credential-shaped fields; existing archive bytes remain untouched, with redaction
applied when displaying them. Title redaction precedes truncation.

History display pages contain 20 complete turns with an explicit older-page cursor;
the UI exposes Load earlier records, rather than dropping old archives at 30 turns.
The model's bounded working context remains unchanged; its full directory, notebook,
keyword and semantic memory tools bind to the selected conversation. New sessions keep
old sessions; process restart restores the selected ID from SQLite. No index rebuilding.

The legacy localStorage cache is retained. Its validated pair import is only eligible
for an untouched single initial archive, avoiding stale-cache injection into a newly
created conversation. Old SQLite turns have no historical run-detail payload unless it
was previously stored elsewhere; these are shown as original user/assistant messages,
without fabricated timing/tool logs. New run details are durable in SQLite.

### Failure boundaries and evidence

Renderer disables selection/new-session while running; main process independently
rejects overlaps. Request/generation guards discard late results/events. Once a backend
switch succeeds, the old view is immediately cleared; a history-read failure disables
sending, displays a clear error and exposes retry. Successful reload restores readiness.

- Full desktop tests pass: Node 193/193 (zero skips), Python 43/43, including four new session regressions.
- `npm run test:agent-sessions`: production renderer/preload, actual Electron service,
  Python and temporary SQLite with localhost-only synthetic SSE. Covers two independent
  sessions, context separation, restart/selection, length rejection, cancel, disabled
  switching, no cross-session display, and injected read failure after successful select.
- `npm run test:agent-ui`: tool detail expand/collapse/reload, inert HTML, error visibility,
  dark scrollbars and streaming follow-bottom behavior still pass.
- `npx electron tools/check-page-layout.cjs --settings`: prior A/B regression passes.
- Node tests independently cover late cancelled run events after selection and mutually
  exclusive session operations; semantic-memory test now uses two IDs on the same endpoint.
- Independent frontend/backend reviews found and verified fixes for history-read UI
  mismatch and legacy/long-key redaction. No remaining blocking findings.
- Screenshots: `docs/assets/screenshots/p2at-027/sessions-desktop.png` and
  `sessions-narrow.png`, generated from synthetic sessions only.

No private user database, API configuration, conversations or Build allocations were
read/reset. No real hosted chat/embedding/reranker requests. No upstream data, indexing,
Planner semantics or main branch changes. Existing accumulated dependencies remain
REVIEW pending controller acceptance; this delivery does not imply their acceptance.
