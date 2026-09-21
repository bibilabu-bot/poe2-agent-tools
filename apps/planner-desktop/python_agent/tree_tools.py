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
MAX_TOOL_OUTPUT_CHARS = 8_000


def _bounded_json(value: Any, limit: int = MAX_TOOL_OUTPUT_CHARS) -> str:
    text = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    if len(text) <= limit:
        return text
    return f"{text[:limit]}…[truncated {len(text) - limit} chars]"


def _sorted_ids(ids: Sequence[str]) -> list[str]:
    return sorted(ids, key=lambda x: str(x))


@dataclass
class TreeSnapshot:
    """Immutable per-run tree + Build snapshot published from JS."""

    snapshot_id: str = ""
    node_count: int = 0
    nodes: dict[str, dict[str, Any]] = field(default_factory=dict)
    adjacency: dict[str, list[str]] = field(default_factory=dict)
    build: dict[str, Any] = field(default_factory=dict)
    _path_index: dict[str, Any] = field(default_factory=dict)
    _error: str | None = None

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


def _node_base(node: dict[str, Any], snapshot: TreeSnapshot,
               include_stats: bool = True,
               stats_offset: int = 0,
               stats_limit: int = MAX_STATS_PER_BATCH) -> dict[str, Any]:
    """Build bounded node result with executable pagination."""
    stats = node.get("stats", [])
    total = len(stats)
    batch = stats[stats_offset:stats_offset + stats_limit] if include_stats else []
    obj: dict[str, Any] = {
        "id": node["id"],
        "name": node.get("name", ""),
        "kind": node.get("kind", "small"),
        "x": node.get("x"),
        "y": node.get("y"),
    }
    if include_stats:
        obj["stats"] = batch
        obj["statsOffset"] = stats_offset
        obj["statsLimit"] = stats_limit
        obj["statsTotal"] = total
        if stats_offset + stats_limit < total:
            obj["nextStatsOffset"] = stats_offset + stats_limit
            obj["statsComplete"] = False
        else:
            obj["statsComplete"] = True
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
    obj["neighborsTruncated"] = len(neighbors) > 12
    b = snapshot.build
    allocs = b.get("allocations", {})
    cats = []
    for cat in ("normal", "weaponSet1", "weaponSet2", "ascendancy", "instilled"):
        if node["id"] in allocs.get(cat, []):
            cats.append(cat)
    obj["allocated"] = bool(cats)
    obj["allocationCategories"] = cats
    obj["isClassStartNode"] = b.get("classStartId") == node["id"]
    return obj


class _TreeTool(BaseTool):
    def __init__(self, snapshot: TreeSnapshot, name: str) -> None:
        self._snapshot = snapshot
        self.name = name
        self.description = TREE_TOOL_DESCRIPTIONS[name]
        p = self._parameters()
        self.parameters = {"type": "object", "additionalProperties": False,
                           "required": list(p["required"]), "properties": p["properties"]}

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
            nx = n.get("x")
            ny = n.get("y")
            if isinstance(nx, (int, float)):
                min_x = min(min_x, nx)
                max_x = max(max_x, nx)
            if isinstance(ny, (int, float)):
                min_y = min(min_y, ny)
                max_y = max(max_y, ny)
        js_total = sum(1 for n in nodes if n.get("isJewelSocket"))
        js_ord = sum(1 for n in nodes if n.get("isOrdinaryJewelSocket"))
        return {"snapshotId": s.snapshot_id, "nodeCount": s.node_count,
                "coordinateRange": {"min": {"x": min_x if min_x != float("inf") else None,
                                           "y": min_y if min_y != float("inf") else None},
                                    "max": {"x": max_x if max_x != float("-inf") else None,
                                           "y": max_y if max_y != float("-inf") else None}},
                "nodeKinds": kinds,
                "jewelSockets": {"total": js_total, "ordinary": js_ord, "special": js_total - js_ord},
                "ascendancyNodeCount": sum(1 for n in nodes if n.get("isAscendancy")),
                "conditionalRevealCount": sum(1 for n in nodes if n.get("isConditionalReveal")),
                "class": {"base": b.get("baseClassName"), "selectedAscendancyId": b.get("selectedAscendancyId")},
                "ascendancyOptions": b.get("ascendancyOptions", [])}


