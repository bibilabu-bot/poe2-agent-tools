# P2AT-032 — Confirmed refunds and actual write receipts

Status: ACCEPTED by controller on 2026-09-27; independent JS/Python review APPROVE.
Owner big-version acceptance pending. Integrated through `b4a7b62`.

Agent refunds require nodeId, category and confirmation containing the preview
snapshotId and all four removedByCategory arrays (target plus cascades). Python
validates the supplied preview; the renderer independently republishes the live
snapshot and computes the exact current category sets immediately before its
synchronous commit. Missing/stale/duplicate/same-count-different-ID confirmation
does not mutate the Build or undo stack. Manual mouse refunds are unchanged.

The main process journals actual renderer responses separately from model prose.
Each run reports applied/rejected/not_executed/unknown operations, category counts
and bounded ID samples, including on errors and Stop. Stop waits at most two
seconds for a pending renderer response; unknown is not rollback or permission to
retry. New sends are blocked while a renderer write is still unsettled. A local
receipt button can retrieve a late result for the original session generation;
session changes invalidate it. There is no automatic write retry or rollback.

Receipts are local ephemeral UI data (last eight runs), not durable conversation
history, not model instructions. They describe operations at execution time, not
the current Build after subsequent manual edits. If transport never returns or
the app restarts, inspect the current Build manually; unsubmitted model plans
cannot be inferred. Receipt details sample at most 32 IDs/category, while refund
confirmation always requires the complete sets. The existing 16 KiB tool argument
limit may safely reject exceptionally large confirmations rather than truncating.

Evidence (synthetic only; no paid requests or private user data):

- Node focused refund/journal/service tests pass, including cancel during write,
  deadline unknown, late settlement and cross-session receipt rejection.
- Python tree/prompt tests: 60 passed.
- Isolated Electron bridge: same-count wrong IDs rejected without undo/mutation;
  actual confirmed cut-vertex refund removed target plus 135 additional nodes,
  refreshed snapshot, exactly one undo entry, applied receipt. Stop kills runtime.
- No restart of the owner's application; no main merge by executor.
