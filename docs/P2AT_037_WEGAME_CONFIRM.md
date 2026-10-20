# P2AT-037 — Visible WeGame confirmation outcomes

Status: REVIEW pending controller acceptance. Base: `8851eea`.

## Findings and limits

The owner's exact silent-button failure remains unconfirmed. The supplied live
share request could not be launched under the execution policy; it was not retried
through another channel. No Electron process was running at the follow-up check,
so there was no live window/debug connection to inspect. No owner Build, key,
conversation database or application lifecycle was touched.

The sanitized fixture succeeded in an isolated real Electron renderer for both
an empty Build and replacement of a synthetic existing Build. Missing overwrite,
partial-import and omission acknowledgments correctly rejected without changes.
This does not prove the owner's current candidate can be imported.

A separate visibility defect was verified: after scrolling the long preview to
the confirm button, the existing `#weGameStatus` was outside the visible dialog.
The synchronous handler also silently returned without a preview and did not
catch exceptions outside candidate validation/the transaction adapter.

## Bounded change

- A sticky action area keeps a text-only status beside the confirmation button;
  top and local statuses mirror read, validation and application feedback.
- The click handler shows progress, disables form controls, waits two animation
  frames to allow painting, then executes the existing synchronous operation.
  Reentrant clicks are ignored. Closing/changing the preview during this wait
  prevents the write. Controls are restored in `finally`.
- Missing preview and every confirmation rejection have local feedback. Expected
  candidate/transaction failures use safe localized text rather than raw exception
  strings. Unexpected failures distinguish before-application, unknown transaction
  outcome (save disabled), and already-applied/UI-refresh failure; they do not
  invent a successful rollback. The dialog closes only after success feedback.
- Existing confirmation requirements, candidate conversion, commit/finalize/
  rollback and unsupported-import semantics remain. No schema, budget, pathfinding,
  provider or startup behavior was redesigned.

## Verification

- `node --test test/wegame-import-ui.test.cjs test/build-state-adapter.test.cjs
  test/wegame-import-service.test.cjs`: 27 passed, zero skips.
- `node --test test/startup-video.test.cjs`: 4 passed, zero skips.
- `npm run check`, standalone diagnostic-script syntax and `git diff --check` pass.
- Run `tools/check-wegame-confirm.cjs` with Electron and `P2AT_GAME_CACHE` pointing
  to a public pinned game-data fixture directory. It creates temporary userData,
  an in-memory session, mocks import IPC with the committed sanitized fixture and
  blocks non-file/non-poe2 traffic. It does not start production main or providers.
- Real `sendInputEvent` clicks cover a long preview with top status offscreen and
  local status visible; all three missing acknowledgments; missing/invalid
  candidate; unexpected validation failure; finalization failure with successful
  rollback; unexpected transaction-snapshot failure with save disabled; progress,
  cancellation before mutation and successful replacement. Rejections and rollback
  compare complete Build/transient snapshots. Injected private error text must
  never appear in local status. All scenarios passed.
- Independent JavaScript review: APPROVE, no blockers; reviewer additionally
  reran 19 UI/Build-adapter tests and `npm run check` successfully.

This is a diagnostic/feedback correction, not a claim that the owner's original
transaction fault was reproduced or resolved. Controller owns merge/restart and
the next owner validation. No public token or identity data is included.
