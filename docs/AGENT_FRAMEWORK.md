# General agent runtime

P2AT-026A moves the active agent implementation to Python 3.11+. The Renderer UI and Electron security boundary remain JavaScript; agent behavior, tools, bounded model/tool iteration, conversation history and OpenAI-compatible protocol handling live under `apps/planner-desktop/python_agent/`.

Electron starts the Python runtime as a hidden child process and uses newline-delimited JSON requests with unique numeric IDs. The process is launched in Python isolated mode with UTF-8 mode explicitly enabled; Node encodes stdin and decodes stdout/stderr as UTF-8, while Python strictly decodes stdin and reconfigures stdout/stderr as UTF-8. Chinese and emoji round trips are covered through the real child process.

The API key is still persisted only through Electron `safeStorage`; plaintext is passed to Python only in a private stdin message and is never placed in process arguments, environment variables, output or logs. The production Python service persists completed turns and notebook changes together in a local SQLite transaction. Electron retains a bounded in-process recovery cache. On restart the authoritative archive takes precedence over that cache, so completed tool records are not replaced with display-only user/assistant pairs. Failed or interrupted turns do not commit. New session creates a new archive namespace; clearing the key disconnects without deleting archived conversations.

Chat SSE parsing treats explicit `event: error`, top-level `error`, `type: error` and `response.failed` events as failed runs even if text deltas arrived first. No partial text from such a response is returned as success or committed to conversation history.

Python entry points:

- `python_agent/core.py`: `BaseAgent`, `BaseTool`, `ToolRegistry`, provider contract and bounded `AgentRunner`.
- `python_agent/tools.py`: finite-number calculator.
- `python_agent/provider.py`: bounded OpenAI-compatible Models, Chat Completions and Responses JSON adapter.
- `python_agent/service.py`: Python-owned configuration, conversation and runner assembly.
- `python_agent/memory.py`: SQLite archive, full extractive directory, transactional notebook and memory tools.
- `python_agent/rpc_server.py`: narrow JSON-lines process protocol.
- `electron/python-agent-client.cjs`: Electron subprocess lifecycle and request correlation only.

Model discovery remains a narrow Electron transport responsibility and reuses the previously accepted `net.fetch` OpenAI-compatible `/models` adapter. This preserves Windows system proxy/TLS behavior from the working MVP while Python continues to own conversation state, model/tool iteration, tool execution and chat/Responses protocol behavior. The renderer receives model IDs and controlled errors only; the API key is not returned.

Completed user/assistant turns and their bounded operational timeline are persisted locally in the renderer profile, bound to the exact normalized API endpoint, and restored into the Python conversation checkpoint after restart or same-endpoint reconnection. Credentials remain separate in Electron `safeStorage`; failed, cancelled, partial, malformed and cross-endpoint turns are not restored. The timeline exposes elapsed time and operational/tool summaries, never hidden model reasoning.

The earlier JavaScript core remains temporarily as parity-test/reference code but is no longer instantiated by the application runtime. This delivery is a development-environment migration and requires Python 3.11+ on the machine. Building and signing a bundled Python executable for release packages is not implemented by P2AT-026A.

P2AT-024A adds a project-independent agent foundation to the desktop application. It does not import Planner state, game data, DOM or Electron from its reusable core.

## Public modules

- `apps/planner-desktop/src/agent-core/base-agent.js`: `BaseAgent` and the first `ChatAgent`.
- `apps/planner-desktop/src/agent-core/base-tool.js`: `BaseTool`, bounded JSON parsing and the schema-validation contract.
- `apps/planner-desktop/src/agent-core/tool-registry.js`: explicit tool allowlist and provider definitions.
- `apps/planner-desktop/src/agent-core/model-provider.js`: injected provider interface.
- `apps/planner-desktop/src/agent-core/agent-runner.js`: bounded model → tool → model loop.
- `apps/planner-desktop/src/agent-core/calculator-tool.js`: the only MVP tool; finite-number arithmetic without `eval` or side effects.
- `apps/planner-desktop/electron/openai-compatible-provider.cjs`: OpenAI-compatible `GET /models` adapter with Chat Completions and Responses wire support.
- `apps/planner-desktop/electron/agent-service.cjs`: in-memory configuration/conversation owner and narrow IPC handlers.

`ModelProvider.complete()` receives `{ model, messages, tools, signal }` and returns `{ content, toolCalls }`. Each tool call has `{ id, name, arguments }`. `BaseTool` exposes `name`, `description`, JSON-schema-style `parameters`, validated arguments and asynchronous `execute(args, { signal })`.

