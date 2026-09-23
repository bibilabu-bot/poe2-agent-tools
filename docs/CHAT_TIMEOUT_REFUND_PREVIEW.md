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