class ReadTreeNodesTool(_TreeTool):
    def __init__(self, snapshot: TreeSnapshot) -> None:
        super().__init__(snapshot, "read_tree_nodes")

    def _parameters(self) -> dict[str, Any]:
        return {"required": ["ids"], "properties": {
            "ids": {"type": "array", "minItems": 1, "maxItems": MAX_READ_IDS, "items": {"type": "string"}},
            "statsOffset": {"type": "integer", "minimum": 0, "default": 0},
            "statsLimit": {"type": "integer", "minimum": 1, "maximum": MAX_STATS_PER_BATCH, "default": MAX_STATS_PER_BATCH},
        }}

    def validate(self, arguments: Mapping[str, Any]) -> None:
        super().validate(arguments)
        ids = arguments.get("ids", [])
        if not isinstance(ids, list) or not (1 <= len(ids) <= MAX_READ_IDS):
            raise AgentError("INVALID_TOOL_ARGUMENTS", f"IDs 数量需在 1-{MAX_READ_IDS} 之间")

    async def execute(self, arguments: Mapping[str, Any]) -> Any:
        ids = arguments["ids"]
        off = arguments.get("statsOffset", 0)
        lim = arguments.get("statsLimit", MAX_STATS_PER_BATCH)
        found, missing = [], []
        for nid in ids:
            n = self._snapshot.node(str(nid))
            if n:
                found.append(_node_base(n, self._snapshot, stats_offset=off, stats_limit=lim))
            else:
                missing.append(str(nid))
        return {"nodes": found, "missing": missing, "snapshotId": self._snapshot.snapshot_id}


class SearchTreeNodesTool(_TreeTool):
    def __init__(self, snapshot: TreeSnapshot) -> None:
        super().__init__(snapshot, "search_tree_nodes")

    def _parameters(self) -> dict[str, Any]:
        return {"required": ["query"], "properties": {
            "query": {"type": "string", "minLength": 1, "maxLength": MAX_SEARCH_TEXT_LENGTH},
            "offset": {"type": "integer", "minimum": 0, "default": 0},
        }}

    def validate(self, arguments: Mapping[str, Any]) -> None:
        super().validate(arguments)
        q = arguments.get("query", "")
        if not isinstance(q, str) or not q.strip():
            raise AgentError("INVALID_TOOL_ARGUMENTS", "搜索文本不能为空")

    async def execute(self, arguments: Mapping[str, Any]) -> Any:
        query = arguments["query"].strip().lower()
        offset = arguments.get("offset", 0)
        # Exact ID match
        n = self._snapshot.node(query)
        if n:
            return {"matches": [_node_base(n, self._snapshot, include_stats=False)],
                    "query": arguments["query"], "totalMatches": 1, "matchType": "exact_id",
                    "snapshotId": self._snapshot.snapshot_id}
        # Deterministic lexical search
        prefix_ids, name_ids, stat_ids = [], [], []
        seen: set[str] = set()
        limit = MAX_SEARCH_RESULTS + offset
        for n in sorted(self._snapshot.nodes.values(), key=lambda x: str(x["id"])):
            nid = str(n["id"])
            if nid in seen:
                continue
            name = str(n.get("name", "")).lower()
            stats_text = " ".join(str(s) for s in n.get("stats", [])).lower()
            if name.startswith(query) and len(prefix_ids) < limit:
                prefix_ids.append(nid); seen.add(nid)
            elif query in name and len(prefix_ids) + len(name_ids) < limit:
                name_ids.append(nid); seen.add(nid)
            elif query in stats_text and len(prefix_ids) + len(name_ids) + len(stat_ids) < limit:
                stat_ids.append(nid); seen.add(nid)
        all_ids = prefix_ids + name_ids + stat_ids
        page = all_ids[offset:offset + MAX_SEARCH_RESULTS]
        result: dict[str, Any] = {
            "matches": [_node_base(self._snapshot.node(nid), self._snapshot, include_stats=False) for nid in page],
            "query": arguments["query"], "totalMatches": len(all_ids),
            "matchType": "lexical", "snapshotId": self._snapshot.snapshot_id,
        }
        if offset + MAX_SEARCH_RESULTS < len(all_ids):
            result["nextOffset"] = offset + MAX_SEARCH_RESULTS
        return result


