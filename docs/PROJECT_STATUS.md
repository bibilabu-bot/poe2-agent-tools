# Project status

Last updated: 2026-09-09

## Product objective

Build a maintainable, free-to-use and publicly released PoE2 desktop build planner with reliable passive-tree allocation, localized data, offline-capable resources and an extensible jewel/rule engine. Voluntary donations or sponsorship may support the project without gating application features.

## Current baseline

| Area | State | Evidence / notes |
| --- | --- | --- |
| Repository migration | Complete | ChatGPT export reorganized and committed to `main` |
| Desktop shell | Prototype | Electron 0.2; isolated preload and local resource protocol |
| Passive tree renderer | Prototype | Canvas2D, full graph, atlas sprites and camera controls |
| Allocation | Prototype | Normal, ascendancy and weapon-set allocation present |
| Conditional/hidden nodes | Prototype | Conditional reveal and external hidden-node sidecar present |
| Chinese localization | Prototype | Runtime translation from community PoB2 data |
| Local resource cache | Lock-integrated | Bundled and user-cache bytes are verified against ADR-007 before use; cache misses download immutable locked URLs |
| Build save/open | Implemented | Desktop Save/Open controls, schema-v1 codec, safe file IPC and transactional state restoration accepted; Windows runtime round trip verified |
| Build JSON contract | Accepted and integrated | Schema v1 defines durable state, migration, validation, preservation and atomic-save policy in `docs/BUILD_FORMAT.md`; implementation is split into P2AT-004A/B/C |
| Jewel compiler | Fixture-ready | Compiler creates sample normalized JSON and rule families |
| Jewel integration | Not started | Compiler output is not consumed by Planner |
| Automated tests | Baseline established | Node test harness covers extracted stat utilities; broader allocation coverage remains pending |
| Continuous integration | Implemented | Offline desktop tests, syntax checks and jewel fixture verification on PRs and `main` pushes |
| Packaging/release | Not started | No installer or release workflow |
| Upstream data governance | Lock accepted | ADR-007 and the validated 26-file canonical source lock define immutable revisions, per-file integrity and manual promotion; consumers have not migrated yet |
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

Electron was not launched during the initial migration because its binary download was interrupted by a network reset. P2AT-004C later completed a successful Windows Electron runtime acceptance for Build persistence.

## Immediate project risks

1. Core allocation behavior still has no regression tests beyond the initial stat-utility harness.
2. The desktop renderer is approximately four thousand lines in one JavaScript file.
3. Planner runtime data now consumes the canonical lock, but the jewel compiler still fetches through its legacy moving URLs until a follow-up migration.
4. First-run offline use still depends on a previously populated data/resource cache.
5. Packaging and release automation have not been established.

## Next milestone

Milestone M1 — Reliable engineering baseline:

- capture existing allocation behavior in automated tests;
- introduce a repeatable CI check;
- define and implement versioned Build JSON persistence;
- document upstream data provenance and pinning policy.
