# Agent collaboration handoff

Updated: 2026-09-20  
Branch: `task/P2AT-026A-python-agent-runtime`  
Verified branch HEAD before this handoff: `baa751b263f7c312c6e14d96ae695444dd49874a`  
Task status: `REVIEW`; do not merge `main`.

## Owner-approved mastery glow correction (2026-09-20)

The glow is a decorative cluster center, not the hovered node itself. Locked runtime
node 19044 (Arcane Intensity) belongs to the cluster containing decoration 53188
(Mana Mastery), centered at 2922.78 / -9973.75. Runtime group 1002 corresponds to
official group 1041 here; group numbers must not be joined across datasets.
Both exports explicitly connect decoration 53188 to exactly 16256, 19044, 3567 and
39567. Runtime raw mastery edges match official in/out membership for all 359 centers.
96 centers have declared triggers in other visual groups, so group equality alone
would incorrectly suppress legitimate effects.

The previous code preferred global texture identity and then every node in the visual
group. The locked slim runtime has no activeEffectImage fields, so its current fallback
could activate this glow from ordinary small node 4828 despite no designated trigger
being allocated. This is a reproducible mechanism; no private user allocation was read
to infer the exact screenshot state.

The new pure mastery-visual-state helper indexes only explicit raw graph neighbors,
excluding other mastery, ascendancy, display-only/legacy and class-start nodes.
Texture identity, names, spatial proximity and visual group equality do not create
membership. Missing adjacency produces no triggers; explicit membership still works
without group/texture fields. No graph traversal or Build data is modified.
Allocation checks union general, weapon I and weapon II because the existing canvas
renders both weapon allocation layers concurrently; weaponMode selects editing/path
preview rather than hiding the other weapon group. Hover/preview sets are never inputs.
Indexing occurs once after raw graph creation; no per-frame whole-tree candidate scan.

`npm run test:mastery-visuals` runs pure regressions and isolated real Chromium Canvas
checks using hash-verified runtime, official and original atlas assets. It verifies
all 359 mappings, then draws the unchanged production drawMasteryVisuals function:
remote decoration 10495 triggered by 24120 lights normally while local 53188 stays dark;
local small 4828 and preview 19044 stay dark; actual 19044 allocation lights it;
removal extinguishes it; weapon I and II each light it. Pixel alpha is checked for
the original atlas rendering. User app/allocations and API profiles are not touched.
Glow material, alpha, footprint and fallback drawing code are unchanged. REVIEW.

Validation: full desktop Node/Python suite passed (Python 39/39), syntax checks,
mastery pure tests 5/5, locked-data Canvas fixture and prior node UI rendering checks
passed. Independent read-only review found no blocking issues. The Canvas fixture
extracts production drawing functions and constructs a simplified eligibility index;
it is rendering/membership evidence, not full Planner startup end-to-end coverage.

## Owner-approved urgent Planner UI follow-up (2026-09-20)

Controller dispatched three bounded UI corrections while agent diagnosis is paused:

- Search now offers text or exact node-ID mode. Exact lookup uses the ID map, ignores
  the text category filter, and distinguishes missing IDs from currently invisible
  nodes. It does not reveal nodes or change allocation restrictions.
- Notable names never receive persistent Canvas labels, including selected,
  search-highlighted and instill-exclusive notables. Keystone and other categories
  retain their prior label policy.
- Node tooltips render every stat, including multiline conditions and drawbacks,
  through existing localization and textContent. Viewport-bounded tooltips scroll,
  and moving from canvas onto the tooltip preserves it for reading.

Repeatable checks: `npm run test:planner-node-ui` runs search/label regressions and
an isolated Electron rendering fixture. The fixture verifies hashes of existing
public game-data cache files, runs the production tooltip/translation functions,
and checks node 54814 in English, Chinese and bilingual modes at 800x600.
All three modes contain both Presence area 30% and Spirit 4%. It also checks
80 two-line stats, the final item, scrolling, viewport bounds and inert HTML.
Native Chromium input moves gradually from a node into its fixed-position tooltip
and wheels the overflow successfully. The test briefly shows its own isolated window
without focusing it, then destroys only that test window. Ascendancy small nodes
also respect the existing small-node visibility toggle during exact ID lookup.
This is real Chromium rendering with public data, not a live user-app restart.

Existing localization returns “该装备精魂提高 4%” for the Spirit stat; this wording
predates the correction. Translation engine/source policy was intentionally unchanged
and the English/bilingual views retain the exact “4% increased Spirit” evidence.
No model/embedding calls, credentials, Build schema or allocation changes are involved.
Prior agent commits remain preserved; status remains REVIEW.
Validation: desktop Node tests 186/186, zero skips with locked official-tree evidence;
Python 39/39; syntax checks and the real-rendering fixture passed. Independent review
initially found hover accessibility and hidden ascendancy-small-node cases; both were
fixed and covered, and re-review found no remaining blockers.

