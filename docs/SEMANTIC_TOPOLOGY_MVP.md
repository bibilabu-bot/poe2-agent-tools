# Semantic topology MVP

## Verified source schema

Inspected the local locked `tree-pre.json` (5,102 raw nodes) and GGG `official-data.json` (5,153 raw nodes), not translated display text. The official node keyed by numeric ID has `skill`, symbolic `id`, `isGenericAttribute`, `stats`, `isJewelSocket`, `isBlighted`, `ascendancyId`, `group`, `orbit`, `orbitIndex`, `in`, `out`, and `edges`.

All 293 official `isGenericAttribute=true` nodes have exactly one raw stat: `+5 to any [Attributes|Attribute]`. Fixed attribute grants also occur on mixed-effect passives and are not attribute travel nodes. MVP requires the explicit flag, small-node kind and the verified single raw stat; unsupported flagged variants remain unclassified. No Chinese name/stat matching is used.

GGG groups contain layout coordinates, orbit lists and member IDs. Group IDs differ between the slim export and official data (e.g. node 722: 1430 versus 1479). They are retained as official layout metadata, not treated as semantic clusters. The existing ordinary-socket identity classification supplies 12 ordinary sockets; Blighted and ascendancy sockets are excluded.

## Contract

The Electron-published TreeSnapshot now has additive `semanticTopology`:

```
version: semantic-topology-v1
scope: ordinary-tree
clusters: [{id, type, nodeIds, edges: [[nodeA, nodeB], ...]}]
clusterEdges: [{source: clusterId, target: clusterId, physicalEdges: [[nodeA, nodeB], ...]}]
nodeToCluster: {nodeId: clusterId}
unclassifiedNodes: [{nodeId, reason}]
unclassifiedEdges: [[nodeA, nodeB], ...]
excludedAscendancyNodeIds: [nodeId, ...]
```

L1 is a pure quotient of the existing published L0 `nodes + adjacency`; it does not reconstruct a second physical graph from official in/out records. L0 retains all original snapshot data. No existing Graph or pathfinding function is changed. Physical edges are undirected, canonicalized and deduplicated; every edge between classified nodes appears either inside one cluster or as a physical boundary edge between two clusters. Ordinary edges incident to unclassified nodes are retained in `unclassifiedEdges` (also pageable via section=unclassifiedEdges), not fabricated as cluster connections. Ascendancy-incident edges remain separate in L0.

Attribute and passive clusters are induced connected components; ordinary jewel sockets are singletons. Ascendancies are excluded separately. Class starts, conditional nodes, Blighted nodes, special sockets and unknown/empty-schema nodes remain unclassified. This conservative policy may split areas more finely; it does not invent passage through unknown nodes. Unlock/allocation/display state is never used to partition clusters.

IDs use `type:lexicographically-smallest-member-id`, deterministic for the same L0 across input ordering and Build changes, not guaranteed stable across upstream topology revisions. `group/orbit` never determine membership. Cluster connectivity does not guarantee legal or affordable allocation: use the existing L0 path tool for that.

## AI access

- `tree_overview`: current-Build-only overview (replaces tree_summary, build_summary and list_tree_clusters, without aliases). Includes class, ascendancy, budgets/remaining/over-budget, allocation counts, and ALL touched clusters plus their complete cluster graph in one response. No highlights, whole-tree statistics or whole-tree directory. Default `clusters` ignores legacy offset/limit and returns complete=true, nextOffset=null. Names and one-line summaries describe entire clusters, not effects currently gained. Edges retain original source/target IDs and add sourceName/targetName. `section=allocations` pages allocation entries; `section=boundaries` pages physical edges between touched clusters and marks whether both endpoints are allocated. Allocated unclassified and ascendancy IDs are separate. Build filtering does not change L1 partitioning.
- `read_tree_cluster`: locate by `clusterId` or `nodeId`; page `nodes`, internal `edges`, or `boundaries`. Node IDs can then be passed to existing `read_tree_nodes`; existing lexical/semantic node searches can locate the initial target node.
- Only detail sections use offset/limit (1–20) and `nextOffset`. Full overview uses a 64k runtime result limit; excessive results produce a structured error rather than a broken partial graph.
- The before hook names/summarizes passive clusters in isolated model requests (8 per batch, concurrency 3, 45s per batch / 60s total). Attribute and jewel labels are deterministic. Content-addressed named-cluster-v1 cache includes model, endpoint, prompt and complete evidence; old description-only cache entries are not reused. Prompt is editable on the overview maintenance page. Failures return explicit unavailable labels, preserving the graph.
- Python preserves semanticTopology on snapshot publication and refreshes it after successful Build writes. A failed refresh invalidates it along with the old L0 data.

Example: `read_tree_cluster({nodeId:"722"})`, then `read_tree_cluster({clusterId:"attribute:14267",section:"boundaries"})`, then `read_tree_nodes` or `find_tree_path` for exact node work.

## Evidence and scope

Actual Electron/preload/Python/local-model bridge: 4,742 published L0 nodes; 604 clusters (7 attribute, 12 jewel, 585 passive), 639 cluster edges, 3,869 classified nodes, 206 unclassified, 667 separately excluded ascendancy nodes. Counts describe the current locked data, not permanent constants.

The bridge verifies a real `read_tree_cluster` call for node 722 and identical L1 output after clearing normal/weapon/ascendancy allocations and changing ascendancy selection. Pure tests cover connected components, singleton sockets, parallel boundary edges, input order, unknown/special classification, and no L0 input mutation. Python tests cover discovery, pagination, boundary endpoints and unclassified lookup.

MVP omits cluster-level pathfinding, scoring, recommendations and embeddings. The read-only WeGame preview below visualizes cluster membership; optional AI labels are bounded and may fall back to an unavailable state. Delivered as an owner-approved extension of P2AT-028B.

The complete Node/Python suites, syntax check, real synthetic Electron bridge and guarded write/undo check passed at controller integration. The real bridge reconstructed every non-ascendancy L0 edge from internal, cross-cluster and unclassified edge sets and asserted exact equality. No running user BD was altered by these checks.

## WeGame import preview

The import preview now embeds a read-only semantic verification panel. It shows full-tree cluster totals and the clusters touched by the candidate import, defaults to candidate-touched clusters, locates clusters by numeric node ID, pages internal nodes/edges and boundary edges (30 rows), and supports jumping to neighboring clusters. Node labels identify candidate general/weapon/ascendancy membership, not the currently active Build. The panel reuses the same snapshot and semantic derivation modules as the agent; it never applies the candidate. Unsupported/ascendancy IDs report their separate status.

The real Electron bridge opens the preview using the sanitized import fixture, locates node 722, inspects boundaries, navigates a neighbor, closes the dialog and asserts the entire captured current Build state is byte-identical before/after. Offscreen rendering supplies a screenshot for visual inspection. Independent review: APPROVE. Reopen the import dialog after restarting the saved application to load the new code.
