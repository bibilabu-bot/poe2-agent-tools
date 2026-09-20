# Four-strategy memory acceptance — 2026-09-20

Task: P2AT-026A. Branch: `task/P2AT-026A-python-agent-runtime`. Status remains
**REVIEW**; no merge to main. This is a development-environment delivery, not a
release with bundled Python.

## Deterministic real-subprocess evidence

Command, from `apps/planner-desktop`:

```powershell
node --test test/agent-memory.test.cjs
```

The process is the actual isolated Python runtime, with a temporary SQLite database
and a local HTTP test server acting as the model. These logs are measured provider
inputs/tool outputs, **not a live-model claim**. All example conversation data and
the test credential are synthetic. The first two turns are followed by 120,000
Chinese characters of filler, forcing old raw turns out of the 100,000-character
model-input allowance before testing retrieval.

The following excerpts come from `MEMORY_CHILD_EVIDENCE` on 2026-09-20. Fields are
selected for readability; the test prints the full JSON and asserts their values.

### 1. Full directory and current turn

```json
{"current_turn":7,"turn_ids":[1,2,3,4,5,6],"first_entry":{"turn_id":1,"summary":"问:项目代号：琥珀-731🙂 答:已登记"},"old_raw_turn_excluded":true}
```

All six completed turn IDs remain in the actual model input even though the first
turn's raw user message is absent. The model receives ordinal 7 for this run.
`test_working_cache_eviction_preserves_archive` additionally checks that 32 archived
turns remain indexed while only 30 recent turns remain in the working cache.

### 2. Structured and freeform notebook

The next model request after `update_notebook` contained:

```json
{"revision":1,"goal":"验证长期记忆","constraints":[],"decisions":[],"notes":{"验收口令":"蓝鹭-908🙂"},"updated_in_turn":7}
```

The test uses a dummy label, not a real password. The live smoke uses the unambiguous
name `验收标签` instead. Notes support replacement and null deletion. Successful-run
commit persists the notebook with the complete turn; a new JS service and Python
child recover it from SQLite, with no retained in-process state.

### 3. Keyword search returns metadata only

```json
{"matches":[{"turn_id":1,"created_at":"2026-09-20T01:48:20.518324+00:00","summary":"问:项目代号：琥珀-731🙂 答:已登记","chars":79}],"next_offset":null,"metadata_only":true}
```

The test asserts that `messages` is absent. Search scans the full archive, supports
literal `%_`, Chinese and emoji, AND keywords, and pagination.

### 4. Read consecutive original turns

```json
{"turn_ids":[1,2],"offset":0,"total_chars":206,"complete":true,"next_offset":null}
```

The returned `text`, JSON-decoded for this excerpt, is:

```json
[
  {"turn_id":1,"messages":[{"role":"user","content":"项目代号：琥珀-731🙂"},{"role":"assistant","content":"已登记"}]},
  {"turn_id":2,"messages":[{"role":"user","content":"交付日期：周五"},{"role":"assistant","content":"已登记"}]}
]
```

The test compares these messages exactly with the original two records. Separate
Python coverage concatenates a multi-page range and checks exact reconstruction.

### Recovery and rollback

```json
{"restartCurrentTurn":8,"afterCancelCurrentTurn":9,"afterSseErrorCurrentTurn":10,"notebookRevision":1,"credentialsAbsent":true}
```

Cancellation happens after a notebook update and before the next model response.
The SSE failure also follows a staged notebook change and partial text. Neither
attempt consumes a turn ordinal or updates the durable notebook. Completed earlier
turns survive both process replacement and creation of a new JS service. The
temporary database is also checked for absence of the synthetic connection key.

## Live model / desktop-bridge evidence

Actual configured desktop connection, `kimi-k3`, on 2026-09-20. No key was read,
printed or exported. `tools/agent-memory-live-smoke.cjs` used the existing narrow
renderer bridge and actual production Python runtime; it did not replace the model
with a test server. These are selected fields from the successful second run:

```json
{
  "model":"kimi-k3",
  "seedTurns":[14,15],
  "context":{"currentTurn":16,"directoryTurns":15,"notebookRevision":2,"totalHistoryChars":3348},
  "tools":[{"name":"update_notebook","ok":true},{"name":"search_memory","ok":true},{"name":"read_memory","ok":true}],
  "search":{"metadata_only":true,"matchedTurnIds":[11,13,14]},
  "read":{"turn_ids":[14,15],"complete":true,"hasProject":true,"hasDate":true}
}
```

The response identified turn 16, project `琥珀-731🙂`, delivery `周五`, and notebook
label `蓝鹭-908🙂`. The first run successfully called all tools but declined to store
a test item named "口令" as potentially sensitive; the second used an explicitly
non-sensitive public test label. This is evidence of the safety instruction being
followed, not a failed database write.

Live testing adds persistent test turns to the active conversation and updates its
goal/notes; it does not clear the user's conversation. The supplied script requires
both `P2AT_MEMORY_LIVE=1` (paid requests) and `P2AT_MEMORY_MUTATE_CURRENT=1` (those
persistent side effects). It prints only assertion summaries, not arbitrary model
reply text. Do not run it against a conversation whose notebook must stay untouched.

The subsequent actual UI submission asked only to read the existing notebook label,
without changing it. `tools/agent-ui-e2e-smoke.cjs` checked visible assistant text and
completed activity state; the response was:

```json
{"model":"kimi-k3","lastMessage":{"role":"agent-message assistant","text":"蓝鹭-908🙂"}}
```

## Checks

- Desktop Node tests: 157/157, zero skips with canonical official-tree fixture.
- Python runtime + memory tests: 28/28.
- JavaScript syntax / Python compilation: pass.
- Rendered agent error visibility regression: pass; Planner overlay unchanged.
- Upstream source lock: valid; lock tests 7/7.
- Jewel fixture: six outputs verified in a temporary copy, zero warnings.
- Independent Python/bridge review: no blocking findings after checking the existing
  local-profile/endpoint identity contract. Optional third-party linters were not
  installed and are not claimed as passing.

## Boundaries

The index is a <=96-character extractive label, not an LLM semantic summary. Directory
and notebook consume the historical budget; the active turn does not. The entire
directory is supplied or the operation fails explicitly at its safety cap—no hidden
directory truncation. Original records remain locally archived but long reads are
paged and bounded per run. See `AGENT_FRAMEWORK.md` for exact limits and privacy scope.

No Planner integration, UI redesign, vector search, semantic ranking, graph resume
checkpoint, multi-account system, archive-management UI or bundled Python is added.

## Follow-up: expandable operation details

Owner requested inspectable UI operations after the four-strategy delivery. The
focused timeline change adds collapsed per-tool rows (arguments, result, call ID,
execution duration, memory range/search overlap); it is not a full UI redesign.

Actual `kimi-k3` UI acceptance returned project `琥珀-731🙂` and delivery `周五`,
with these measured tool details:

```json
{"name":"search_memory","arguments":{"limit":5,"query":"琥珀"},"matchedTurnIds":[11,13,14,16,18]}
{"name":"read_memory","arguments":{"count":2,"start_turn_id":14},"turn_ids":[14,15],"complete":true}
```

The UI smoke clicked the collapsed read tool and verified a visible parameters
section. An initial attempt targeted an old still-running development instance and
failed this check; after closing the two exact test instances and launching the
current version, the full real-model/UI test passed. A subsequent actual page reload
(no extra model request) produced:

```json
{"restored":true,"expanded":true,"parametersPresent":true,"memoryLinkPresent":true}
```

Final follow-up checks: Node 161/161, zero skips; Python 28/28; syntax; both Electron
production-UI tests (error visibility plus expand/collapse/reload/inert HTML); and
independent Python/JavaScript safety review passed. Review corrections expanded
credential-key redaction and made truncation markers consume the documented text
budget. Optional static-analysis packages remain uninstalled.

Tool details currently arrive with the completed response, not as live intermediate
events. Failed-run partial traces are not retained. Legacy turns without saved
arguments/durations are not backfilled with invented data. See the framework guide
for display budgets, redaction scope and the 30-turn UI cache boundary. REVIEW and
development-only Python packaging status are unchanged.
