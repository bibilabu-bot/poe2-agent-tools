# Agent/tree integration — REVIEW

Date: 2026-09-27. Branch: `task/integrate-agent-tree`.
Controller-authorized integration; no new numbered task ID was assigned.
Baseline `origin/main`: `cbb33c0e00820f0295b075ae813866cb61e5867d`.
Only the controller may accept this delivery and update main.

## Included commits

- `69de26f27d95bf5c5529d636b38f30314060dda3`: remove overview allocation directory.
- `acfc12811175f023bc8eddfcbba0679370725b08`: no default whole-chat deadline.
- `76d12fce3077fb49d9fe0d38e38d2159c8b501c4`: category-specific cluster refund previews.
- `bf7f1c970ae3859d4c244353ccdf6e60b8d0fe38`: bounded transient retrieval retries.

The first three are a single ancestor chain, fast-forwarded once. The retry branch
is merged with the following explicit policy reconciliation, not applied twice.
No research branch, other unfinished feature, private data or dependency is added.
Existing worktrees and the user's running application are untouched.

## Conflict decisions

The newer removal of the default 300s whole-run deadline wins. Electron forwards
`_remainingMs:null` for normal chat, overriding any renderer-provided value.
Python's scoped retry enablement has no default elapsed-run deadline (`inf` stays
internal and is never sent as JSON). Each individual embedding/rerank HTTP
operation starts its own **90s budget including all attempts and backoffs**.
Successful embedding is not repeated when rerank alone retries. An explicitly
injected finite internal test deadline may only shorten the local deadline;
production does not configure one. Nested contexts cannot extend parent bounds.

There is no five-minute timer hidden in the RPC client or Python send path.
The 20-model-round/100-tool limits, request network-stall guards, bounded tool/hook
work and explicit Stop remain. At most two additional attempts are allowed for
identified transient failures; ordinary 400/401/403 and configuration/model/vector
failures do not retry. Cancellation interrupts request/backoff and starts no new
attempt. Existing `RUN_TIMEOUT` retrieval errors describe local request budget
exhaustion here, not a reintroduced whole-chat timeout. Underlying `to_thread`
socket work cannot be instantly aborted remotely; existing socket timeout/process
termination remains the boundary, with no retry after the local deadline expires.

The textual merge conflict in service tests retained both assertions: default
chat can outlive the former budget, and explicitly configured internal finite
budgets cannot be enlarged by renderer input.

Independent review identified one bounded-payload correction: renderer overflow
now clears derived `refundImpacts` together with nodes/edges before returning an
error projection. Otherwise the new potentially quadratic preview matrix could
survive the 8MiB fallback. No partial/old preview is published on that path.

## Verification

- One complete offline regression: Node **238/238**, zero skips; Python **124/124**.
  Locked official-tree fixture supplied via `P2AT_OFFICIAL_TREE`.
- `npm run check`, explicit checks for refund module/bridge, staged and unstaged
  `git diff --check` passed.
- Added Python tests: one retry-enabled chat context survives simulated 600s before
  another request, while each operation still has the local 90s ceiling.
- Service fake-time test advances 600,000ms and verifies success and Stop, and
  confirms renderer-supplied zero does not become a hidden deadline.
- Real hidden Electron test (`tools/check-live-tree-bridge.cjs`) uses a temporary
  userData/database, isolated partition, local synthetic HTTP/SSE provider and
  sanitized public Build fixture. It exercises real renderer/preload/main/Python
  RPC/model tool dispatch, complete overview/cluster reads and WeGame preview UI.
- Synthetic fixture target `10247` has 135 additional affected IDs. The loop
  reads its cluster, deallocates, then reads again: actual removals in every
  allocation category exactly equal preview; snapshot ID changes; target becomes
  not allocated; one undo restores the full capture. Simulated main-clock +600s
  does not stop it. A separate blocked synthetic request is cancelled and the
  Python child is terminated. Renderer error list is empty.
- After the review correction, refund tests **10/10** and syntax/diff checks passed.
  New overflow assertions inject >8MiB derived metadata, verify compact output,
  no published preview, and unchanged Build/undo. No duplicate full run needed.
- Independent JavaScript/Python integration review: final **APPROVE** after the
  overflow correction; no remaining blocking findings.

Reproducible bridge command: set `P2AT_PYTHON` to an installed project interpreter,
`P2AT_GAME_CACHE` to the locked game-data cache, leave `P2AT_BRIDGE_LIVE` unset,
then run Electron with `tools/check-live-tree-bridge.cjs`. Do not enable LIVE for
integration acceptance. The test's process watchdog is isolated test machinery,
not a production chat deadline. The minimal shell omits unrelated settings IPC
handlers and logs those warnings on startup; assertions and renderer error checks
still pass. No hosted calls, Keys, owner sessions, index rebuild or owner-app
restart were used. Only public game-data cache files were read.

## Remaining boundaries

This is a developer-build integration, not installer/packaged Python acceptance.
User-customized prompts are preserved and may still mention retired modes; schema
and runtime reject the removed overview entry. Refund counts are unique affected
node IDs, not budget-point refunds; category lists preserve overlapping IDs.
Previews are snapshot-scoped and must be refreshed after changes. Single-node
output too large returns an explicit error, not a clipped list. Preview generation
can be quadratic for very large allocated graphs; this change bounds publication,
not a new performance redesign. Failed chat does not roll back prior successful
writes. See the individual delivery docs for the unchanged contracts.
