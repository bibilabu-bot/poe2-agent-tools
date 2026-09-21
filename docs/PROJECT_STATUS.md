# Project status

Last updated: 2026-09-21

## Product objective

Build a maintainable, free-to-use and publicly released PoE2 desktop build planner with reliable passive-tree allocation, localized data, offline-capable resources and an extensible jewel/rule engine. Voluntary donations or sponsorship may support the project without gating application features.

## Current baseline

Pending REVIEW on P2AT-028A3: always-visible prompt close control, Chinese defaults
(five system/six tool blocks), safe legacy-override migration and removal of the
calculator demo. This task does not supersede controller acceptance below until
reviewed and merged. See `SYSTEM_PROMPTS.md` for this branch's implementation.

Latest controller acceptance: `08bb0134feff4ed3957269149cf22d93524a45bd` (2026-09-21), adding P2AT-028A2 complete prompt maintenance split into five system blocks and seven tool-description blocks. Exact defaults, runtime tool schemas and permissions remain unchanged; v1 overrides migrate without implicit writes. The full offline suite, syntax checks, synthetic Electron save/restart/reset/busy-state checks and two independent reviews passed. The prior `571e187a24825cd19b66a3ee2a747b60aa60394a` acceptance covers P2AT-028A. Python 3.11+ and installed requirements remain required: no bundled runtime or release installer is accepted.

Controller integration accepted on 2026-09-19: P2AT-021C, 022A, 022B, 023A and 024A, including integration corrections at `9b08b1036eae49704e2736be708a2f8f1692f739`. The latest integrated desktop suite is **152/152, zero skips with locked official-tree evidence**. Native Windows page switching and panel operation passed. See `docs/PRODUCT_INTEGRATION.md` for exact included commits and deferred work. Earlier per-branch counts below are historical delivery evidence, superseded by this integration result.

| Area | State | Evidence / notes |
| --- | --- | --- |
| Repository migration | Complete | ChatGPT export reorganized and committed to `main` |
| Desktop shell | Prototype | Electron 0.2; isolated preload and local resource protocol |
| General agent runtime | Accepted developer build | Python/LangGraph loop, durable endpoint/session-scoped SQLite memory, isolated session selection, streaming and tool details; OS-encrypted credentials remain in Electron. Read-only knowledge retrieval does not mutate Planner state |
| System prompt governance | Accepted | Five system blocks and seven tool descriptions can be inspected, edited locally and reset; default combinations are byte-identical, overrides do not alter schemas or grant tools, and private runtime memory/credentials are excluded |
| Passive tree renderer | Graph core accepted | Canvas2D rendering remains in Planner; pure graph construction, queries and deterministic eligible paths passed controller acceptance |
| Allocation | Prototype | Normal, ascendancy and weapon-set allocation present |
| Conditional/hidden nodes | Prototype | Conditional reveal and external hidden-node sidecar present |
| Chinese localization | Whole-line repair accepted | Fixed WeGame candidate with guarded identity/semantic use, complete PoB2 fallback and disclosed English; runtime name gate added during integration, canonical game-data lock unchanged |
| Local resource cache | Lock-integrated | Bundled and user-cache bytes are verified against ADR-007 before use; cache misses download immutable locked URLs |
| Build save/open | Implemented | Desktop Save/Open controls, schema-v1 codec, safe file IPC and transactional state restoration accepted; Windows runtime round trip verified |
| Build JSON contract | Schema v2 specified | Schema v1 remains implemented; P2AT-008D adds the accepted v2 jewel-instance/placement contract, migration and preservation policy for later codec/UI work |
| Official `.build` interoperability | Foundation accepted | ADR-010 selects a lossless native `.build` plus separate strict GGG export; P2AT-013 adds 18 byte-stable documented/derived fixtures and a lock-verified passive-ID mapping oracle, without codec or compatibility claims |
| WeGame Build import | Accepted partial import | Transactional preview/application; owner-validated experimental `set1`/`set2` mapping saves native weapon sets after explicit confirmation. Overrides, jewel contents and unresolved evidence remain inactive and memory-only; no full-Build compatibility claim |
| Jewel compiler | Fixture-ready | Compiler creates sample normalized JSON and rule families |
| Jewel integration | Contract ready | Only twelve verified ordinary sockets are eligible for the first slice; implementation, special sockets and radius effects remain deferred |
| Automated tests | 193 Node + 44 Python | Independent full-suite acceptance with locked official-tree evidence and zero skips; real synthetic Electron sessions/layout/mastery regressions also passed |
| Continuous integration | Implemented | Offline desktop tests, syntax checks and jewel fixture verification on PRs and `main` pushes |
| Packaging/release | Not started | No installer or release workflow |
| Upstream data governance | Runtime integrated | ADR-007 and the validated 26-file canonical source lock govern Planner runtime identity and integrity; jewel compiler migration remains pending |
| Licensing/attribution | Incomplete | Point-in-time findings and no-bundle controls are recorded; formal license confirmation remains pending |
| Distribution model | Decided | Free public release with optional voluntary sponsorship; third-party redistribution rights remain a release gate |

