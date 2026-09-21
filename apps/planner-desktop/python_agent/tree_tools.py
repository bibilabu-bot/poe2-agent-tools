"""Bounded read-only tree tools for the Python agent loop.

Consumes an immutable snapshot published by the Electron renderer
(after JS classification and graph construction).  No DOM access,
Planner globals, network or file system at runtime.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any, Mapping, Sequence

from .core import AgentError, BaseTool
from .prompts import TREE_TOOL_DESCRIPTIONS


MAX_SEARCH_RESULTS = 16
MAX_NEIGHBORHOOD_HOPS = 5
MAX_NEIGHBORHOOD_NODES = 50
MAX_PATH_NODES = 200
MAX_READ_IDS = 3
MAX_SEARCH_TEXT_LENGTH = 200
MAX_STATS_PER_BATCH = 8
MAX_TREE_TOOL_OUTPUT_CHARS = 8_000


def _bounded_json(value: Any, limit: int = MAX_TREE_TOOL_OUTPUT_CHARS) -> str:
    text = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    if len(text) <= limit:
        return text
    return f"{text[:limit]}…[truncated]"
    # ^ minus MAX_TREE_TOOL_OUTPUT_CHARS characters


def _sorted_ids(ids: Sequence[str]) -> list[str]:
    return sorted(ids, key=lambda x: str(x))


def _compare_ids(a: str, b: str) -> int:
    """Match passive-graph compareNodeIds: String code-unit order."""
    a_str, b_str = str(a), str(b)
    if a_str < b_str:
        return -1
    if a_str > b_str:
        return 1
    return 0


def _bfs_parents(
    starts: list[str],
    adjacency: dict[str, list[str]],
    eligible: dict[str, bool],
) -> dict[str, str | None]:
    """Deterministic BFS matching passive-graph buildShortestPathIndex."""
    parent: dict[str, str | None] = {}
    queue: list[str] = []
    for sid in _sorted_ids(starts):
        if sid in adjacency and eligible.get(sid, False):
            if sid not in parent:
                parent[sid] = None
                queue.append(sid)
    i = 0
    while i < len(queue):
        current = queue[i]
        neighbors = adjacency.get(current, ())
        for nxt in _sorted_ids(neighbors):
            if nxt in parent:
                continue
            if not eligible.get(nxt, False):
                continue
            parent[nxt] = current
            queue.append(nxt)
        i += 1
    return parent


def _path_from_parents(
    parent: dict[str, str | None],
    target: str,
) -> list[str]:
    """Walk parent map target→start (matching passive-graph pathFromIndex)."""
    tid = str(target)
    if tid not in parent:
        return []
    path: list[str] = []
    current: str | None = tid
    while current is not None:
        path.append(current)
        current = parent.get(current)
    return path  # target-to-start order


@dataclass
class TreeSnapshot:
    """Immutable per-run tree + Build snapshot published from JS."""

    snapshot_id: str = ""
    upstream_snapshot_id: str | None = None
    node_count: int = 0
    nodes: dict[str, dict[str, Any]] = field(default_factory=dict)
    adjacency: dict[str, list[str]] = field(default_factory=dict)
    build: dict[str, Any] = field(default_factory=dict)

    def has(self, node_id: str) -> bool:
        return str(node_id) in self.nodes

    def node(self, node_id: str) -> dict[str, Any] | None:
        return self.nodes.get(str(node_id))

    def neighbors(self, node_id: str) -> list[str]:
        return self.adjacency.get(str(node_id), [])

    def is_general_eligible(self, node_id: str) -> bool:
        n = self.node(node_id)
        return bool(n and n.get("isGeneralEligible"))

    def is_asc_eligible(self, node_id: str) -> bool:
        n = self.node(node_id)
        return bool(n and n.get("isAscEligible"))


def _node_base_obj(node: dict[str, Any], snapshot: TreeSnapshot, include_stats: bool = True, stats_offset: int = 0, stats_limit: int = MAX_STATS_PER_BATCH) -> dict[str, Any]:
    """Build a bounded node result object."""
    stats = node.get("stats", [])
    total_stats = node.get("statsTotal", len(stats))
    batch = stats[stats_offset:stats_offset + stats_limit] if include_stats else []
    obj: dict[str, Any] = {
        "id": node["id"],
        "name": node.get("name", ""),
        "kind": node.get("kind", "small"),
        "x": node.get("x", 0),
        "y": node.get("y", 0),
    }
    if include_stats:
        obj["stats"] = batch
        obj["statsOffset"] = stats_offset
        obj["statsTotal"] = total_stats
        obj["statsComplete"] = stats_offset + stats_limit >= total_stats
    if node.get("isAscendancy"):
        obj["ascendancyId"] = node.get("asc")
    if node.get("isJewelSocket"):
        obj["isJewelSocket"] = True
        obj["isOrdinaryJewelSocket"] = bool(node.get("isOrdinaryJewelSocket"))
    if node.get("isKeystone"):
        obj["isKeystone"] = True
    if node.get("isNotable"):
        obj["isNotable"] = True
    if node.get("isClassStart"):
        obj["isClassStart"] = True
    if node.get("isConditionalReveal"):
        obj["isConditionalReveal"] = True
        obj["constraintSatisfied"] = bool(node.get("constraintSatisfied"))
    neighbors = snapshot.neighbors(node["id"])
    obj["neighborCount"] = len(neighbors)
    obj["neighbors"] = neighbors[:12]
    if len(neighbors) > 12:
        obj["neighborsTruncated"] = True
        obj["neighborsComplete"] = False
    else:
        obj["neighborsTruncated"] = False
        obj["neighborsComplete"] = True
    # Allocation status
    b = snapshot.build
    allocs = b.get("allocations", {})
    allocated_categories = []
    for cat in ("normal", "weaponSet1", "weaponSet2", "ascendancy", "instilled"):
        if node["id"] in allocs.get(cat, []):
            allocated_categories.append(cat)
    obj["allocated"] = bool(allocated_categories)
    obj["allocationCategories"] = allocated_categories
    obj["isClassStartNode"] = b.get("classStartId") == node["id"]
    return obj


class _TreeTool(BaseTool):
    """Base for all tree tools — snapshot injected at registration time."""

    def __init__(self, snapshot: TreeSnapshot, name: str) -> None:
        self._snapshot = snapshot
        self.name = name
        self.description = TREE_TOOL_DESCRIPTIONS[name]
        params = self._parameters()
        self.parameters = {"type": "object", "additionalProperties": False,
                           "required": list(params["required"]),
                           "properties": params["properties"]}

    def _parameters(self) -> dict[str, Any]:
        raise NotImplementedError

    def validate(self, arguments: Mapping[str, Any]) -> None:
        for key in self.parameters["required"]:
            if key not in arguments:
                raise AgentError("INVALID_TOOL_ARGUMENTS", f"缺少参数: {key}")
        for key in arguments:
            if key not in self.parameters["properties"]:
                raise AgentError("INVALID_TOOL_ARGUMENTS", f"未知参数: {key}")

    async def execute(self, arguments: Mapping[str, Any]) -> Any:
        raise NotImplementedError


class TreeSummaryTool(_TreeTool):
    def __init__(self, snapshot: TreeSnapshot) -> None:
        super().__init__(snapshot, "tree_summary")

    def _parameters(self) -> dict[str, Any]:
        return {"required": [], "properties": {}}

    def validate(self, arguments: Mapping[str, Any]) -> None:
        if arguments:
            raise AgentError("INVALID_TOOL_ARGUMENTS", "tree_summary 不接受参数")

    async def execute(self, arguments: Mapping[str, Any]) -> Any:
        s = self._snapshot
        b = s.build
        nodes = list(s.nodes.values())
        kinds: dict[str, int] = {}
        min_x = min_y = float("inf")
        max_x = max_y = float("-inf")
        for n in nodes:
            k = n.get("kind", "small")
            kinds[k] = kinds.get(k, 0) + 1
            min_x = min(min_x, n.get("x", 0))
            min_y = min(min_y, n.get("y", 0))
            max_x = max(max_x, n.get("x", 0))
            max_y = max(max_y, n.get("y", 0))
        jewel_sockets = sum(1 for n in nodes if n.get("isJewelSocket"))
        ordinary_sockets = sum(1 for n in nodes if n.get("isOrdinaryJewelSocket"))
        asc_nodes = sum(1 for n in nodes if n.get("isAscendancy"))
        conditional = sum(1 for n in nodes if n.get("isConditionalReveal"))
        return {
            "snapshotId": s.snapshot_id,
            "nodeCount": s.node_count,
            "coordinateRange": {"min": {"x": min_x, "y": min_y}, "max": {"x": max_x, "y": max_y}},
            "nodeKinds": kinds,
            "jewelSockets": {"total": jewel_sockets, "ordinary": ordinary_sockets,
                             "special": jewel_sockets - ordinary_sockets},
            "ascendancyNodeCount": asc_nodes,
            "conditionalRevealCount": conditional,
            "class": {"base": b.get("baseClassName"), "selectedAscendancyId": b.get("selectedAscendancyId")},
            "ascendancyOptions": b.get("ascendancyOptions", []),
        }


class ReadTreeNodesTool(_TreeTool):
    def __init__(self, snapshot: TreeSnapshot) -> None:
        super().__init__(snapshot, "read_tree_nodes")

    def _parameters(self) -> dict[str, Any]:
        return {"required": ["ids"], "properties": {
            "ids": {"type": "array", "minItems": 1, "maxItems": MAX_READ_IDS,
                    "items": {"type": "string"}},
            "statsOffset": {"type": "integer", "minimum": 0, "default": 0},
            "statsLimit": {"type": "integer", "minimum": 1, "maximum": MAX_STATS_PER_BATCH, "default": MAX_STATS_PER_BATCH},
        }}

    def validate(self, arguments: Mapping[str, Any]) -> None:
        super().validate(arguments)
        ids = arguments.get("ids", [])
        if not isinstance(ids, list) or not (1 <= len(ids) <= MAX_READ_IDS):
            raise AgentError("INVALID_TOOL_ARGUMENTS", f"IDs 数量需在 1-{MAX_READ_IDS} 之间")
        for i in ids:
            if not isinstance(i, str) or not i.strip():
                raise AgentError("INVALID_TOOL_ARGUMENTS", "每个 ID 必须是非空字符串")

    async def execute(self, arguments: Mapping[str, Any]) -> Any:
        ids = arguments["ids"]
        offset = arguments.get("statsOffset", 0)
        limit = arguments.get("statsLimit", MAX_STATS_PER_BATCH)
        found = []
        missing = []
        for nid in ids:
            n = self._snapshot.node(str(nid))
            if n:
                found.append(_node_base_obj(n, self._snapshot, stats_offset=offset, stats_limit=limit))
            else:
                missing.append(str(nid))
        result = {"nodes": found, "missing": missing, "snapshotId": self._snapshot.snapshot_id}
        if len(missing) > 0:
            result["hint"] = "缺失 ID 可能在当前天赋树版本中不存在，或被导出数据排除"
        return result


class SearchTreeNodesTool(_TreeTool):
    def __init__(self, snapshot: TreeSnapshot) -> None:
        super().__init__(snapshot, "search_tree_nodes")

    def _parameters(self) -> dict[str, Any]:
        return {"required": ["query"], "properties": {
            "query": {"type": "string", "minLength": 1, "maxLength": MAX_SEARCH_TEXT_LENGTH},
        }}

    def validate(self, arguments: Mapping[str, Any]) -> None:
        super().validate(arguments)
        q = arguments.get("query", "")
        if not isinstance(q, str) or not q.strip():
            raise AgentError("INVALID_TOOL_ARGUMENTS", "搜索文本不能为空")

    async def execute(self, arguments: Mapping[str, Any]) -> Any:
        query = arguments["query"].strip().lower()
        # Exact ID match
        n = self._snapshot.node(query)
        if n:
            return {"matches": [_node_base_obj(n, self._snapshot, include_stats=False)],
                    "query": arguments["query"], "totalMatches": 1, "complete": True,
                    "snapshotId": self._snapshot.snapshot_id, "matchType": "exact_id"}
        # Lexical search: check name prefix, name contains, then stats contains.
        # Deterministic: no vectors, no reranking.
        name_prefix: list[dict[str, Any]] = []
        name_contains: list[dict[str, Any]] = []
        stat_contains: list[dict[str, Any]] = []
        seen: set[str] = set()
        for n in sorted(self._snapshot.nodes.values(), key=lambda x: str(x["id"])):
            nid = str(n["id"])
            if nid in seen:
                continue
            name = str(n.get("name", "")).lower()
            stats_text = " ".join(str(s) for s in n.get("stats", [])).lower()
            if name.startswith(query) and len(name_prefix) < MAX_SEARCH_RESULTS:
                name_prefix.append(nid)
                seen.add(nid)
            elif query in name and len(name_contains) < MAX_SEARCH_RESULTS - len(name_prefix):
                name_contains.append(nid)
                seen.add(nid)
            elif query in stats_text and len(stat_contains) < MAX_SEARCH_RESULTS - len(name_prefix) - len(name_contains):
                stat_contains.append(nid)
                seen.add(nid)
        all_ids = name_prefix + name_contains + stat_contains
        total = len(all_ids)
        capped = all_ids[:MAX_SEARCH_RESULTS]
        matches = [_node_base_obj(self._snapshot.node(nid), self._snapshot, include_stats=False)
                   for nid in capped]
        return {"matches": matches, "query": arguments["query"],
                "totalMatches": total, "complete": len(all_ids) <= MAX_SEARCH_RESULTS,
                "snapshotId": self._snapshot.snapshot_id, "matchType": "lexical"}


class ReadTreeNeighborhoodTool(_TreeTool):
    def __init__(self, snapshot: TreeSnapshot) -> None:
        super().__init__(snapshot, "read_tree_neighborhood")

    def _parameters(self) -> dict[str, Any]:
        return {"required": ["nodeId"], "properties": {
            "nodeId": {"type": "string"},
            "maxHops": {"type": "integer", "minimum": 1, "maximum": MAX_NEIGHBORHOOD_HOPS, "default": 2},
            "maxNodes": {"type": "integer", "minimum": 1, "maximum": MAX_NEIGHBORHOOD_NODES, "default": 30},
            "direction": {"type": "string", "enum": ["all", "allocatable"], "default": "allocatable"},
        }}

    def validate(self, arguments: Mapping[str, Any]) -> None:
        super().validate(arguments)
        nid = arguments.get("nodeId", "")
        if not isinstance(nid, str) or not nid.strip():
            raise AgentError("INVALID_TOOL_ARGUMENTS", "nodeId 不能为空")
        if not self._snapshot.node(str(nid)):
            raise AgentError("NODE_NOT_FOUND", f"节点 {nid} 在当前天赋树快照中不存在")

    async def execute(self, arguments: Mapping[str, Any]) -> Any:
        center = str(arguments["nodeId"])
        max_hops = min(arguments.get("maxHops", 2), MAX_NEIGHBORHOOD_HOPS)
        max_nodes = min(arguments.get("maxNodes", 30), MAX_NEIGHBORHOOD_NODES)
        direction = arguments.get("direction", "allocatable")

        visited: dict[str, int] = {center: 0}
        queue = [(center, 0)]
        layers: dict[int, list[str]] = {}
        for hop in range(max_hops + 1):
            layers[hop] = []

        for current, dist in queue:
            if dist >= max_hops:
                continue
            for nxt in _sorted_ids(self._snapshot.neighbors(current)):
                if nxt in visited:
                    continue
                if direction == "allocatable" and not self._snapshot.is_general_eligible(nxt):
                    continue
                nd = dist + 1
                visited[nxt] = nd
                layers.setdefault(nd, []).append(nxt)
                if len(visited) >= max_nodes:
                    break
                queue.append((nxt, nd))
            if len(visited) >= max_nodes:
                break

        layer_results: dict[str, Any] = {}
        for hop in range(1, max_hops + 1):
            ids = layers.get(hop, [])
            layer_results[f"hop{hop}"] = {
                "count": len(ids),
                "nodeIds": ids[:20],
                "truncated": len(ids) > 20,
            }

        truncated = len(visited) >= max_nodes
        center_node = _node_base_obj(self._snapshot.node(center), self._snapshot, include_stats=True, stats_limit=4)
        return {"center": center_node, "layers": layer_results,
                "totalVisited": len(visited), "maxHops": max_hops,
                "truncated": truncated,
                "snapshotId": self._snapshot.snapshot_id}


class FindTreePathTool(_TreeTool):
    def __init__(self, snapshot: TreeSnapshot) -> None:
        super().__init__(snapshot, "find_tree_path")

    def _parameters(self) -> dict[str, Any]:
        return {"required": ["targetId"], "properties": {
            "targetId": {"type": "string"},
            "startId": {"type": "string"},
            "category": {"type": "string", "enum": ["general", "ascendancy"], "default": "general"},
        }}

    def validate(self, arguments: Mapping[str, Any]) -> None:
        super().validate(arguments)
        tid = arguments.get("targetId", "")
        if not isinstance(tid, str) or not tid.strip():
            raise AgentError("INVALID_TOOL_ARGUMENTS", "targetId 不能为空")
        if not self._snapshot.node(str(tid)):
            raise AgentError("NODE_NOT_FOUND", f"目标节点 {tid} 在当前天赋树快照中不存在")
        cat = arguments.get("category", "general")
        if cat == "ascendancy" and not self._snapshot.build.get("selectedAscendancyId"):
            raise AgentError("NO_ASCENDANCY", "当前未选择升华职业")
        sid = arguments.get("startId")
        if sid and not self._snapshot.node(str(sid)):
            raise AgentError("NODE_NOT_FOUND", f"起始节点 {sid} 在当前天赋树快照中不存在")

    async def execute(self, arguments: Mapping[str, Any]) -> Any:
        target = str(arguments["targetId"])
        start_id = arguments.get("startId")
        category = arguments.get("category", "general")

        s = self._snapshot
        is_asc = category == "ascendancy"

        if is_asc:
            if not s.build.get("selectedAscendancyId"):
                raise AgentError("NO_ASCENDANCY", "当前未选择升华职业")
            # For ascendancy, use the published asc starts (ascAllocated nodes)
            asc_starts = s.build.get("allocations", {}).get("ascendancy", [])
            if not asc_starts:
                raise AgentError("NO_ASCENDANCY", "当前未分配升华节点")
            starts = list(asc_starts) if start_id is None else [start_id]
            eligible = s.adjacency  # all connected nodes are eligible for asc path
            # Actually use isAscEligible for strictness
        else:
            starts = [start_id] if start_id else s.build.get("allocations", {}).get("normal", [])
            if not start_id:
                cls_start = s.build.get("classStartId")
                if cls_start:
                    starts = [cls_start] + list(starts)

        # Determine eligibility
        eligible: dict[str, bool] = {}
        for nid in s.adjacency:
            if is_asc:
                eligible[nid] = s.is_asc_eligible(nid)
            else:
                eligible[nid] = s.is_general_eligible(nid)

        # Handle custom start node: inject eligibility
        if start_id and start_id not in set(starts):
            starts = [start_id] + list(starts)
            # Make the start node temporarily eligible
            eligible = dict(eligible)
            eligible[start_id] = True  # assume caller knows the node is a valid start

        parent = _bfs_parents(starts, s.adjacency, eligible)
        path = _path_from_parents(parent, target)

        if not path:
            return {"path": [], "targetId": target, "reachable": False,
                    "hint": "目标节点在当前起始点集和资格条件下不可达",
                    "category": category, "snapshotId": s.snapshot_id}

        allocations = s.build.get("allocations", {})
        alloc_normal = set(allocations.get("normal", []))
        alloc_asc = set(allocations.get("ascendancy", []))
        already_allocated = alloc_normal | alloc_asc
        new_nodes = [nid for nid in path if nid not in already_allocated]
        new_cost = len(new_nodes)

        path_nodes = []
        for nid in reversed(path):
            node = s.node(nid)
            if node:
                path_nodes.append({
                    "id": nid,
                    "name": node.get("name", ""),
                    "kind": node.get("kind", "small"),
                    "alreadyAllocated": nid in already_allocated,
                    "isTarget": nid == target,
                })

        return {
            "path": path_nodes,
            "pathLength": len(path_nodes),
            "newNodesCount": new_cost,
            "newNodeIds": new_nodes,
            "direction": "target_to_start",
            "category": category,
            "reachable": True,
            "snapshotId": s.snapshot_id,
            "warning": "此路径基于当前快照资格判断；应用前必须由用户验证合法性与剩余预算。" if new_cost > 0 else None,
        }


class BuildSummaryTool(_TreeTool):
    def __init__(self, snapshot: TreeSnapshot) -> None:
        super().__init__(snapshot, "build_summary")

    def _parameters(self) -> dict[str, Any]:
        return {"required": [], "properties": {}}

    def validate(self, arguments: Mapping[str, Any]) -> None:
        if arguments:
            raise AgentError("INVALID_TOOL_ARGUMENTS", "build_summary 不接受参数")

    async def execute(self, arguments: Mapping[str, Any]) -> Any:
        b = self._snapshot.build
        allocations = b.get("allocations", {})
        normal_count = len(allocations.get("normal", []))
        ws1_count = len(allocations.get("weaponSet1", []))
        ws2_count = len(allocations.get("weaponSet2", []))
        asc_count = len(allocations.get("ascendancy", []))
        instilled_count = len(allocations.get("instilled", []))
        budgets = b.get("budgets", {})
        usage = b.get("budgetUsage", {})

        return {
            "snapshotId": self._snapshot.snapshot_id,
            "class": {"base": b.get("baseClassName"), "ascendancyId": b.get("selectedAscendancyId"),
                      "classStartId": b.get("classStartId")},
            "budgets": {
                "passive": {"max": budgets.get("passive", 0), "used": usage.get("normal", 0)},
                "weaponSet": {"max": budgets.get("weaponSet", 0),
                              "weaponSet1Used": usage.get("weaponSet1", 0),
                              "weaponSet2Used": usage.get("weaponSet2", 0)},
                "ascendancy": {"max": budgets.get("ascendancy", 0), "used": usage.get("ascendancy", 0)},
            },
            "allocations": {
                "normal": {"count": normal_count, "ids": allocations.get("normal", [])[:50]},
                "weaponSet1": {"count": ws1_count, "ids": allocations.get("weaponSet1", [])[:50]},
                "weaponSet2": {"count": ws2_count, "ids": allocations.get("weaponSet2", [])[:50]},
                "ascendancy": {"count": asc_count, "ids": allocations.get("ascendancy", [])[:50]},
                "instilled": {"count": instilled_count, "ids": allocations.get("instilled", [])[:50]},
            },
            "totalAllocated": normal_count + ws1_count + ws2_count + asc_count + instilled_count,
        }


_ALL_TREE_TOOLS: list[type[_TreeTool]] = [
    TreeSummaryTool, ReadTreeNodesTool, SearchTreeNodesTool,
    ReadTreeNeighborhoodTool, FindTreePathTool, BuildSummaryTool,
]


def register_tree_tools(snapshot: TreeSnapshot) -> list[BaseTool]:
    """Create one tool instance per tree-tool type from a snapshot."""
    return [cls(snapshot) for cls in _ALL_TREE_TOOLS]


def tree_tool_names() -> list[str]:
    return [cls.__name__.replace("Tool", "").replace("Tree", "tree_").replace("Build", "build_")
            .replace("Read", "read_").replace("Search", "search_").replace("Find", "find_").replace("Summary", "summary")
            .replace("Neighborhood", "neighborhood").replace("Nodes", "nodes")
            .replace("tree_tree_", "tree_") for cls in _ALL_TREE_TOOLS]