Future Planner integration must add a reviewed tool to `ToolRegistry`; it must not couple Planner state into `agent-core` or bypass `AgentRunner`.

## Loop and limits

The Python runner uses LangGraph `StateGraph`: `START → prepare_context → model`,
with `model → tools → prepare_context` or `model → END`.
Each invocation owns a fresh `RunState`; nodes return explicit replacement values (no
implicit message append reducer). The existing HTTP provider and tool registry remain
injected dependencies, outside state. Ambient LangSmith tracing is explicitly disabled
so conversations are not uploaded to a tracing service. No automatic retry is enabled.
No graph checkpointer is installed. The owner-approved memory follow-up adds a SQLite
completed-turn archive and extractive index (described below), not intermediate graph resumption.
Cancelled/failed intermediate graph state is discarded, not resumed on the next turn.

Development setup (Python 3.11+), from `apps/planner-desktop`:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
$env:PATH = "$PWD\.venv\Scripts;$env:PATH"
npm test
npm start
```

Electron prefers the local `.venv` automatically; `P2AT_PYTHON` overrides that choice.
On Linux/macOS use `.venv/bin/python` and activate `.venv/bin/activate` for tests.
Release installers still do not include Python or these dependencies.

LangGraph migration verification (2026-09-19): Node 155/155 with the canonical local
official-tree fixture (zero skips), Python 15/15, JavaScript syntax, upstream lock
and jewel fixture checks passed. Real child-process coverage includes UTF-8,
cancel/timeout/restart history recovery and rejection of partial SSE errors.
Independent review found no blocking issue. Live desktop submissions reached the
configured relay but returned HTTP 402, including `deepseek-v4-pro`; therefore a
successful real-service calculator round trip is NOT claimed for this migration.
The app remains available for manual validation after service access is restored.

Follow-up visibility fix: the Planner error overlay style is scoped to `#error`,
not the shared `.error` class. `npm run test:agent-ui` renders the production CSS
in Chromium and asserts that agent message/activity/status errors remain visible
in normal layout while the Planner overlay retains its behavior. CI runs this
with Electron under Xvfb. The regression failed before the fix and passed after.
Live UI error-path acceptance confirmed the HTTP 402 message and failed activity
are visible; this is not successful chat/tool acceptance. Node 155/155 (no skips),
Python 15/15, syntax, source-lock and jewel checks passed. A new success demo video
is deferred until the configured service allows real conversation requests.

The runner makes at most 6 model requests and 12 tool calls per run. It truncates model text at 32,000 characters, bounds tool-call arguments at 16 KiB and each tool result at 8,000 characters. Input is limited to 12,000 characters. The service's working cache trims only complete user/tool protocol turns and retains at most 60 conversation messages / 256,000 serialized characters; this no longer deletes the corresponding SQLite archive. Provider requests are limited to 512 KiB, responses to 2 MiB, provider requests time out after 90 seconds and the whole run after 120 seconds. One session permits only one active run.

### History context selection (2026-09-20)

`python_agent/context.py` selects a contiguous suffix of complete historical turns
within 100,000 Unicode code points. Counted fields are message content and tool
call IDs, function names, arguments and result call IDs; role labels and JSON framing
are excluded. Spaces, punctuation and emoji code points count. This is not a token
estimate or a grapheme-cluster counter.

The current user turn (including all model/tool messages accumulated during that
run), system instructions and tool definitions do not consume the history budget.
Every model request passes through `prepare_context`; no raw message-count slicing
remains. A successful current turn becomes history for the next invocation. Tool
call/result pairing is validated, and an oversized latest historical turn causes
the entire historical suffix to be omitted rather than cherry-picking older turns.

Selection does not mutate or overwrite the stored history. The runner returns the
original history plus the completed current turn, never just its selected model
input. The existing, independent archive/local-profile limits remain in effect;
this is not unlimited archival storage. A content-free RPC report records the
policy, history/current character counts, selected and omitted turn counts.
The unchanged 512 KiB transport limit applies to the full serialized request;
exceeding it fails explicitly without committing the turn. Model token-window
limits remain provider-enforced; 100,000 characters are not guaranteed to fit every
model. No automatic summarization, semantic retrieval or intent classifier is added.

Verification: Node 156/156 (zero skips with canonical tree evidence), Python 20/20,
rendered error checks, syntax, upstream lock and jewel fixture passed. A real Python
subprocess sent exactly 100,000 historical code points plus the full active tool
turn, retained omitted history in its returned checkpoint, and restored it after
restart. Live `kimi-k3` returned a successful calculator trace and `56088` through
the existing Electron bridge. Model choice to answer without a tool is not counted
as tool-loop acceptance; an independent fresh-runtime conversation verified the
actual tool call. No credential was printed or exported.

