# P2AT-033 — Bounded multi-round closure

Status: ACCEPTED by controller on 2026-09-27; independent review APPROVE.
Controller reran full Python unittest discovery after corrections: exit 0.
Owner big-version acceptance pending. Integrated through `b4a7b62`.
Depends on P2AT-032 (`f7de469`).

The existing ceilings remain 20 model rounds and 100 tool calls. The twentieth
round advertises no tools and receives a runtime-owned summary instruction. If
100 tools have already completed, the next round closes early. A provider that
still returns a tool call during closure is rejected before any tool execution;
there is never a twenty-first summary request. Oversized tool batches remain
fail-closed under the existing limit rather than being partly executed.

Each model request gets a bounded runtime budget/evidence message. It contains
counts and allowlisted tool names, never query/result text promoted into system
instructions. It advises separating facts/inferences/missing evidence and
reporting incomplete work. Successful repeated tree reads are keyed by tool,
snapshot ID and canonical JSON arguments. Different arguments, pages and changed
snapshots have distinct keys. This is guidance, not caching or suppressed reads;
no extra model, embedding or reranker request is added.

On network failure or Stop, the existing main-owned tool trace remains available.
The UI adds a deterministic local partial-results notice (last eight results,
300-character excerpts) alongside the P2AT-032 actual-write receipt. Full bounded
tool details remain expandable. Partial excerpts are inert text and explicitly
not final conclusions. No model-written completion claim or rollback is invented.
These local failure notices are not durable successful conversation turns and
do not enter model history. Earlier streaming prose is not treated as completed.

Synthetic evidence:

- Exact 20-round and early 100-call closure; unexpected closure tool rejected;
  same-args/different-page/different-snapshot distinction; final network error
  and cancellation retain completed tool events.
- Real isolated Electron/Python/local HTTP bridge: 19 read calls then no-tool
  round 20; simulated final HTTP 503 retains all 19 tool results.
- Real production panel with synthetic API: visible local evidence and unknown
  receipt after failure; late receipt resolves in original conversation display.
- No owner Build/database/credentials, paid requests, or running-app restart.

Validation record: one full `npm test` run passed Node 242/242 (zero skips),
Python 127/130 initially passed. The three Python failures were old positional
prompt assertions and a direct `_tools_step` fixture missing the new reads field.
After updating these explicit runtime-metadata contracts, all 44 targeted core,
prompt and cluster-summary tests passed, including an additional review regression:
an oversized/rejected overview must not count as reusable successful evidence.
`npm run check` and `git diff --check` passed. The full suite was not repeatedly
rerun; unrelated passing tests were not modified. Both isolated Electron checks
passed. Independent reviewer approved after the size-boundary fix.

Limitations: runtime guidance cannot guarantee model prose accuracy; final service
failure uses local excerpts instead. Successful reads are execution receipts,
not proof that the user's complete question has been answered. Dynamic guidance
does not change tool permissions or override user scope. No durable failure
recovery/replay or additional model summarizer was introduced.
