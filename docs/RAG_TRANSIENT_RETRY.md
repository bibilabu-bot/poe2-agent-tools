# Bounded RAG transient recovery — REVIEW

Owner-authorized follow-up to the reported `search_passive_nodes` HTTP 400.
Baseline: `cbb33c0e00820f0295b075ae813866cb61e5867d`.
Branch: `task/rag-transient-retry`. No main merge or application restart.

## One authorized live tool check

One logical production `RagTool(search_passive_nodes)` call used the owner's
reported query, without a chat model, Build snapshot or conversation history.
The existing SQLite index was opened in read-only/query-only mode; preflight
reported ready, 5,102 nodes and zero missing node vectors. No index rebuild or
bulk embedding was allowed. Credentials were consumed only inside controlled
local processes/private pipes, never printed, passed as command arguments or
written to disk. Only safe stage/status/count/timing data were retained.

| Stage | Result | Elapsed |
| --- | --- | --- |
| Query embedding (`text-embedding-v4`, 1024 dimensions, one input) | HTTP 200 | 4,875 ms |
| Rerank (`qwen3.7-text-rerank`, 100 candidates) | HTTP 200 | 4,954 ms |
| Complete tool | 5 matches | 11,375 ms |

This satisfied the owner's conditional authorization to add limited retries.
It does **not** establish the cause of the earlier HTTP 400. No additional hosted
calls were used to develop/test the retry implementation.

## Scope and policy

- Only embedding/rerank HTTP requests during `AgentService.send` are retryable.
  No chat-model/whole-turn retry, no repeat of a successful preceding embedding,
  no change to index-build or connection-test behavior.
- At most two additional attempts (three total), with 0.25s and 0.75s backoffs.
- Retry HTTP 408/429/500/502/503/504, provider timeouts and identified connection
  interruptions/temporary DNS errors. Do not retry ordinary HTTP 400/401/403,
  certificate validation/permanent DNS failures, bad model/configuration or
  malformed response/embedding dimensions. No exception for speculative 400 causes.
- Electron supplies the remaining run time **after** preparation, overriding any
  renderer value. Python scopes it with a resettable ContextVar; nested scopes can
  only shorten it. The existing 300s overall timer is unchanged. Each retrieval
  request including retries is additionally capped at 90s or remaining run time,
  whichever is shorter. Budget expiry starts no further attempt.
- Cancellation propagates through requests/backoff. On an async deadline no retry
  of the abandoned underlying request is scheduled. Standard-library `to_thread`
  socket work itself remains subject to its existing socket timeout/process stop;
  this change does not claim instant abortion of a remote in-flight operation.
- Error results preserve a controlled code and add only stage/attempt count; no
  raw error body, transport exception, header, query or credential is logged.

## Evidence

- New synthetic tests cover transient success recovery, three-attempt ceiling,
  permanent 400 and auth/config errors, transport/certificate classification,
  redaction, request/backoff cancellation, depleted/in-flight/nested deadlines,
  non-agent single attempts, stage-only retry, and RPC/service budget wiring.
- Electron regression asserts preparation consumes budget and renderer values
  cannot extend it. The prior disabled-write RPC fixture was updated to accept
  the optional internal budget argument without weakening its assertions.
- Full locked-tree suites: Node 227/227, zero skips; Python 117/117.
- Syntax checks and `git diff --check` passed. Independent review: APPROVE.

No prompt text/schema, graph, Build format, UI structure or configuration migration
changed. The developer runtime still requires Python 3.11+. This is executor
REVIEW pending controller acceptance.
