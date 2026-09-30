# P2AT-034 — Safe runtime diagnostics and provider validation

Status: REVIEW; executor branch `task/P2AT-034-safe-diagnostics`, base
`7227dcb`. The two owner failures prompted this work, but their original exception
stack/service event body was not retained. Synthetic reproductions prove the
fixed parsing gaps, not the original failures' ultimate cause.

## Behavior

- Every captured run failure receives a random `diag-` correlation ID. The UI
  shows the ID, understandable execution phase and model round (zero means not
  known). Existing partial tool results and actual write receipts remain intact.
- Run phases cover setup, context preparation, model request, tool execution,
  tool-result handling and successful-history commit. Tool batch position and
  completed-tool count are bounded; unknown RPC-stage failures stay explicit.
- Exception diagnostics contain only a bounded known exception class, stable
  error code, project module/function/line frames (last 12), stage/round/counts,
  elapsed time and bounded provider transport metadata. No exception string,
  locals, absolute paths, prompt, tool arguments/results, model name, raw service
  message/body or headers is added to the persistent failure record.
- Provider metadata distinguishes Chat/Responses, encode/open/read/parse/decode,
  byte/event counts and elapsed time. Service error code/type use a fixed enum;
  unknown values become `other`. Request IDs only accept UUID or 32-hex forms
  (optionally `req_`/`req-`), otherwise `unknown`. A match containing the active API
  key is removed. No header collection or raw exception text is retained.
- An explicit SSE service error remains `PROVIDER_STREAM_ERROR`. Missing protocol
  completion is now `PROVIDER_STREAM_EOF`. HTTP errors keep their HTTP code (e.g.
  `HTTP_400`), and invalid response structures become `INVALID_RESPONSE`.
- Chat null content/delta/tool_calls, empty/null choices heartbeat fields and
  explicit null ping/heartbeat events are tolerated. Untyped JSON null, null
  choice entries, invalid list/object/text types and malformed Responses items
  fail in controlled parsing. Standard Responses output text/function calls and
  normal streaming/JSON replies remain supported. No automatic chat retry,
  timeout/round-budget change or Build mutation is introduced.

## Storage and privacy-preserving lookup

The existing `agent-memory.sqlite3` → `failed_runs` table is reused. New rows have
`details={"diagnostic":{...}}`, version 1. Old rows are neither rewritten nor
deleted by this task. They may contain the prior raw failure input/trace; do not
bulk export them. Deleting a conversation deletes its diagnostic rows using the
existing session-scoped cleanup. A failed or cancelled half-turn is not committed
as a successful conversation turn.

No new log-reading IPC or public filesystem access is exposed. An authorized
maintainer can open the database read-only and select only the diagnostic object
for the ID shown in the error (parameter binding, never dump the entire row):

```sql
SELECT created_at, json_extract(details, '$.diagnostic') AS diagnostic
FROM failed_runs
WHERE json_extract(details, '$.diagnostic.id') = ?
LIMIT 1;
```

Use SQLite `mode=ro` and `PRAGMA query_only=ON`. The production location is the
Electron userData directory's `agent-memory.sqlite3`. Tests use `:memory:` or
temporary userData only. Diagnostic insertion failure never replaces the original
error; UI marks `stored=false`. Service/RPC use the same error-attached record to
avoid duplicate rows or replacement of the original exception.

## Verification

- Synthetic local HTTP/SSE matrix: normal Chat/Responses, nullable heartbeats,
  explicit errors, premature EOF, HTTP 400, malformed events/items/text/functions.
- Injection cases: deliberately supplied API key, private user text, header text,
  exception message and unknown vendor code/type do not appear in stored metadata.
- Unknown runtime failure records class/project frame/stage/round once; logging
  failure does not mask it. Session deletion and cancellation isolation exercised.
- Real Python RPC child returns a safe diagnostic ID for an unexpected exception
  and remains usable. Real isolated Electron panel displays diagnostic ID/phase/
  round while preserving partial output and late write receipts.
- Full Node suite: 244/244, zero skips. Final full Python suite: 139/139.
  The initial direct `_tools_step` fixture omitted the newly observed `rounds`
  state; the fixture was corrected and the full Python suite rerun successfully.
- Cluster/diagnostic targeted suite: 13/13. `npm run check` and `git diff --check`
  passed. Isolated Electron panel assertions passed with exit code 0.
- Independent review: APPROVE, no P1/P2 findings. Controller owns merge and
  production restart; this task did neither.

## Limits

Process termination/OS crash can prevent a Python diagnostic from being written;
Stop still relies on main-owned partial traces/write receipts. This adds no crash
replay, retry or rollback. Unknown vendor enums/opaque IDs deliberately lose detail
to avoid storing secrets. Protocol-compatible relays may require additional
fixtures; no paid or real-provider replay was performed. Existing old failures
cannot gain retrospectively missing stacks or service error bodies.
Diagnostic retention currently follows session deletion; no age/count rotation
was added in this scope.