## Verified baseline

At migration time:

- Electron main, preload and planner scripts passed `node --check`.
- Desktop dependency tree installed with lifecycle scripts disabled.
- Jewel compiler fixture completed with 3 mods, 2 sockets, 6 unique jewels and 9 rule families.
- All committed JSON parsed successfully.
- Web `index.html` embedded script matched the standalone `planner.js` snapshot.
- P2AT-001 added four passing offline unit tests for extracted stat-display and template utilities.
- P2AT-002 added a read-only GitHub Actions workflow and deterministic temporary-copy verification for jewel fixtures.
- P2AT-003/P2AT-003A approved and integrated the versioned schema-v1 Build JSON contract and ADR-006; persistence implementation remains pending.
- P2AT-004A implemented and tested the pure schema-v1 codec, including deterministic serialization, validation, bounded diagnostics and opaque preservation.
- P2AT-004B implemented bounded UTF-8 reads, structured Build-specific IPC and tested same-directory safe replacement with failure recovery on Windows.
- P2AT-004C connected visible Save/Open controls to live Planner state, removed the duplicate embedded runtime, passed 38 offline tests, and demonstrated a non-empty Build save/reset/reopen round trip in Electron on Windows.
- P2AT-005/P2AT-005A established ADR-007 and an accepted 26-file canonical source lock; 25 immutable GitHub entries were independently rehashed during controller acceptance, while the live PoE2DB page had already drifted and remains a manually reviewed auxiliary snapshot.
- P2AT-005B migrated the Planner's eight core resources and eight class portraits to lock-derived immutable URLs with pre-use and pre-write integrity checks; compiler acquisition remains unchanged.
- P2AT-006A characterized existing category-specific path behavior and moved graph construction, adjacency and deterministic shortest eligible paths into an accepted browser/Node pure module; all 64 desktop tests and Windows Electron smoke checks passed.
- P2AT-013 established 18 documented/derived official `.build` fixtures, cross-checkout canonical byte hashing and a lock-verified numeric/raw passive-ID mapping oracle; all 70 desktop tests passed, while game and website compatibility remain explicitly unverified.
- P2AT-021A captured and sanitized one public WeGame share across 13 response shapes; all 150 observed allocation IDs mapped against the locked official tree, with no production network importer or endpoint-stability claim.
- P2AT-021C exposed a Windows import preview and transactional replacement flow. The project owner validated the current public sample, including the experimental `set1` → Weapon Set I (`16/17`) and `set2` → Weapon Set II (`17/17`) mapping; missing slim-catalog node `52669` is disclosed and requires acknowledgment rather than being silently dropped. This single sample does not establish a universal upstream numbering contract.

Electron was not launched during the initial migration because its binary download was interrupted by a network reset. P2AT-004C later completed a successful Windows Electron runtime acceptance for Build persistence.

## Immediate project risks

1. Core allocation mutations still need broader regression coverage beyond the extracted graph/path behavior.
2. The desktop renderer is approximately four thousand lines in one JavaScript file.
3. Planner runtime data now consumes the canonical lock, but the jewel compiler still fetches through its legacy moving URLs until a follow-up migration.
4. First-run use still depends on a single overseas transport per resource; China-accessible mirrors, offline import and distributable bundled data remain unresolved.
5. Packaging and release automation have not been established.

## Next milestone

Milestone M1 — Reliable engineering baseline:

- capture existing allocation behavior in automated tests;
- introduce a repeatable CI check;
- define and implement versioned Build JSON persistence;
- document upstream data provenance and pinning policy.

Milestone M2 begins with the staged jewel slice: P2AT-008E implements Build-v2 codec/state behavior, followed by visible ordinary-socket equipment. Complex sockets, verified radius behavior and rule effects follow separately.

P2AT-008C verified 12 production ordinary socket IDs plus seven special containers. P2AT-008D records the schema-v2 persistence and catalog contract for ordinary equipment. Radius behavior remains deferred because the locked inputs do not contain its numeric membership algorithm.
