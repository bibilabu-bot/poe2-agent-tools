# Chat timeout and cluster refund preview — REVIEW

Baseline: `69de26f27d95bf5c5529d636b38f30314060dda3`.
Branch: `task/refund-preview-no-run-timeout`. Owner-authorized follow-up, no numeric task ID.

## A: no default overall chat deadline

The production AgentService no longer starts a shared five-minute timer for chat.
PythonAgentClient and the Python send RPC have no independent whole-turn deadline.
Explicit Stop still terminates the runtime and rejects late results. Provider
network inactivity/request guards, tool callbacks, cluster-hook limits, the
20-model-round and 100-tool-call bounds remain unchanged. This is not unlimited
network waiting. Model discovery and connection tests are unchanged.

Synthetic Node service tests: 19/19 passed, including advancing a fake clock by
600,000ms while a send is pending, then successful completion or explicit Stop.
Independent A review: APPROVE. No paid requests or application restart.

The separate unmerged `bf7f1c9` retrieval-retry branch assumes a remaining 300s
whole-run budget. Do not merge it blindly: its budget propagation must be reconciled
with this deliberate absence of a default run deadline.

## B: read-only cluster refund impact

`read_tree_cluster` node pages retain their `items` ID array and add a keyed
`refundImpacts` map. Each entry identifies the Build-sensitive `snapshotId` and
separate general/weaponSet1/weaponSet2/ascendancy plans for allocated categories.
Locating an excluded ascendancy node also returns its impact with the existing
`ascendancy-excluded` reason; no ascendancy cluster is invented.

For a refundable target, `additionalRefundCount` and sorted, deduplicated
`cascadeNodeIds` exclude the target; `totalRefundCount` includes it. The full
cross-cluster affected set is used, not just nodes in the queried cluster.
`removedByCategory` additionally preserves which allocation categories lose which
IDs, including overlapping weapon-set IDs. Counts refer to unique removed node
IDs for that action, **not** points charged/refunded by the Build budget formula.
This is loss of legal connectivity under the current rules, not the length of a
historical prerequisite path. Protected starts and conditional dependencies return
`refundable:false` with a reason, not invented zero-cost success. Unallocated nodes
are `not-allocated`; older snapshots without plans are `preview-unavailable`.

`refund-plan.js` is a pure transition using the existing L0 reachability function.
The stable deallocation API and read-only capture share it. It clones sets and
never edits live allocation, undo or history during preview. It retains existing
ascendancy behavior (ordinary revalidation, no new weapon-set pruning). Writes
still push undo once on success; a later failed chat does not roll them back.
Single-argument predicate wrappers preserve existing array/graph callback behavior.

Renderer capture derives plans, Electron carries them in the bounded snapshot,
and Python exposes them only in cluster node details, not overview/search/node
reads. After writes, refreshed plans replace old ones; refresh failure clears them.
Re-read after a snapshot change. No private custom prompt is inspected or changed.

Node pages shrink as necessary below the existing 8k tool envelope, preserving
every cascade list and returning `nextOffset`. A single impact too large to return
completely produces `REFUND_PREVIEW_TOO_LARGE`, never a truncated success. The
existing 8MiB whole-snapshot bound remains; exceptional oversized snapshots fail
explicitly rather than offering incomplete plans.

Verification: synthetic leaf, cut-vertex/cross-cluster, cycle, both weapon sets,
general-to-weapon cascades, ascendancy, protected starts and conditional blockers;
pure results versus actual write transition and unchanged legacy UI refund rules;
no preview allocation/undo changes; renderer capture/main publication and changed
snapshot identity; RPC delivery/refresh; cluster-only visibility and complete
adaptive pages. One full regression run passed Node 236/236 (zero skips), Python
110/110. Subsequent callback-wrapper and RPC assertion additions passed targeted
28 Node and 64 Python tests; final explicit predicate-callback regression brought
the refund-specific Node suite to 10/10. `npm run check` and `git diff --check`
passed; no second duplicate full run. Independent JS/Python review APPROVE.
All providers are synthetic; no paid calls or user app restart.