## Streaming/timeout follow-up

The formerly opaque wait is now request-correlated streaming with safe phase and tool
events. The whole-run guard is 300 seconds because a valid RAG turn may include two
90-second provider inactivity windows plus retrieval. A controlled paid reproduction of
the exact broad question completed in 29.8 seconds: the first model phase began at 1.39s,
its first text arrived only at 29.58s, and no RAG tool ran. Thus that reproduction's blank
wait was upstream first-model latency amplified by the old non-streaming UI, not passive
index/search latency. The original screenshot predates event telemetry and cannot be
retrospectively timed more precisely.

## Immediate user issue — handle first

The owner's latest message is **“什么情况”**, with a screenshot showing their live
question **“你能查询流放之路2的天赋树吗”** stuck for **1 minute** at:

```text
已发送到 kimi-k3
正在等待模型回复…
```

This has not yet shown a tool row, so it is stalled before `search_passive_nodes`, in
the first model request that decides whether to call a tool. The current provider uses
non-streaming model calls (`python_agent/provider.py`, `stream: False`) and Electron's
whole-run timeout is 120 seconds (`electron/agent-service.cjs`, `RUN_TIMEOUT_MS`). The UI
therefore offers no more evidence during a slow first model call and looks frozen.

The previous task has **diagnosed but not changed** this behavior. The next task should:

1. Reproduce the exact broad query through the visible desktop UI and capture the final
   outcome/error around the 120-second boundary. Do not assume the screenshot is an RAG
   search failure: it precedes any recorded tool call.
2. Determine whether the delay is provider/network latency, model tool-selection latency,
   or an application timeout/reporting defect. Make failure/phase visible without exposing
   keys or hidden reasoning.
3. Discuss the desired UX with the owner before widening scope. Likely options are phase-
   specific status and earlier controlled timeout; streaming is a larger protocol change.
4. Run the exact broad question and the accepted specific RAG question end to end before
   delivery. Do not claim success from direct `rag_search` alone.

## Owner requirements and decisions

These are owner requests, not implementation suggestions:

- Python owns only the agent runtime; Electron/renderer/Planner stay as they are.
- Preserve desktop-compatible User-Agent behavior, encrypted credentials, Planner
  decoupling and existing UI. Never print/export keys.
- Use LangGraph for the basic loop.
- Completed turns persist locally. Cancellation, timeout, process restart and SSE errors
  retain completed turns and discard only the unfinished turn. Partial SSE output must
  never be committed as success.
- Historical working context is capped at 100,000 characters; the active turn is excluded.
- Long-term memory comprises: a compact all-turn directory, transactional notebook,
  keyword metadata search, full consecutive turn reads, and semantic search of completed-
  turn summaries. The model knows the current turn number.
- Expandable UI details show tool arguments/results, elapsed time and memory/retrieval
  chain. JSON is formatted, not double-escaped. Avoid duplicate status rows, boxed cards,
  bright scrollbars and stale scroll position.
- Settings is a peer page to Planner and Agent. Chat model/key, embedding and reranker
  are separate settings with dropdowns and real connection tests.
- RAG covers the passive-tree knowledge base and conversation semantic retrieval. No
  attribute classification or embedding fine-tuning yet.
- Passive RAG must be read-only now. Later tree manipulation may use tools, but is not in
  this task.
- Required acceptance question:
  `有没有哪个天赋可以通过生命再生回复能量护盾`
  Expected evidence: node `52`, keystone `狂热者誓言`, exact clauses
  `再生的溢出生命回复会作用于能量护盾。能量护盾无法充能。`
- Do not hardcode that query, node or answer.
- Development-environment migration only. Bundled Python in release packages remains
  deferred.
- Keep branch status `REVIEW`, do not merge `main`.

## Important rejected or deferred directions

- No Planner mutation, auto-allocation or passive topology operations in current RAG.
- No attribute classification, intent taxonomy or embedding fine-tuning yet.
- No full transcript upload for conversation semantic search; only completed-turn summaries
  are embedded, then original text is read locally by metadata.
- No implicit reuse of the chat key for embedding/reranking; profiles remain independent.
- No hidden chain-of-thought display. UI may show operational steps and tool evidence only.
- Do not treat top-5 semantic results as exhaustive or scores as calibrated certainty.
- Do not infer that “Energy Shield does not Recharge” disables every other recovery method.

## Delivered implementation at `baa751b`

- Python LangGraph agent loop, bounded tools/provider, UTF-8 isolated JSON-lines child.
- Local SQLite completed-turn archive, working-context selector, summary directory,
  transactional notebook, keyword/read tools and semantic-memory tool.