Text without tool calls finishes the run. Tool calls are validated and executed sequentially, appended with the exact call ID, then returned to the model. Unknown tools, malformed JSON/schema arguments and execution errors become controlled tool results. Cancellation and timeouts propagate through provider and tool signals. No automatic paid retry is performed.

## Provider compatibility boundary

The first adapter follows the OpenAI Chat Completions and Responses tool-call shapes plus the Models list shape. When a responses-only relay returns its HTML frontend or a 404 for Chat Completions, the provider switches to `/responses` and remembers that protocol for the active connection. Bounded JSON responses are accepted for both protocols. Server-sent-event parsing currently supports Chat Completions only; Responses SSE is not supported by this MVP. Compatible vendors may differ. A successful model listing does not prove tool support. A model/service that rejects tools produces an explicit message; users can disable the calculator and use ordinary chat. Model IDs are treated only as inert display/request values.

Implementation references: OpenAI [Models API](https://platform.openai.com/docs/api-reference/models) and [API authentication/reference](https://platform.openai.com/docs/api-reference). The adapter intentionally remains separate because other “compatible” vendors may implement only a subset or vary error behavior.

Only HTTPS base URLs are accepted, except explicit HTTP loopback (`localhost`, `127.0.0.1`, `::1`). Private/link-local IP literals other than loopback, credentials, fragments and query strings are rejected. Redirects are never followed with the key. TLS verification is not disabled. A user-entered DNS hostname remains an explicit trust decision; the MVP does not pin DNS answers.

## Key and session lifecycle

The API Key is accepted only by a password input, submitted through narrow IPC, and immediately removed from the renderer input. Electron `safeStorage` encrypts it with the operating-system credential facility before a versioned cache is written under the application's local user-data directory. The renderer never receives either plaintext or ciphertext. There is no plaintext fallback when OS encryption is unavailable. Status responses expose only connection state, target host, and whether a credential is cached. The key is never logged or included in prompts/tool arguments/results. **清除 Key** removes both the active in-memory credential and its encrypted local cache; changing the API address clears the active connection until the new address and key have been saved successfully.

The working history is memory-resident; full completed turns and notebook state persist in SQLite, and the bounded display timeline remains in the renderer profile. New session, cancellation and configuration generation checks prevent late responses from entering a replacement conversation.

## Durable memory follow-up (2026-09-20)

Production stores `agent-memory.sqlite3` under Electron's `userData` directory. No
new dependency is needed: SQLite comes from Python's standard library. This is local
conversation data, **not encrypted storage**. The configured API key is never supplied
to the memory store. Treat conversational content as private local data and do not
paste credentials into chat or notes. Memory is not uploaded to a tracing service.

- Every successful turn archives its user, assistant and tool messages atomically
  with notebook updates. Failed/cancelled turns and staged notes are discarded.
- Every `prepare_context` injects ALL completed-turn index entries, the notebook,
  `completed_turns` and `current_turn = completed_turns + 1`. Failed attempts do not
  consume an ordinal. The injected block is user-role historical data, never system
  authority. Archived tool calls are evidence, not instructions to execute.
- The first summary implementation is a deterministic **extractive index label**:
  short question/answer excerpts plus tool names, at most 96 code points. It is not
  an LLM semantic summary and can omit important middle-of-turn details; search scans
  complete archived messages, not just these labels. No extra summarization API call.
- Directory and notebook share the existing 100,000-character historical allowance
  with recent raw turns. The active turn is still excluded. Directory JSON is capped
  at 60,000 characters; overflow fails explicitly instead of silently omitting older
  entries. This is not an unlimited-context promise.
- `update_notebook`: replace `goal`, `constraints`, `decisions`; merge arbitrary
  `notes` key/value facts, with null deleting a note. Maximum 8,000 serialized
  characters and 32 named notes. Changes are immediately visible to the next model
  call in the same run, but only persist if the whole turn succeeds.
- `search_memory(query, limit=5, offset=0)`: case-insensitive literal keywords,
  whitespace-separated AND, up to five matches per page. Returns only `turn_id`,
  timestamp, summary, character count and next offset, not original messages.
- `read_memory(start_turn_id, count=1, offset=0)`: one to five consecutive completed
  turns. Returns JSON text fragments up to 1,500 characters; concatenate `text` using
  `next_offset` until `complete=true`. Original tool records are included. Reading
  has a 12,000-character aggregate per-run budget in addition to loop limits; a long
  record may require continued reading in later turns. No silent content truncation.
- These three memory tools are always available in the production conversation.
  The existing UI checkbox still controls only the calculator demonstration tool.
- Existing UI history imports once, atomically, if the active archive is empty;
  subsequent restores use the archive without reimporting or reducing tool records.
  Previously discarded history cannot be recovered retroactively.
- Scope is one local app profile + exact normalized endpoint + active conversation.
  Same-endpoint API-key rotation intentionally preserves conversation continuity.
  This is not a remote-account system: use **new session** when actually switching
  accounts. New sessions retain the previous archive on disk but current tools cannot
  access it; an archived-session browser and deletion UI are not part of this change.

See `MEMORY_ACCEPTANCE.md` for reproducible four-strategy evidence. This remains a
development-environment build; packaged Python is still not implemented. Task REVIEW,
no main merge.

### Expandable operational details

Each completed run now has collapsed native `details` rows under its activity
timeline. Expand a tool to inspect its call ID, arguments, result, and monotonic
execution duration (not provider latency). Memory tools additionally show search
matches, read ranges/page offsets and notebook revision. A read can identify matching
IDs in prior search results; that is an observable overlap, not a claim about the
model's private decision process. All text is rendered with `textContent`.

Python emits the actual arguments and duration. A display-only projection redacts
the configured API key and named credential fields before IPC, limits arguments to
4,000 characters, results to 8,000 and the combined argument/result text per turn to
24,000 (including truncation notices; small call metadata/JSON framing is additional).
Empty fields at exhausted budget show an explicit UI notice. Model/tool execution data and archived original records are not
changed by these display limits. This is not a general detector of all user secrets.

Display details persist with the latest 30 complete UI turns (matching the bridge's
60-message restore boundary). Storage pressure drops oldest complete UI triplets;
the full SQLite archive is unaffected. Old records without arguments show "未保存"
rather than fabricated parameters/timing. This version displays tool details once
the entire response returns; live intermediate tool-event streaming and preservation
of failed-run partial tool traces are not included. No hidden reasoning is displayed.

Verification: pure trace tests, real-subprocess argument/duration assertions, and
`npm run test:agent-ui` with production markup/scripts/CSS verify expand/collapse,
reload restoration and inert HTML inside tool results. The Electron UI tests own
their exit status explicitly so closing a window cannot hide assertion failures.

Readability follow-up: `read_memory` metadata and its nested JSON text are displayed
separately. Complete offset-zero records are parsed and formatted with two-space
indentation; partial pages remain labeled literal fragments. No blanket backslash
replacement occurs: paths/quotes retain their original semantics, and wire/storage
records are unchanged. Production UI and regression checks: Node 163/163 (zero skips),
Python 28/28, both rendered UI fixtures, and independent review passed. The live
window was refreshed without a model request, confirming indentation and absence of
the outer JSON-string escaping.

Timeline styling follow-up: completed turns omit the redundant sent/tool-done/reply
checklist and retain elapsed time plus the expandable tool rows. Running and failed
turns retain their status messages. Tool rows use transparent, borderless styling,
including when expanded; keyboard focus outlines remain for accessibility. Existing
stored steps remain compatible but are not repeated in the completed UI. Production
fixture checks verify no checklist DOM rows and transparent/zero-border computed
styles before expansion, after expansion and after reload. Node 163/163, Python
28/28, rendered UI fixtures and independent review passed.

Timing/icon follow-up: tool execution duration retains three decimal places in
milliseconds instead of integer rounding. Durations below one millisecond
(including legacy stored zeroes) display as `<1 ms`; missing durations display as
unrecorded. The duration tooltip distinguishes local tool execution from model
waiting and overall turn time. Visible sequence badges are removed, while internal
ordering remains intact. Static, monochrome SVG icons distinguish memory search,
memory reading, notebook edits, calculation and unknown tools. Chinese summary
labels accompany decorative icons; expanded details retain the original tool name.
Node 164/164 (zero skips), Python 29/29, rendered UI fixtures and independent review
passed. The live renderer confirmed search/book icons, `<1 ms` labels and zero
borders without sending another model request.

Scroll follow-up: the Agent view declares a dark native color scheme and thin
dark scrollbars, including nested tool results and the composer. New messages,
activity state/step/trace changes and restoring/showing the view schedule a single
bottom scroll after layout. Elapsed-time-only ticks and manual detail toggles do
not force scrolling. This does not add runtime token/tool-event streaming: tool
details still arrive with the complete response. Rendered Electron fixtures verify
overflow, following both waiting activity and tool/reply completion, preserving a
manually scrolled position during timer ticks, and computed nested scrollbar colors.
Both UI fixtures and the syntax suite passed.

Settings follow-up: Settings is a third top-level page. Existing chat controls are
moved once into its host (same DOM IDs and listeners); switching pages preserves
conversation, draft and mounted Planner state. Chat credentials retain the existing
storage path and model preference. Independent embedding/reranker profiles use
trusted IPC and separate AgentCredentialStore directories under retrieval-settings.
Keys and model metadata are OS-encrypted; renderer status never returns a key.
Blank keys retain only a same-endpoint saved key; changing endpoint requires a new
key. HTTPS URLs with credentials, queries or fragments are rejected. Writes and
clears are serialized and encryption failure has no plaintext fallback. Explicit
save/clear buttons report errors and clear password fields. Retrieval status always
says unverified/not yet wired into RAG; no retrieval API request is made.
Defaults are text-embedding-v4 with 1024 dimensions and qwen3.7-text-rerank, with
editable endpoints/models. The desktop application must restart for the new
preload/IPC methods. Tests cover independent persistence, safe status, endpoint-key
binding, validation, untrusted callers, encryption failure and rendered navigation,
draft preservation and settings saves. Node 167/167 (zero skips), Python 29/29,
both rendered Electron UI fixtures and syntax checks passed. Settings rendering
was visually inspected with synthetic data. No real retrieval-service call was made.

Model-picker follow-up: embedding and reranker settings offer explicit preset
dropdowns plus custom IDs. The list is labelled as presets, not live account
discovery; selecting a model never rewrites the endpoint or key. Embedding dimension
options follow known text-model capabilities (Alibaba synchronous embedding API
documentation, checked 2026-09-20). Previously stored incompatible dimensions show
a re-save warning rather than claiming the displayed correction is already saved.
Rendered UI tests cover preset selection, dimension changes and custom-ID saving;
the three credential/settings tests and syntax checks also pass.

Native editing follow-up: editable inputs receive an Electron context menu using
native editing roles. Password fields disable cut/copy while allowing paste when
Chromium reports it available. No clipboard read or logging is introduced. Two menu
unit checks, syntax checking and both rendered UI fixtures passed. User clipboard
contents were not accessed during verification.

Connection-test follow-up: each retrieval profile has an explicit paid-API test
button using current form values, or a stored key only for the same endpoint.
Fixed synthetic text is sent; no history/Planner data or automatic persistence.
Electron net.fetch retains desktop network compatibility, rejects redirects and
omits cookies. Tests have a 15-second timeout and 256 KB response cap. Embedding
responses must contain a finite nonzero vector matching configured dimensions;
rerank responses must contain two distinct valid indexes and finite scores. Both
DashScope native and flat rerank response shapes are supported. qwen3-rerank with
the native endpoint reports the required endpoint correction before sending.
Only static errors/HTTP status and timing reach the renderer; provider bodies and
raw transport exceptions never do. Passing validates connectivity/response shape,
not domain ranking quality or RAG integration. Mock tests cover success, malformed
results, HTTP/business errors, timeout, size bounds, cached-key binding, trust and
non-persistence; rendered fixtures verify success/failure feedback and button reset.
No live credential was used for this implementation verification.

## Run and review

From `apps/planner-desktop`:

```bash
npm ci
npm start
```

Open **智能体**, enter the service URL and key locally, connect, fetch or manually type a model, then send a message. No real-service claim is made without a user-supplied key. Automated tests use explicit mock providers and HTTP responses.

The no-secret preview is stored at `docs/assets/screenshots/agent-mvp.png`. It is captured while Planner data is unavailable to verify that the Agent view is not gated by tree initialization.

### Live compatibility acceptance (2026-09-19)

A user-authorized, low-limit third-party OpenAI-compatible relay was used for live acceptance. `GET /v1/models` returned three selectable models. `deepseek-v4-flash` completed ordinary Chinese chat and the full two-request calculator loop (`123 × 456 = 56088`) with the exact tool call ID preserved. One advertised model returned HTTP 402 and another returned an empty HTTP-200 message for ordinary chat / truncated text after a tool result; these are now surfaced as provider failures rather than presented as successful empty replies. This evidence validates the application loop and also demonstrates why listing a model cannot be treated as a capability guarantee. Credential-cache tests use synthetic secrets and verify that plaintext is absent from disk, encrypted credentials restore in a fresh store instance, clearing removes the cache, and unavailable OS encryption fails closed.