class ReadTreeNeighborhoodTool(_TreeTool):
    def __init__(self, snapshot: TreeSnapshot) -> None:
        super().__init__(snapshot, "read_tree_neighborhood")

    def _parameters(self) -> dict[str, Any]:
        return {"required": ["nodeId"], "properties": {
            "nodeId": {"type": "string"},
            "maxHops": {"type": "integer", "minimum": 1, "maximum": MAX_NEIGHBORHOOD_HOPS, "default": 2},
            "maxNodes": {"type": "integer", "minimum": 1, "maximum": MAX_NEIGHBORHOOD_NODES, "default": 30},
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
        visited: dict[str, int] = {center: 0}
        queue = [(center, 0)]
        layers: dict[int, list[str]] = {h: [] for h in range(max_hops + 1)}
        idx = 0
        while idx < len(queue) and len(visited) < max_nodes:
            cur, dist = queue[idx]; idx += 1
            if dist >= max_hops:
                continue
            for nxt in _sorted_ids(self._snapshot.neighbors(cur)):
                if nxt in visited:
                    continue
                nd = dist + 1
                visited[nxt] = nd
                layers[nd].append(nxt)
                if len(visited) >= max_nodes:
                    break
                queue.append((nxt, nd))
        result: dict[str, Any] = {
            "center": _node_base(self._snapshot.node(center), self._snapshot, include_stats=True, stats_limit=4),
            "totalVisited": len(visited), "maxHops": max_hops,
            "truncated": len(visited) >= max_nodes,
            "snapshotId": self._snapshot.snapshot_id,
        }
        for h in range(1, max_hops + 1):
            ids = layers.get(h, [])
            result[f"hop{h}"] = {"count": len(ids), "nodeIds": ids[:20]}
            if len(ids) > 20:
                result[f"hop{h}"]["truncated"] = True
        return result


class FindTreePathTool(_TreeTool):
    def __init__(self, snapshot: TreeSnapshot) -> None:
        super().__init__(snapshot, "find_tree_path")

    CATEGORY_MAP = {"general": "generalParent", "weaponSet1": "weaponSet1Parent",
                    "weaponSet2": "weaponSet2Parent", "ascendancy": "ascParent"}

    def _parameters(self) -> dict[str, Any]:
        return {"required": ["targetId"], "properties": {
            "targetId": {"type": "string"},
            "startId": {"type": "string"},
            "category": {"type": "string", "enum": ["general", "weaponSet1", "weaponSet2", "ascendancy"], "default": "general"},
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
        idx_key = self.CATEGORY_MAP.get(category, "generalParent")
        parent_map = s._path_index.get(idx_key, {})

        if start_id:
            # Custom start node: the precomputed parent map is from the
            # category's normal start set and doesn't apply.  Return
            # controlled unsupported — we don't run an ad-hoc BFS that
            # could differ from Planner eligibility.
            return {"path": [], "targetId": target, "reachable": False,
                    "unsupported": "startId",
                    "hint": f"从指定 startId 查找路径当前不支持。请使用 category={category} 的默认起点集。",
                    "category": category, "snapshotId": s.snapshot_id}

        if not parent_map:
            return {"path": [], "targetId": target, "reachable": False,
                    "unsupported": "no_path_index",
                    "hint": f"类别 {category} 的路径索引未预计算",
                    "category": category, "snapshotId": s.snapshot_id}

        # Walk parent map target→start
        tid = target
        if tid not in parent_map:
            return {"path": [], "targetId": target, "reachable": False,
                    "hint": "目标节点在当前起始点集和资格条件下不可达",
                    "category": category, "snapshotId": s.snapshot_id}

        path_ids = []
        cur = tid
        while cur is not None:
            path_ids.append(cur)
            cur = parent_map.get(cur)
            if len(path_ids) > MAX_PATH_NODES:
                return {"path": [], "targetId": target, "reachable": False,
                        "hint": f"路径超过 {MAX_PATH_NODES} 节点上限",
                        "category": category, "snapshotId": s.snapshot_id}

        allocs = s.build.get("allocations", {})
        already = set(allocs.get("normal", []) + allocs.get("ascendancy", []) +
                      allocs.get("weaponSet1", []) + allocs.get("weaponSet2", []))
        new_ids = [nid for nid in path_ids if nid not in already]

        path_nodes = []
        for nid in reversed(path_ids):
            node = s.node(nid)
            if node:
                path_nodes.append({"id": nid, "name": node.get("name", ""),
                                   "kind": node.get("kind", "small"),
                                   "alreadyAllocated": nid in already,
                                   "isTarget": nid == target})

        result: dict[str, Any] = {
            "path": path_nodes, "pathLength": len(path_nodes),
            "newNodesCount": len(new_ids), "newNodeIds": new_ids,
            "direction": "start_to_target", "category": category,
            "reachable": True, "snapshotId": s.snapshot_id,
        }
        if new_ids:
            result["warning"] = "路径不是可执行加点承诺；预算、未知条件和资格状态须由用户验证。"
        return result


class BuildSummaryTool(_TreeTool):
    def __init__(self, snapshot: TreeSnapshot) -> None:
        super().__init__(snapshot, "build_summary")

    def _parameters(self) -> dict[str, Any]:
        return {"required": [], "properties": {}}

    async def execute(self, arguments: Mapping[str, Any]) -> Any:
        b = self._snapshot.build
        allocs = b.get("allocations", {})
        usage = b.get("budgetUsage", {})
        budgets = b.get("budgets", {})

        # Use Planner-derived usage counts (account for free starts).
        passive_used = usage.get("normal", 0)
        ws1_used = usage.get("weaponSet1", 0)
        ws2_used = usage.get("weaponSet2", 0)
        asc_used = usage.get("ascendancy", 0)

        result: dict[str, Any] = {
            "snapshotId": self._snapshot.snapshot_id,
            "class": {"base": b.get("baseClassName"), "ascendancyId": b.get("selectedAscendancyId"),
                      "classStartId": b.get("classStartId")},
            "budgets": {
                "passive": {"max": budgets.get("passive", 0), "used": passive_used},
                "weaponSet": {"max": budgets.get("weaponSet", 0),
                              "weaponSet1Used": ws1_used, "weaponSet2Used": ws2_used},
                "ascendancy": {"max": budgets.get("ascendancy", 0), "used": asc_used},
            },
            "allocations": {
                "normal": {"count": len(allocs.get("normal", [])),
                           "ids": allocs.get("normal", [])[:50]},
                "weaponSet1": {"count": len(allocs.get("weaponSet1", [])),
                               "ids": allocs.get("weaponSet1", [])[:50]},
                "weaponSet2": {"count": len(allocs.get("weaponSet2", [])),
                               "ids": allocs.get("weaponSet2", [])[:50]},
                "ascendancy": {"count": len(allocs.get("ascendancy", [])),
                               "ids": allocs.get("ascendancy", [])[:50]},
                "instilled": {"count": len(allocs.get("instilled", [])),
                              "ids": allocs.get("instilled", [])[:50]},
            },
        }
        # Truncation markers
        for cat in ("normal", "weaponSet1", "weaponSet2", "ascendancy", "instilled"):
            if len(allocs.get(cat, [])) > 50:
                result["allocations"][cat]["truncated"] = True
        return result


_ALL_TREE_TOOLS: list[type[_TreeTool]] = [
    TreeSummaryTool, ReadTreeNodesTool, SearchTreeNodesTool,
    ReadTreeNeighborhoodTool, FindTreePathTool, BuildSummaryTool,
]


def register_tree_tools(snapshot: TreeSnapshot) -> list[BaseTool]:
    return [cls(snapshot) for cls in _ALL_TREE_TOOLS]


def tree_tool_names() -> list[str]:
    names = []
    for cls in _ALL_TREE_TOOLS:
        # _TreeTool → tree_xxx
        raw = cls.__name__.replace("Tool", "")
        # CamelCase → snake_case
        name = ""
        for ch in raw:
            if ch.isupper() and name:
                name += "_" + ch.lower()
            else:
                name += ch.lower()
        name = name.replace("tree_", "", 1) if name.startswith("tree_") else name
        name = "tree_" + name if not name.startswith("tree_") else name
        # fix specific names
        name = name.replace("tree_read_tree_nodes", "read_tree_nodes")
        name = name.replace("tree_search_tree_nodes", "search_tree_nodes")
        name = name.replace("tree_read_tree_neighborhood", "read_tree_neighborhood")
        name = name.replace("tree_find_tree_path", "find_tree_path")
        name = name.replace("tree_tree_summary", "tree_summary")
        name = name.replace("tree_build_summary", "build_summary")
        names.append(name)
    return names