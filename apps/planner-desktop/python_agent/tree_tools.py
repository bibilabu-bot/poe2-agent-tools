"""Bounded read-only tree tools for the Python agent loop.

Consumes an immutable snapshot published by the Electron renderer
(after JS classification and graph construction).  No DOM access,
Planner globals, network or file system at runtime.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any, Callable, Mapping, Sequence

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


def _eligible(snapshot: "TreeSnapshot", node_id: str, category: str) -> bool:
    return snapshot.is_asc_eligible(node_id) if category == "ascendancy" else snapshot.is_general_eligible(node_id)


def shortest_path_ids(snapshot: "TreeSnapshot", target_id: str,
                      category: str = "general", start_id: str | None = None) -> list[str]:
    """Return a deterministic eligible path in start-to-target order."""
    target_id = str(target_id)
    if start_id is None:
        key = {"general": "generalParent", "weaponSet1": "weaponSet1Parent",
               "weaponSet2": "weaponSet2Parent", "ascendancy": "ascParent"}[category]
        parents = snapshot._path_index.get(key, {})
        if target_id not in parents:
            return []
        reversed_path: list[str] = []
        current: str | None = target_id
        while current is not None:
            reversed_path.append(current)
            current = parents.get(current)
            if len(reversed_path) > MAX_PATH_NODES:
                return []
        return list(reversed(reversed_path))

    start_id = str(start_id)
    if start_id == target_id:
        return [start_id]
    if not _eligible(snapshot, start_id, category) or not _eligible(snapshot, target_id, category):
        return []
    parents: dict[str, str | None] = {start_id: None}
    queue = [start_id]
    for current in queue:
        for neighbor in _sorted_ids(snapshot.neighbors(current)):
            if neighbor in parents or not _eligible(snapshot, neighbor, category):
                continue
            parents[neighbor] = current
            if neighbor == target_id:
                path = [target_id]
                while parents[path[-1]] is not None:
                    path.append(parents[path[-1]])
                return list(reversed(path))
            if len(parents) < len(snapshot.nodes):
                queue.append(neighbor)
    return []


def path_summary(snapshot: "TreeSnapshot", target_id: str,
                 category: str = "general") -> dict[str, Any]:
    path = shortest_path_ids(snapshot, target_id, category)
    if not path:
        return {"reachable": False, "targetId": str(target_id), "category": category,
                "snapshotId": snapshot.snapshot_id}
    allocated = set().union(*(snapshot.build.get("allocations", {}).get(name, [])
                              for name in ("normal", "weaponSet1", "weaponSet2", "ascendancy")))
    new_ids = [node_id for node_id in path if node_id not in allocated]
    return {"reachable": True, "targetId": str(target_id), "category": category,
            "nearestAllocatedId": path[0], "edgeDistance": max(0, len(path) - 1),
            "newAllocationCount": len(new_ids), "newNodeIds": new_ids,
            "snapshotId": snapshot.snapshot_id}


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
    semantic_topology: dict[str, Any] | None = None

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
        "englishName": node.get("englishName", ""),
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

    def _require_tree_catalog(self) -> None:
        if self._snapshot._error:
            raise AgentError("TREE_SNAPSHOT_UNAVAILABLE", f"当前天赋树目录不可用：{self._snapshot._error}")

    async def execute(self, arguments: Mapping[str, Any]) -> Any:
        raise NotImplementedError


def _tree_overview_stats(s: TreeSnapshot) -> dict[str, Any]:
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
    allocated_ids = set().union(*(b.get("allocations", {}).get(name, [])
                                  for name in ("normal", "weaponSet1", "weaponSet2", "ascendancy")))
    js_allocated = sum(1 for n in nodes if n.get("isJewelSocket") and n.get("id") in allocated_ids)
    return {"snapshotId": s.snapshot_id, "nodeCount": s.node_count,
            "coordinateRange": {"min": {"x": min_x if min_x != float("inf") else None,
                                       "y": min_y if min_y != float("inf") else None},
                                "max": {"x": max_x if max_x != float("-inf") else None,
                                       "y": max_y if max_y != float("-inf") else None}},
            "nodeKinds": kinds,
            "jewelSockets": {"scope": "entire_tree_catalog", "total": js_total,
                              "ordinary": js_ord, "special": js_total - js_ord,
                              "allocatedInCurrentBuild": js_allocated},
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
        self._require_tree_catalog()
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
        self._require_tree_catalog()
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
        for n in sorted(self._snapshot.nodes.values(), key=lambda x: str(x["id"])):
            nid = str(n["id"])
            if nid in seen:
                continue
            name = str(n.get("name", "")).lower()
            english_name = str(n.get("englishName", "")).lower()
            stats_text = " ".join(str(s) for s in n.get("stats", [])).lower()
            if name.startswith(query) or english_name.startswith(query):
                prefix_ids.append(nid); seen.add(nid)
            elif query in name or query in english_name:
                name_ids.append(nid); seen.add(nid)
            elif query in stats_text:
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
        self._require_tree_catalog()
        super().validate(arguments)
        nid = arguments.get("nodeId", "")
        if not isinstance(nid, str) or not nid.strip():
            raise AgentError("INVALID_TOOL_ARGUMENTS", "nodeId 不能为空")
        if not self._snapshot.node(str(nid)):
            raise AgentError("NODE_NOT_FOUND", f"节点 {nid} 在当前天赋树快照中不存在")

    async def execute(self, arguments: Mapping[str, Any]) -> Any:
        self._require_tree_catalog()
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
        self._require_tree_catalog()
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
        self._require_tree_catalog()
        target = str(arguments["targetId"])
        start_id = arguments.get("startId")
        category = arguments.get("category", "general")
        s = self._snapshot
        path_ids = shortest_path_ids(s, target, category, str(start_id) if start_id else None)
        if not path_ids:
            return {"path": [], "targetId": target, "reachable": False,
                    "hint": "目标节点在当前起始点集和资格条件下不可达",
                    "category": category, "snapshotId": s.snapshot_id}

        allocs = s.build.get("allocations", {})
        already = set(allocs.get("normal", []) + allocs.get("ascendancy", []) +
                      allocs.get("weaponSet1", []) + allocs.get("weaponSet2", []))
        new_ids = [nid for nid in path_ids if nid not in already]

        path_nodes = []
        for nid in path_ids:
            node = s.node(nid)
            if node:
                path_nodes.append({"id": nid, "name": node.get("name", ""),
                                   "kind": node.get("kind", "small"),
                                   "alreadyAllocated": nid in already,
                                   "isTarget": nid == target})

        result: dict[str, Any] = {
            "path": path_nodes, "pathLength": len(path_nodes),
            "edgeDistance": max(0, len(path_nodes) - 1),
            "nearestAllocatedId": path_ids[0] if not start_id else None,
            "startId": str(start_id) if start_id else None,
            "newNodesCount": len(new_ids), "newNodeIds": new_ids,
            "direction": "start_to_target", "category": category,
            "reachable": True, "snapshotId": s.snapshot_id,
        }
        if new_ids:
            result["warning"] = "路径不是可执行加点承诺；预算、未知条件和资格状态须由用户验证。"
        return result


def _build_overview_stats(s: TreeSnapshot) -> dict[str, Any]:
    b = s.build
    allocs = b.get("allocations", {})
    usage = b.get("budgetUsage", {})
    budgets = b.get("budgets", {})

    # Use Planner-derived usage counts (account for free starts).
    passive_used = usage.get("normal", 0)
    ws1_used = usage.get("weaponSet1", 0)
    ws2_used = usage.get("weaponSet2", 0)
    asc_used = usage.get("ascendancy", 0)

    result: dict[str, Any] = {
        "snapshotId": s.snapshot_id,
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
        "highlights": b.get("highlights", [])[:40],
    }
    if s._error:
        result["treeSnapshotWarning"] = s._error
    # Truncation markers
    for cat in ("normal", "weaponSet1", "weaponSet2", "ascendancy", "instilled"):
        if len(allocs.get(cat, [])) > 50:
            result["allocations"][cat]["truncated"] = True
    return result


class SemanticTopologyTool(_TreeTool):
    def __init__(self, snapshot: TreeSnapshot, name: str = "read_tree_cluster") -> None:
        super().__init__(snapshot, name)

    def _parameters(self) -> dict[str, Any]:
        return {"required": [], "properties": {
            "nodeId": {"type":"string"}, "clusterId": {"type":"string"},
            "section": {"type":"string", "enum":["clusters","nodes","edges","boundaries","unclassified","unclassifiedEdges","ascendancy","allocations"]},
            "offset": {"type":"integer", "minimum":0},
            "limit": {"type":"integer", "minimum":1, "maximum":20},
        }}

    def validate(self, arguments: Mapping[str, Any]) -> None:
        super().validate(arguments)
        offset,limit=arguments.get("offset",0),arguments.get("limit",20)
        if type(offset) is not int or offset<0 or type(limit) is not int or not 1<=limit<=20:
            raise AgentError("INVALID_TOOL_ARGUMENTS", "分页范围无效")
        if "section" in arguments and arguments["section"] not in self.parameters["properties"]["section"]["enum"]:
            raise AgentError("INVALID_TOOL_ARGUMENTS", "未知拓扑分区")
        for key in ("nodeId","clusterId"):
            if key in arguments and (not isinstance(arguments[key],str) or not arguments[key] or len(arguments[key])>128):
                raise AgentError("INVALID_TOOL_ARGUMENTS", "节点或簇 ID 无效")

    async def execute(self, arguments: Mapping[str, Any]) -> Any:
        self.validate(arguments)
        self._require_tree_catalog()
        topology=self._snapshot.semantic_topology
        if topology is None:
            raise AgentError("SEMANTIC_TOPOLOGY_UNAVAILABLE", "当前快照没有语义拓扑")
        offset,limit=arguments.get("offset",0),arguments.get("limit",20)
        if type(offset) is not int or offset<0 or type(limit) is not int or not 1<=limit<=20:
            raise AgentError("INVALID_TOOL_ARGUMENTS", "分页范围无效")
        section=arguments.get("section", "nodes" if self.name=="read_tree_cluster" else "clusters")
        if section not in self.parameters["properties"]["section"]["enum"]:
            raise AgentError("INVALID_TOOL_ARGUMENTS", "未知拓扑分区")
        for key in ("nodeId","clusterId"):
            if key in arguments and (not isinstance(arguments[key],str) or len(arguments[key])>128):
                raise AgentError("INVALID_TOOL_ARGUMENTS", "节点或簇 ID 无效")
        cluster_id=arguments.get("clusterId")
        if "nodeId" in arguments:
            node_id=arguments["nodeId"]
            mapped=topology["nodeToCluster"].get(node_id)
            if not mapped:
                reason=next((n["reason"] for n in topology["unclassifiedNodes"] if n["nodeId"]==node_id),
                            "ascendancy-excluded" if node_id in topology["excludedAscendancyNodeIds"] else "node-not-found")
                return {"nodeId":node_id,"clusterId":None,"reason":reason}
            if cluster_id and cluster_id!=mapped:
                raise AgentError("INVALID_TOOL_ARGUMENTS", "节点不属于指定簇")
            cluster_id=mapped
        clusters=topology["clusters"]
        cluster=next((c for c in clusters if c["id"]==cluster_id),None)
        if cluster_id and cluster is None:
            raise AgentError("CLUSTER_NOT_FOUND", "簇不存在")
        if self.name=="read_tree_cluster" and cluster is None:
            raise AgentError("INVALID_TOOL_ARGUMENTS", "请指定 clusterId 或 nodeId")
        if section=="clusters":
            rows=[{"id":c["id"],"type":c["type"],"nodeCount":len(c["nodeIds"]),"edgeCount":len(c["edges"])} for c in clusters if not cluster or c["id"]==cluster_id]
        elif section=="unclassified": rows=topology["unclassifiedNodes"]
        elif section=="unclassifiedEdges": rows=topology.get("unclassifiedEdges",[])
        elif section=="ascendancy": rows=topology["excludedAscendancyNodeIds"]
        elif section=="allocations":
            rows=[{"nodeId":node_id,"category":category} for category,ids in self._snapshot.build.get("allocations",{}).items() for node_id in ids]
        elif section=="boundaries":
            rows=[{"source":e["source"],"target":e["target"],"physicalEdge":edge}
                  for e in topology["clusterEdges"] if not cluster or cluster_id in (e["source"],e["target"])
                  for edge in e["physicalEdges"]]
        elif cluster is None:
            raise AgentError("INVALID_TOOL_ARGUMENTS", "读取内部图须指定簇")
        elif section=="edges": rows=cluster["edges"]
        else: rows=cluster["nodeIds"]
        return {"snapshotId":self._snapshot.snapshot_id,"version":topology["version"],
                "clusterId":cluster_id,"section":section,"clusterCount":len(clusters),
                "clusterEdgeCount":len(topology["clusterEdges"]),"total":len(rows),
                "items":rows[offset:offset+limit],"nextOffset":offset+limit if offset+limit<len(rows) else None}


class TreeOverviewTool(SemanticTopologyTool):
    """Current Build's complete named cluster graph; only detail sections paginate."""
    def __init__(self, snapshot: TreeSnapshot) -> None:
        super().__init__(snapshot, "tree_overview")
        self.before_hook = None

    def _parameters(self) -> dict[str, Any]:
        return {"required":[],"properties":{
            "section":{"type":"string","enum":["clusters","boundaries","allocations"]},
            "offset":{"type":"integer","minimum":0,"description":"仅用于 boundaries/allocations；clusters 总是完整返回"},
            "limit":{"type":"integer","minimum":1,"maximum":20,"description":"仅用于 boundaries/allocations；clusters 不分页"}}}

    async def execute(self, arguments: Mapping[str, Any]) -> Any:
        self.validate(arguments)
        build=_build_overview_stats(self._snapshot)
        build.pop("snapshotId",None)
        for category,allocation in build["allocations"].items():
            allocation.pop("ids",None)
            allocation.pop("truncated",None)
        build.pop("highlights",None)
        build["detailTools"]={"attributes":"read_tree_nodes","allocatedIds":"tree_overview section=allocations"}
        budgets=build["budgets"]
        for category in ("passive","ascendancy"):
            budgets[category]["remaining"]=max(0,budgets[category]["max"]-budgets[category]["used"])
            budgets[category]["overBudget"]=max(0,budgets[category]["used"]-budgets[category]["max"])
        for group in ("weaponSet1","weaponSet2"):
            budgets["weaponSet"][group+"Remaining"]=max(0,budgets["weaponSet"]["max"]-budgets["weaponSet"][group+"Used"])
            budgets["weaponSet"][group+"OverBudget"]=max(0,budgets["weaponSet"][group+"Used"]-budgets["weaponSet"]["max"])
        build["budgetRule"]="总天赋计费=通用计费+max(武器I,武器II)；分配节点数包含不计费起点/升华选项，不等于点数"
        build["class"]["ascendancyName"]=next((a.get("name") for a in self._snapshot.build.get("ascendancyOptions",[]) if a.get("id")==build["class"]["ascendancyId"]),None)
        result={"snapshotId":self._snapshot.snapshot_id,"scope":"current_build","build":build,"semanticTopology":None}
        if arguments.get("section")=="allocations":
            if "nodeId" in arguments or "clusterId" in arguments:
                raise AgentError("INVALID_TOOL_ARGUMENTS","分配目录不接受节点或簇过滤")
            offset,limit=arguments.get("offset",0),arguments.get("limit",20)
            rows=[{"nodeId":node_id,"category":category} for category,ids in self._snapshot.build.get("allocations",{}).items() for node_id in ids]
            result["allocationsPage"]={"items":rows[offset:offset+limit],"total":len(rows),"nextOffset":offset+limit if offset+limit<len(rows) else None}
        if self._snapshot._error:
            result["warning"]=self._snapshot._error
            return result
        topology=self._snapshot.semantic_topology
        if topology is None:
            result["warning"]="当前快照没有语义拓扑，仍可读取构筑信息"
            return result
        allocated={str(n) for category,ids in self._snapshot.build.get("allocations",{}).items()
                   if category!="instilled" for n in ids}
        touched={topology["nodeToCluster"][n] for n in allocated if n in topology["nodeToCluster"]}
        clusters=[c for c in topology["clusters"] if c["id"] in touched]
        links=[e for e in topology["clusterEdges"] if e["source"] in touched and e["target"] in touched]
        section=arguments.get("section","clusters")
        if section not in ("clusters","boundaries","allocations"):
            raise AgentError("INVALID_TOOL_ARGUMENTS","BD概览只支持 clusters、boundaries、allocations；簇内部请用 read_tree_cluster")
        rows=[]
        if section=="clusters":
            # Return every touched cluster and edge, even if old callers send paging arguments.
            summaries=await self.before_hook(clusters) if self.before_hook else {}
            rows=[{"id":c["id"],"type":c["type"],"nodeCount":len(c["nodeIds"]),
                   "allocatedNodeCount":sum(n in allocated for n in c["nodeIds"]),
                   **summaries.get(c["id"],{"name":{"attribute":"属性点簇","jewel":"珠宝孔簇","passive":"天赋簇"}[c["type"]],
                       "summary":f"属性簇：{len(c['nodeIds'])}个属性节点" if c["type"]=="attribute" else "珠宝孔" if c["type"]=="jewel" else "描述暂不可用",
                       "summarySource":"rule" if c["type"]!="passive" else "unavailable"})} for c in clusters]
            names={row["id"]:row.get("name","天赋簇") for row in rows}
        elif section=="boundaries":
            rows=[{"source":e["source"],"target":e["target"],"physicalEdge":edge,
                   "bothEndpointsAllocated":all(n in allocated for n in edge)}
                  for e in links for edge in e["physicalEdges"]]
        offset,limit=arguments.get("offset",0),arguments.get("limit",20)
        result["semanticTopology"]={"scope":"current_build","section":section,
            "clusterCount":len(clusters),"clusterEdgeCount":len(links),
            "typeCounts":{kind:sum(c["type"]==kind for c in clusters) for kind in ("attribute","jewel","passive")},
            "unclassifiedAllocatedNodeIds":sorted(n for n in allocated
                if n not in topology["nodeToCluster"] and n not in topology["excludedAscendancyNodeIds"]),
            "ascendancyAllocatedNodeIds":sorted(allocated.intersection(topology["excludedAscendancyNodeIds"])),
            "connectionRule":"连接表示BD涉及簇之间的真实物理边，不保证两端都已分配；boundaries可查端点状态",
            "summaryScope":"描述整个簇的潜在作用，不代表当前BD已获得全部效果；模型摘要仅作导航，详细属性以节点数据为准",
            "summaryCache":({"scope":"all_current_build_clusters",
                "cached":sum(v.get("summarySource")=="model_cache" for v in summaries.values()),
                "generated":sum(v.get("summarySource")=="model" for v in summaries.values()),
                "unavailable":sum(v.get("summarySource")=="unavailable" for v in summaries.values())}
                if section=="clusters" else None),
            "items":rows if section=="clusters" else rows[offset:offset+limit],"total":len(rows),
            "complete":True if section=="clusters" else offset==0 and len(rows)<=limit,
            "nextOffset":None if section=="clusters" else offset+limit if offset+limit<len(rows) else None}
        if section=="clusters":
            result["semanticTopology"]["clusterEdges"]=[
                {"source":e["source"],"sourceName":names[e["source"]],
                 "target":e["target"],"targetName":names[e["target"]],
                 "allocatedBoundaryCount":sum(all(n in allocated for n in edge) for edge in e["physicalEdges"])}
                for e in links]
        return result


