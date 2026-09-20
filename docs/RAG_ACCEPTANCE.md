# Read-only RAG — P2AT-026A

Status: REVIEW. Development environment only; Python is not bundled in releases.
No merge to main, attribute classification, fine-tuning or automatic passive allocation.

## Data and retrieval contract

- Electron's existing lock-verified loader supplies runtime nodes, official identities,
  PoB translation and the guarded WeGame translation candidate. Existing localization
  rules are reused, including complete restriction lines and English fallback.
- One document per node: Chinese/English name, existing node kind and complete stat
  text. Identity, provenance and version remain metadata, not invented game semantics.
- Settings offers explicit build/update, progress, stop and retry. Node text is sent
  to the selected embedding service; query and up to 100 distinct candidate texts go to reranker.
  Costs depend on the configured service. Merely saving settings does not build.
- Local SQLite `passive-rag.sqlite3` stores public records and deduplicated vectors.
  Keys remain in OS-encrypted profile files and in the trusted process pipe, never
  model tool arguments, index records or logs.
- Embedding endpoint/model/dimensions identify vector space. Complete lock and
  localization candidate manifests plus corpus/localization/stat projection code
  identify source compatibility. Changes invalidate readiness, not completed vectors.
- Build batches are cached independently. Only a fully successful build publishes
  the new node index in one transaction; cancellation retains the previous index.
- `search_passive_nodes(query)` embeds the query, performs exact cosine comparison
  against local vectors, deduplicates identical texts, reranks the top 100 distinct
  candidates and returns the top 5 metadata records. Equivalent-node IDs are included
  up to 20 per match, with explicit total and completeness indicators.
  It is not an exhaustive listing, and relevance scores are not calibrated certainty.
- `read_passive_nodes(ids)` reads up to 3 original records, including all conditions
  and drawbacks, under a 7,000-character result budget. It never changes allocations.
- `search_memory_semantic(query)` uses only the current conversation's completed-turn
  summaries, returning metadata; existing `read_memory` reads original consecutive
  turns. Full transcripts are not uploaded for embedding. First version supports up
  to 1,000 summaries and explicitly errors above that limit; keyword search remains.
- Tool traces expose arguments, candidate/rerank counts, IDs, version and read results
  through existing expandable, inert-text UI details.
- Optional retrieval initialization failures disable retrieval for that turn, not
  ordinary chat. The model is explicitly told it must not claim retrieval succeeded.
  Settings continues to report the configuration/index error.

## Safety correction during acceptance

A separate Electron acceptance process initially used the wrong encryption context.
The pre-existing credential reader deleted the embedding encrypted file on decrypt
failure. The owner was informed and re-saved the key locally. Reads now preserve
encrypted bytes on any decoding/decryption failure; an independent regression test
confirms recovery. Acceptance sets the application's userData before Electron ready.
No credentials are included in this report or test evidence.

## Repeatable verification

Activate the desktop `.venv`, provide the existing lock-verified fixture paths, then
run `npm test`, `npm run check`, and `npm run test:agent-ui`. Offline tests include
actual isolated Python subprocesses with UTF-8, reranker failure, restart, mid-build
cancellation, preservation of the published index and reuse of completed batches.

Opt-in live acceptance: from `apps/planner-desktop`, set `P2AT_RAG_LIVE=1` and run
`electron tools/rag-live-acceptance.cjs`. This uses saved service profiles, makes real
billable calls, and builds the application's real public-node index. Chat and memory
checks use a separate synthetic database in OS temp, never reset the user's chat.
The script prints only public node evidence and synthetic dialogue. There is no
production special case for the acceptance query or node ID.

## Verified evidence — 2026-09-20

- Node: 183/183, zero skips. Python: 36/36.
- Production-renderer UI fixture: settings build/progress/cancel/ready states,
  expandable details, inert text, reload, scroll following and existing Planner
  overlay checks passed. This is separate from the live provider acceptance below;
  it does not claim a manually clicked live-model UI test.
- Syntax checks, upstream lock validation and jewel fixture verification passed.
- Independent code review: no blocking findings after corrections.
- Final live acceptance exited 0, through Electron AgentService and a real isolated
  Python process, using saved credentials and a separate synthetic conversation.

Condensed live log fields (public data and synthetic conversation only):

```text
RAG_PROGRESS {"completed":2201,"total":2201}
RAG_BUILD {"ready":true,"count":5102,"version":"88413d7b4022edb948c3daa0cf4b4d123331b748a5de9cfb17122afff7a78fd3"}

Query: 有没有哪个天赋可以通过生命再生回复能量护盾
RAG_SEARCH first match:
  id: "52"
  name: "狂热者誓言"
  similarity: 0.828824
  rerank_score: 0.99358
  candidate_count: 100
  total: 5102

RAG_READ node 52:
  再生的溢出生命回复会作用于能量护盾。
  能量护盾无法充能。

RAG_AGENT actual tool sequence:
  search_passive_nodes {"query":"生命再生 回复 能量护盾 天赋"} -> ok
  read_passive_nodes {"ids":["52","33404"]} -> ok
Answer excerpt:
  有，关键天赋 狂热者誓言（Zealot's Oath，节点 ID 52）正好实现这个效果：
  再生的溢出生命回复会作用于能量护盾。
  能量护盾无法充能。

RAG_MEMORY actual tool sequence:
  search_memory_semantic -> turn_id: 1, metadata_only: true,
    coverage: "completed_turn_summaries", rerank_score: 0.950388
  read_memory {"start_turn_id":1,"count":1} -> complete: true
Answer excerpt:
  测试项目的上线安排在周五。
  原文只提到“周五”，没有指定具体是哪一周或具体日期。
```

Acceptance uncovered and corrected two additional issues: retrieval transport now
explicitly negotiates JSON (and rejects non-JSON instead of applying the chat SSE
parser); duplicate small-passive documents no longer crowd out distinct mechanics.
Tests cover both. The hosted rerank request/response adapter follows the
[provider API contract](https://help.aliyun.com/zh/model-studio/text-rerank-api).
One earlier combined run failed with a network error during memory verification;
the final complete rerun succeeded. No automatic production retry hides failures.

The answer prompt also forbids unsupported exclusivity claims: disabling recharge
does not establish that every other recovery mechanism is disabled. Generated
explanations still require evidence review; passing this question is not proof that
every game-mechanics query is accurate or that top-5 retrieval is exhaustive.
