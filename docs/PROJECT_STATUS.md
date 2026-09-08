# Project status

Last updated: 2026-09-08

## Product objective

Build a maintainable PoE2 desktop build planner with reliable passive-tree allocation, localized data, offline-capable resources and an extensible jewel/rule engine.

## Current baseline

| Area | State | Evidence / notes |
| --- | --- | --- |
| Repository migration | Complete | ChatGPT export reorganized and committed to `main` |
| Desktop shell | Prototype | Electron 0.2; isolated preload and local resource protocol |
| Passive tree renderer | Prototype | Canvas2D, full graph, atlas sprites and camera controls |
| Allocation | Prototype | Normal, ascendancy and weapon-set allocation present |
| Conditional/hidden nodes | Prototype | Conditional reveal and external hidden-node sidecar present |
| Chinese localization | Prototype | Runtime translation from community PoB2 data |
| Local resource cache | Implemented, not fully exercised | Cache-first Electron protocol; first-run download still required |
| Build save/open | Interface only | IPC API exists; planner state is not connected |
| Jewel compiler | Fixture-ready | Compiler creates sample normalized JSON and rule families |
| Jewel integration | Not started | Compiler output is not consumed by Planner |
| Automated tests | Missing | Only syntax checks currently exist |
| Packaging/release | Not started | No installer, CI or release workflow |
| Licensing/attribution | Incomplete | Disclaimer exists; formal license and third-party inventory pending |

## Verified baseline

At migration time:

- Electron main, preload and planner scripts passed `node --check`.
- Desktop dependency tree installed with lifecycle scripts disabled.
- Jewel compiler fixture completed with 3 mods, 2 sockets, 6 unique jewels and 9 rule families.
- All committed JSON parsed successfully.
- Web `index.html` embedded script matched the standalone `planner.js` snapshot.

Electron itself was not launched during migration because its binary download was interrupted by a network reset. This is an environment limitation, not proof of runtime correctness.

## Immediate project risks

1. Core allocation behavior has no regression tests.
2. The desktop renderer is approximately four thousand lines in one JavaScript file.
3. External datasets track moving branches/URLs rather than pinned versions.
4. Build persistence is not connected, so users can lose planner state.
5. The repository has no automated CI gate.

## Next milestone

Milestone M1 — Reliable engineering baseline:

- capture existing allocation behavior in automated tests;
- introduce a repeatable CI check;
- define and implement versioned Build JSON persistence;
- document upstream data provenance and pinning policy.
