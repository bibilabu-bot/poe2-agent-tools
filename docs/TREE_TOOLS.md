# Tree tools contract

Six read-only Python tools providing bounded access to the passive tree and current Build state through an immutable per-run snapshot. P2AT-028B.

## Snapshot identity

Each `agent:send` call freezes a snapshot from the renderer's Planner state (normalized node catalog + Build allocations). The snapshot carries:

- `snapshotId` — content digest covering tree node/edge counts, all five allocation categories, ascendancy ID, and budget maxima. Differs across Build changes.
- `upstreamSnapshotId` — canonical source lock `snapshotId` at capture time (informational).

The snapshot is bound to the sending conversation's `generation`; a cancelled or timed-out run cannot overwrite the current generation's snapshot.

If the Planner has no loaded tree or the renderer cannot produce a valid projection, the snapshot is published as `{snapshotId: "snap-...", _error: "..."}` with zero nodes and empty adjacency. Tree tools return controlled errors, not unexpected tool failures; ordinary chat remains available.

## Tool definitions

### tree_summary

No parameters.

Returns: `{snapshotId, nodeCount, coordinateRange: {min, max}, nodeKinds: {small, notable, keystone, jewel, classstart, ...}, jewelSockets: {total, ordinary, special}, ascendancyNodeCount, conditionalRevealCount, class: {base, selectedAscendancyId}, ascendancyOptions}`.

Output size: bounded by node kind count (fixed).

---

### read_tree_nodes

Parameters: `ids` (1–3 string IDs), `statsOffset` (integer, default 0), `statsLimit` (1–8, default 8).

Returns per node: `{id, name, kind, x, y, stats[statsOffset..+statsLimit], statsOffset, statsLimit, statsTotal, statsComplete: bool, nextStatsOffset?: int, neighbors, neighborCount, neighborsTruncated, allocated: bool, allocationCategories, isJewelSocket, isOrdinaryJewelSocket, isKeystone, isNotable, isClassStart, isConditionalReveal, constraintSatisfied, snapshotId}`. Missing IDs appear in `missing` array.

Pagination: when `statsComplete === false`, read the next page with `statsOffset = nextStatsOffset`. `nextStatsOffset` is absent on the last page. `statsLimit` respects the original request size for final-page truncation.

Total per-node output: ~2KB for a full-stats node. Three nodes × 8 stats each ≈ 6KB.

Controlled errors: `INVALID_TOOL_ARGUMENTS` (wrong count, non-string IDs).

---

### search_tree_nodes

Parameters: `query` (1–200 chars), `offset` (integer, default 0).

Exact numeric ID match returns immediately. Otherwise deterministic lexical search: name-prefix match → name-contains match → stat-text-contains match, each tier limited to `MAX_SEARCH_RESULTS + offset` total candidates. Results paginate via `offset`; `nextOffset` present when more pages exist.

Returns per match: `{id, name, kind, x, y, neighborCount, allocated, allocationCategories, isJewelSocket, isOrdinaryJewelSocket, isKeystone, isNotable}`. Full stats NOT included; use `read_tree_nodes` for detailed inspection.

Result: `{matches[], query, totalMatches, matchType: "exact_id" | "lexical", nextOffset?, snapshotId}`.

Upper bound: 16 matches per page, no vector/reranker dependency.

---

### read_tree_neighborhood

Parameters: `nodeId` (string), `maxHops` (1–5, default 2), `maxNodes` (1–50, default 30).

BFS from the center node using real adjacency from the allocatable graph. Returns: `{center: {id, name, kind, x, y, stats[0..4], ...}, hop1: {count, nodeIds[0..20], truncated?}, hop2: {...}, ..., totalVisited, maxHops, truncated: bool, snapshotId}`. `truncated === true` when `maxNodes` reached. No further paging; increase `maxNodes` for more.

Controlled errors: `NODE_NOT_FOUND` (missing center node).

---

### find_tree_path

Parameters: `targetId` (string), `category` (`"general"|"weaponSet1"|"weaponSet2"|"ascendancy"`, default `"general"`), `startId` (string, optional).

Without `startId`, returns the shortest allocatable path from the current allocated tree to the target. With `startId`, returns the shortest eligible path between that node and the target. Path nodes run start→target. Each node: `{id, name, kind, alreadyAllocated: bool, isTarget: bool}`.

Result: `{path, pathLength, edgeDistance, nearestAllocatedId, newNodesCount, newNodeIds, direction: "start_to_target", category, reachable: bool, snapshotId, warning?}`.

Controlled errors: `NODE_NOT_FOUND` (missing target/start), `NO_ASCENDANCY` (ascendancy category with no ascendancy selected).

Upper bound: 200 path nodes.

---

### build_summary

No parameters.

Returns: `{snapshotId, class: {base, ascendancyId, classStartId}, budgets: {passive: {max, used}, weaponSet: {max, weaponSet1Used, weaponSet2Used}, ascendancy: {max, used}}, allocations: {normal: {count, ids[0..50], truncated?}, weaponSet1: ..., weaponSet2: ..., ascendancy: ..., instilled: ...}}`.

Budget `used` values come from the Planner's `effectivePassivePointsUsed()` and ascendancy/weapon-set counts (deducting free starts where applicable). Instilled uses raw set size (names, not numeric IDs).

## Global limits

| Bound | Value |
|--------|------|
| Max projected nodes | 10,000 |
| Max projected edges | 30,000 |
| Max IPC snapshot bytes | 8,000,000 |
| Max serialised snapshot bytes | 8,000,000 |
| Max tool output chars | 8,000 |
| Max read IDs per call | 3 |
| Max stats per batch | 8 |
| Max search results per page | 16 |
| Max neighborhood nodes | 50 |
| Max path nodes | 200 |
| Max search query length | 200 |

## Error codes

| Code | Meaning |
|------|---------|
| `INVALID_TOOL_ARGUMENTS` | Wrong parameter count, type, or range |
| `NODE_NOT_FOUND` | ID not in current snapshot |
| `NO_ASCENDANCY` | Ascendancy path requested but none selected |
| `UNKNOWN_TOOL` | Tool not registered (no snapshot available) |
| `TOOL_EXECUTION_FAILED` | Unexpected internal failure |

No tool writes, allocates, saves, or modifies Build state. Tool execution is read-only and deterministic for a given snapshot.

The catalog is independent of canvas display toggles. Semantic RAG search/read results are enriched with `currentBuildPath` when a live snapshot contains the node, including `edgeDistance`, `newAllocationCount`, and the nearest allocated node. This keeps the existing knowledge-retrieval workflow useful for path planning without sending the full tree to the model.