_ALL_TREE_TOOLS: list[type[_TreeTool]] = [
    TreeOverviewTool, ReadTreeNodesTool, SearchTreeNodesTool,
    ReadTreeNeighborhoodTool, FindTreePathTool,
]

# ── Write tools (P2AT-028B extension) ──


class _TreeWriteTool(_TreeTool):
    """Base for tools that mutate the live build via Electron callback."""

    def __init__(self, snapshot: TreeSnapshot, name: str, write_method: str,
                 write_callback: Callable[..., Any] | None = None) -> None:
        super().__init__(snapshot, name)
        self._write_method = write_method
        self._cb = write_callback

    async def execute(self, arguments: Mapping[str, Any]) -> Any:
        self._require_tree_catalog()
        node_id = str(arguments["nodeId"])
        if not self._snapshot.has(node_id):
            raise AgentError("NODE_NOT_FOUND", f"节点 {node_id} 在当前天赋树快照中不存在")
        if not self._cb:
            raise AgentError("TREE_WRITE_UNAVAILABLE", "天赋树写入功能未连接")
        result = dict(await self._cb(self._write_method, dict(arguments)))
        updated = result.pop("snapshot", None)
        if not updated:
            self._snapshot._error = "写入后快照不可用，请重新读取当前构筑"
            self._snapshot.build = {}
            self._snapshot.nodes = {}
            self._snapshot.adjacency = {}
            self._snapshot._path_index = {}
            self._snapshot.node_count = 0
            self._snapshot.snapshot_id = "write-refresh-failed"
            self._snapshot.semantic_topology = None
            return {**result, "refreshError": True, "message": "写入已完成，但快照刷新失败。不要重复写入；请在新消息中重新读取构筑。"}
        # All tools (including RAG path enrichment) share this holder. Replace
        # every published field together before the next tool executes.
        self._snapshot.__dict__.update(
            snapshot_id=updated.get("snapshotId", ""),
            node_count=updated.get("nodeCount", 0),
            nodes={n["id"]: n for n in updated.get("nodes", [])},
            adjacency=updated.get("adjacency", {}), build=updated.get("build", {}),
            _path_index=updated.get("_pathIndex", {}), _error=updated.get("_error"),
            semantic_topology=updated.get("semanticTopology"),
        )
        result["snapshotId"] = self._snapshot.snapshot_id
        return result