- Separate encrypted chat/embedding/reranker credentials and connection tests.
- Settings page, expandable trace UI, dark scrollbars and follow-bottom behavior.
- Passive corpus from lock-verified runtime data plus guarded existing localization.
- Resumable local SQLite vector cache, atomic index publication, source/model compatibility
  identity, cosine recall over distinct texts, hosted rerank, metadata search and bounded
  original-node reads.
- Optional RAG failure does not disable ordinary chat. The model is told not to claim
  retrieval succeeded when it is unavailable.
- Credential reads no longer delete encrypted files on decryption failure. A new explicit
  key can overwrite an unreadable old profile.
- Actual local passive index was built: 5,102 nodes / 2,201 unique texts. This index and all
  credentials are user-local artifacts and are not committed.

## Verified evidence

Full evidence: `docs/RAG_ACCEPTANCE.md`.

- Node tests: 183/183, zero skips.
- Python tests: 36/36.
- Production renderer fixture passed settings build/progress/cancel/ready, expandable inert
  details, reload, scroll behavior and existing Planner overlay checks.
- Syntax checks, upstream source lock and jewel fixture passed.
- Independent review found no blockers after corrections.
- Live end-to-end acceptance through Electron `AgentService` + real isolated Python passed:
  specific query ranked node 52 first, called `search_passive_nodes`, then
  `read_passive_nodes`, and quoted both clauses. Synthetic conversation semantic search
  called `search_memory_semantic`, then `read_memory`, and recovered its weekday fact.
- One earlier combined live run hit a network error; a later complete run succeeded. There
  is no automatic production retry masking errors.

## Key paths

- Agent boundary/timeout: `apps/planner-desktop/electron/agent-service.cjs`
- Child process/UTF-8/progress: `apps/planner-desktop/electron/python-agent-client.cjs`
- Model transports: `apps/planner-desktop/python_agent/provider.py`
- LangGraph service/tool registration: `apps/planner-desktop/python_agent/service.py`
- RAG index/tools: `apps/planner-desktop/python_agent/rag.py`
- Corpus and compatibility identity: `apps/planner-desktop/electron/passive-corpus.cjs`
- Build lifecycle: `apps/planner-desktop/electron/rag-manager.cjs`
- Settings bridge/UI: `electron/retrieval-settings.cjs`, `renderer/retrieval-settings.js`
- Timeline UI: `renderer/agent-panel.js`, `renderer/agent-trace.js`
- Live acceptance: `apps/planner-desktop/tools/rag-live-acceptance.cjs`
- RAG contract/evidence: `docs/RAG_ACCEPTANCE.md`
- Memory evidence: `docs/MEMORY_ACCEPTANCE.md`
- Canonical task scope: `docs/TASKS.md`

## Environment and repeatable checks

Worktree:
`C:/Users/xty12/Downloads/poe2-agent-tools-git-migration/task-P2AT-026A-python-agent-runtime`

Desktop app:
`apps/planner-desktop`

Use the project `.venv` (Python 3.12 currently available) and Node 20+ (the machine used
Node 24). The full suite requires the existing lock-verified acceptance cache variables;
see repository instructions and `docs/RAG_ACCEPTANCE.md`. Core commands:

```text
npm test
npm run check
npm run test:agent-ui
node ../../tools/validate-upstream-lock.mjs
node ../../tools/jewel-compiler/verify-fixture.mjs
```

The opt-in live script makes paid provider calls and must not be run casually. Never log
credentials. It uses saved local profiles and a synthetic temp conversation:

```text
P2AT_RAG_LIVE=1 electron tools/rag-live-acceptance.cjs
```

## Risks and next priorities

P0: diagnose and improve the owner's currently hanging broad-query experience. Preserve
the successful specific RAG path while doing so.

P1: verify the visible desktop UI, not only the acceptance harness, for broad capability
questions, specific node questions, timeout/cancel recovery and subsequent conversation.

P1: ensure phase/error labels distinguish “waiting for model/tool choice”, embedding,
reranking, evidence reading and final model answer. Do not imply a search has started before
the first tool call.

P2: first-run indexing sends all public node descriptions to the selected embedding service
and can take minutes/cost tokens; keep explicit build/progress/cancel and disclose this.

P2: hosted retrieval remains network-dependent. Ordinary chat must continue when optional
retrieval configuration/index initialization fails.

## Repository state at handoff

Before adding this handoff file, `git status --porcelain` was empty at
`baa751b263f7c312c6e14d96ae695444dd49874a`. This file is the only permitted handoff change.
The handoff commit hash and final cleanliness are reported in the originating task response.
