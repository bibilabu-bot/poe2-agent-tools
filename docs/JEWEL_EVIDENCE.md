# Jewel runtime evidence

Status: accepted controller evidence from P2AT-008C  
Baseline investigated: `383c48ddef9c5fdbc4e8461f970d0cde35db6dd2`  
Investigation date: 2026-09-10

## Verified inputs

The Planner's cached `tree-pre.json` and `official-data.json` were independently checked against `data/upstream-sources.lock.json` before inspection.

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| `tree-pre.json` | 1,580,743 | `bbb3b537669ad3ceadda62bcae5f824d3b6f4f23c8a917e0ab5ef858c4192796` |
| `official-data.json` | 5,140,821 | `b52be9c4f17e4114064255ef1b8c58292e9db0e395d95af235a8d3fef0d44642` |

The current files contain 5,102 slim-tree nodes, 6,021 slim-tree edges and 5,153 official nodes.

## Socket evidence

`official-data.json` contains 31 IDs in top-level `jewelSlots`. Nineteen resolve to official node objects with `isJewelSocket: true`; twelve references have no node object and are not renderable from this dataset.

The nineteen resolved nodes divide into:

- 12 ordinary tree sockets;
- 1 Witch3 ascendancy-specific container, `Crystalline Phylactery` (`17788`);
- 5 Voices Sinister/Blighted sockets;
- 1 Zarokh's Gift Sinister/Blighted socket (`11184`).

The accepted ordinary runtime socket IDs are:

`2491`, `7960`, `21984`, `26196`, `26725`, `32763`, `46882`, `54127`, `55190`, `60735`, `61419`, `61834`.

For ordinary sockets, production recognition must use membership in official `jewelSlots` plus `nodes[id].isJewelSocket === true`, excluding ascendancy and Blighted special cases. Runtime graph identity remains the decimal string form of the numeric skill ID. The official raw `nodes[id].id` should be retained as provenance/validation metadata, not substituted for graph identity.

Current ordinary and Voices socket coordinates match exactly between official data, `tree-pre.json` and Planner world coordinates. Zarokh's Gift is a known ID collision: slim-tree node `11184` is unrelated, while the Planner injects the official node through its sidecar path. It must not be handled as an ordinary socket.

Compiler fixture IDs `100` and `101` occur in neither verified tree and must never be used as production runtime mappings.

## Special sockets

The current official data exposes `isJewelSocket` and `isBlighted`, but no independent `sinister` or `noRadius` field. Locked PoB2 export code states that `JewelSocket && AnointOnly` exports `sinister: true` and `noRadius: true`; current official bytes do not expose the required source flag directly. Sinister/no-radius normalization therefore remains provisional and is excluded from the first ordinary-socket MVP.

`Crystalline Phylactery` has specialized rarity and effect behavior and is likewise excluded from the ordinary-socket MVP.

## Radius evidence

Locked PoB2 `Misc.lua` verifies `PassiveTreeJewelDistanceMultiplier = 1.2`. Locked code also consumes precomputed `node.nodesInRadius[item.jewelRadiusIndex]` and excludes Sinister nodes.

The locked source set does **not** contain the generator for `nodesInRadius`, numeric radius distances, multiplier direction, boundary comparison, or distance metric. The compiler's Euclidean formula text is a local assertion rather than verified upstream behavior.

Locked `ModParser.lua` verifies only these labels and indexes: Very Small 5, Small 6, Medium-Small 7, Medium 8, Medium-Large 9, Large 10, Very Large 11, Massive 12. No numeric mapping is verified.

Until additional immutable evidence is locked and reviewed, runtime radius effects must remain disabled and visibly reported as unavailable. No guessed distance or named-radius conversion may drive Planner behavior.

## Jewel identity evidence

Stable official socket raw IDs and stable jewel modifier IDs exist. No stable unique-jewel definition ID was found in the locked inputs, and the current compiler drops official socket raw IDs. The current PoE2DB fixture exposes display text only.

For the initial catalog, the project must assign immutable, project-owned definition IDs in reviewed source data. IDs must never be regenerated from localized/display names and must not be reused after retirement.

## Controller decisions

1. Build jewel persistence requires a new schema version; schema-v1 unknown fields must not drive jewel behavior.
2. The first visible slice supports only the 12 verified ordinary sockets.
3. Special ascendancy and Sinister/Blighted containers remain unsupported until separately specified.
4. Definition IDs are project-owned immutable catalog identifiers until a verified upstream stable identity is available.
5. Radius visualization/effects remain disabled, with explicit UI disclosure, until the missing formula evidence is accepted.