class AllocateTreeNodeTool(_TreeWriteTool):
    def __init__(self, snapshot: TreeSnapshot, write_callback: Callable[..., Any] | None = None) -> None:
        super().__init__(snapshot, "allocate_tree_node", "allocate", write_callback)

    def validate(self, arguments: Mapping[str, Any]) -> None:
        super().validate(arguments)
        if arguments["category"] not in ("general", "weaponSet1", "weaponSet2", "ascendancy"):
            raise AgentError("INVALID_TOOL_ARGUMENTS", "无效的加点类别")
        if not isinstance(arguments["nodeId"], str) or not arguments["nodeId"]:
            raise AgentError("INVALID_TOOL_ARGUMENTS", "nodeId 必须是非空字符串")

    def _parameters(self) -> dict[str, Any]:
        return {"required": ["nodeId", "category"], "properties": {
            "nodeId": {"type": "string"},
            "category": {"type": "string", "enum": ["general", "weaponSet1", "weaponSet2", "ascendancy"]},
        }}


class DeallocateTreeNodeTool(_TreeWriteTool):
    def __init__(self, snapshot: TreeSnapshot, write_callback: Callable[..., Any] | None = None) -> None:
        super().__init__(snapshot, "deallocate_tree_node", "deallocate", write_callback)

    def _parameters(self) -> dict[str, Any]:
        return {"required": ["nodeId", "category"], "properties": {
            "nodeId": {"type": "string"},
            "category": {"type": "string", "enum": ["general", "weaponSet1", "weaponSet2", "ascendancy"]},
        }}


def register_tree_tools(snapshot: TreeSnapshot, write_callback: Callable[..., Any] | None = None) -> list[BaseTool]:
    tools: list[BaseTool] = [cls(snapshot) for cls in _ALL_TREE_TOOLS]
    if snapshot.semantic_topology is not None:
        tools.append(SemanticTopologyTool(snapshot))
    if write_callback is not None:
        tools.append(AllocateTreeNodeTool(snapshot, write_callback))
        tools.append(DeallocateTreeNodeTool(snapshot, write_callback))
    return tools


def tree_tool_names() -> list[str]:
    return [cls(TreeSnapshot()).name for cls in _ALL_TREE_TOOLS] + ["read_tree_cluster"]
