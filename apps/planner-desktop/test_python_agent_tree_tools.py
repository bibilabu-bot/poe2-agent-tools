"""Bounded read-only tree tools — snapshot, tool registration and error paths."""

import unittest
from unittest.mock import patch, AsyncMock, MagicMock

from python_agent.core import AgentError
from python_agent.tree_tools import (
    TreeSnapshot,
    register_tree_tools,
    tree_tool_names,
    _bfs_parents,
    _path_from_parents,
    _sorted_ids,
    _compare_ids,
    MAX_READ_IDS,
    MAX_NEIGHBORHOOD_HOPS,
    MAX_NEIGHBORHOOD_NODES,
    MAX_SEARCH_RESULTS,
)


def _make_fixture_nodes(node_ids=("100","200","300","400","500","600")):
    return {
        "100": {"id":"100", "name":"Strength", "stats":["+10 to Strength","5% increased melee damage"], "statsTotal":2,
                "kind":"small", "x":100, "y":200, "asc":None, "isJewelSocket":False,
                "isKeystone":False, "isNotable":False, "isAscendancy":False, "isClassStart":False,
                "isConditionalReveal":False, "constraintSatisfied":True,
                "isGeneralEligible":True, "isAscEligible":False, "neighbors":["200"]},
        "200": {"id":"200", "name":"Notable Power", "stats":["+20 to Strength","10% increased area damage","5% reduced attack speed"],
                "statsTotal":3, "kind":"notable", "x":200, "y":300, "asc":None, "isJewelSocket":False,
                "isKeystone":False, "isNotable":True, "isAscendancy":False, "isClassStart":False,
                "isConditionalReveal":False, "constraintSatisfied":True,
                "isGeneralEligible":True, "isAscEligible":False, "neighbors":["100","300","500"]},
        "300": {"id":"300", "name":"Jewel Socket", "stats":[], "statsTotal":0,
                "kind":"jewel", "x":300, "y":400, "asc":None, "isJewelSocket":True, "isOrdinaryJewelSocket":True,
                "isKeystone":False, "isNotable":False, "isAscendancy":False, "isClassStart":False,
                "isConditionalReveal":False, "constraintSatisfied":True,
                "isGeneralEligible":True, "isAscEligible":False, "neighbors":["200","400"]},
        "400": {"id":"400", "name":"Keystone End", "stats":["All damage is converted to Fire"], "statsTotal":1,
                "kind":"keystone", "x":400, "y":500, "asc":None, "isJewelSocket":False,
                "isKeystone":True, "isNotable":False, "isAscendancy":False, "isClassStart":False,
                "isConditionalReveal":False, "constraintSatisfied":True,
                "isGeneralEligible":True, "isAscEligible":False, "neighbors":["300"]},
        "500": {"id":"500", "name":"Hidden Power", "stats":["+40 to Strength","20% more damage"],
                "statsTotal":2, "kind":"notable", "x":250, "y":350, "asc":None, "isJewelSocket":False,
                "isKeystone":False, "isNotable":True, "isAscendancy":False, "isClassStart":False,
                "isConditionalReveal":True, "constraintSatisfied":False,
                "isGeneralEligible":False, "isAscEligible":False, "neighbors":["200"]},
        "600": {"id":"600", "name":"Asc Notable", "stats":["+15 to all Attributes"], "statsTotal":1,
                "kind":"notable", "x":50, "y":100, "asc":"Asc_Invoker", "isJewelSocket":False,
                "isKeystone":False, "isNotable":True, "isAscendancy":True, "isClassStart":False,
                "isConditionalReveal":False, "constraintSatisfied":True,
                "isGeneralEligible":False, "isAscEligible":True, "neighbors":[]},
    }


def _make_fixture_snapshot():
    nodes = _make_fixture_nodes()
    adjacency = {nid: list(n.get("neighbors",[])) for nid, n in nodes.items()}
    return TreeSnapshot(
        snapshot_id="test-snapshot-001",
        node_count=len(nodes),
        nodes=nodes,
        adjacency=adjacency,
        build={
            "baseClassName": "Warrior",
            "selectedAscendancyId": None,
            "classStartId": "100",
            "budgets": {"passive": 122, "weaponSet": 24, "ascendancy": 8},
            "budgetUsage": {"normal": 1, "weaponSet1": 0, "weaponSet2": 0, "ascendancy": 0, "instilled": 0},
            "allocations": {"normal": ["100"], "weaponSet1":[], "weaponSet2":[], "ascendancy":[], "instilled":[]},
            "ascendancyOptions": [],
        },
    )


class BfsTests(unittest.TestCase):
    def test_deterministic_starts_and_neighbors(self):
        adj = {"3": ["1", "2"], "2": ["3"], "1": ["3", "4"], "4": ["1"]}
        eligible = {"1": True, "2": True, "3": True, "4": True}
        parent = _bfs_parents(["3", "1"], adj, eligible)
        self.assertEqual(parent.get("3"), None)
        self.assertEqual(parent.get("1"), None)
        self.assertIn("2", parent)
        self.assertIn("4", parent)

    def test_cycle_terminates(self):
        adj = {"1": ["2"], "2": ["3", "1"], "3": ["2"]}
        eligible = {"1": True, "2": True, "3": True}
        parent = _bfs_parents(["1"], adj, eligible)
        self.assertEqual(parent.get("1"), None)
        self.assertEqual(parent["2"], "1")
        self.assertEqual(parent["3"], "2")

    def test_disconnected_returns_empty_path(self):
        adj = {"1": [], "2": []}
        eligible = {"1": True, "2": True}
        parent = _bfs_parents(["1"], adj, eligible)
        self.assertEqual(_path_from_parents(parent, "2"), [])

    def test_not_eligible_blocked(self):
        adj = {"1": ["2"], "2": ["1"]}
        eligible = {"1": True, "2": False}
        parent = _bfs_parents(["1"], adj, eligible)
        self.assertEqual(_path_from_parents(parent, "2"), [])

    def test_path_target_to_start_order(self):
        adj = {"1": ["2"], "2": ["3", "1"], "3": ["2", "4"], "4": ["3"]}
        eligible = {"1": True, "2": True, "3": True, "4": True}
        parent = _bfs_parents(["1"], adj, eligible)
        path = _path_from_parents(parent, "4")
        self.assertEqual(path, ["4", "3", "2", "1"])

    def test_multi_start_deterministic(self):
        adj = {"1": ["3"], "2": ["3"], "3": ["1", "2"]}
        eligible = {"1": True, "2": True, "3": True}
        parent = _bfs_parents(["1", "2"], adj, eligible)
        self.assertEqual(_path_from_parents(parent, "3"), ["3", "1"])


class SnapshotTests(unittest.TestCase):
    def test_node_lookup(self):
        snap = _make_fixture_snapshot()
        self.assertTrue(snap.has("100"))
        self.assertFalse(snap.has("999"))
        n = snap.node("200")
        self.assertEqual(n["name"], "Notable Power")
        self.assertEqual(snap.neighbors("200"), ["100", "300", "500"])

    def test_missing_node_returns_none(self):
        snap = _make_fixture_snapshot()
        self.assertIsNone(snap.node("99999"))

    def test_eligibility_flags(self):
        snap = _make_fixture_snapshot()
        self.assertTrue(snap.is_general_eligible("100"))
        self.assertFalse(snap.is_general_eligible("600"))
        self.assertFalse(snap.is_asc_eligible("100"))
        self.assertTrue(snap.is_asc_eligible("600"))
        self.assertFalse(snap.is_general_eligible("500"))

    def test_allocation_categories(self):
        snap = _make_fixture_snapshot()
        allocs = snap.build["allocations"]
        self.assertIn("100", allocs["normal"])
        self.assertEqual(len(allocs["weaponSet1"]), 0)


class ToolRegistrationTests(unittest.TestCase):
    def test_all_six_tools_created(self):
        snap = _make_fixture_snapshot()
        tools = register_tree_tools(snap)
        self.assertEqual(len(tools), 6)
        names = {t.name for t in tools}
        expected = {"tree_summary", "read_tree_nodes", "search_tree_nodes",
                    "read_tree_neighborhood", "find_tree_path", "build_summary"}
        self.assertEqual(names, expected)

    def test_tool_names_match_convention(self):
        names = tree_tool_names()
        self.assertGreaterEqual(len(names), 6)


class ToolExecutionTests(unittest.IsolatedAsyncioTestCase):
    async def test_tree_summary(self):
        snap = _make_fixture_snapshot()
        tool = register_tree_tools(snap)[0]
        self.assertEqual(tool.name, "tree_summary")
        result = await tool.execute({})
        self.assertEqual(result["nodeCount"], 6)
        self.assertIn("coordinateRange", result)

    async def test_read_tree_nodes_single(self):
        snap = _make_fixture_snapshot()
        tools = {t.name: t for t in register_tree_tools(snap)}
        result = await tools["read_tree_nodes"].execute({"ids": ["200"]})
        self.assertEqual(len(result["nodes"]), 1)
        self.assertEqual(result["nodes"][0]["name"], "Notable Power")
        self.assertEqual(len(result["nodes"][0]["stats"]), 3)
        self.assertTrue(result["nodes"][0]["statsComplete"])
        self.assertEqual(result["missing"], [])

    async def test_read_tree_nodes_missing(self):
        snap = _make_fixture_snapshot()
        tools = {t.name: t for t in register_tree_tools(snap)}
        result = await tools["read_tree_nodes"].execute({"ids": ["200", "99999"]})
        self.assertEqual(len(result["nodes"]), 1)
        self.assertEqual(result["missing"], ["99999"])

    async def test_read_tree_nodes_stat_paging(self):
        snap = _make_fixture_snapshot()
        tools = {t.name: t for t in register_tree_tools(snap)}
        result = await tools["read_tree_nodes"].execute({"ids": ["200"], "statsOffset": 0, "statsLimit": 2})
        self.assertEqual(len(result["nodes"][0]["stats"]), 2)
        self.assertFalse(result["nodes"][0]["statsComplete"])
        self.assertEqual(result["nodes"][0]["statsOffset"], 0)

    async def test_read_tree_nodes_too_many_ids(self):
        snap = _make_fixture_snapshot()
        tools = {t.name: t for t in register_tree_tools(snap)}
        with self.assertRaises(AgentError) as ctx:
            tools["read_tree_nodes"].validate({"ids":["100","200","300","400"]})
        self.assertEqual(ctx.exception.code, "INVALID_TOOL_ARGUMENTS")

    async def test_search_exact_id(self):
        snap = _make_fixture_snapshot()
        tools = {t.name: t for t in register_tree_tools(snap)}
        result = await tools["search_tree_nodes"].execute({"query": "200"})
        self.assertEqual(result["matchType"], "exact_id")
        self.assertEqual(result["matches"][0]["name"], "Notable Power")

    async def test_search_by_name_prefix(self):
        snap = _make_fixture_snapshot()
        tools = {t.name: t for t in register_tree_tools(snap)}
        result = await tools["search_tree_nodes"].execute({"query": "Notable"})
        self.assertEqual(result["matchType"], "lexical")
        self.assertGreaterEqual(result["totalMatches"], 1)

    async def test_search_by_stat_text(self):
        snap = _make_fixture_snapshot()
        tools = {t.name: t for t in register_tree_tools(snap)}
        result = await tools["search_tree_nodes"].execute({"query": "converted to Fire"})
        self.assertGreaterEqual(result["totalMatches"], 1)
        names = [m["name"] for m in result["matches"]]
        self.assertIn("Keystone End", names)

    async def test_neighborhood_bounded(self):
        snap = _make_fixture_snapshot()
        tools = {t.name: t for t in register_tree_tools(snap)}
        result = await tools["read_tree_neighborhood"].execute({"nodeId": "100", "maxHops": 2, "maxNodes": 20})
        self.assertEqual(result["center"]["name"], "Strength")
        self.assertIn("hop1", result["layers"])
        self.assertEqual(result["layers"]["hop1"]["nodeIds"], ["200"])
        self.assertLessEqual(result["totalVisited"], 20)

    async def test_neighborhood_missing_node(self):
        snap = _make_fixture_snapshot()
        tools = {t.name: t for t in register_tree_tools(snap)}
        with self.assertRaises(AgentError) as ctx:
            tools["read_tree_neighborhood"].validate({"nodeId": "99999"})
        self.assertEqual(ctx.exception.code, "NODE_NOT_FOUND")

    async def test_path_simple_general(self):
        snap = _make_fixture_snapshot()
        tools = {t.name: t for t in register_tree_tools(snap)}
        result = await tools["find_tree_path"].execute({"targetId": "400", "category": "general"})
        self.assertTrue(result["reachable"])
        self.assertEqual([n["id"] for n in result["path"]], ["100", "200", "300", "400"])

    async def test_path_unreachable(self):
        snap = _make_fixture_snapshot()
        tools = {t.name: t for t in register_tree_tools(snap)}
        result = await tools["find_tree_path"].execute({"targetId": "500", "category": "general"})
        self.assertFalse(result["reachable"])

    async def test_path_missing_target(self):
        snap = _make_fixture_snapshot()
        tools = {t.name: t for t in register_tree_tools(snap)}
        with self.assertRaises(AgentError) as ctx:
            tools["find_tree_path"].validate({"targetId": "99999", "category": "general"})
        self.assertEqual(ctx.exception.code, "NODE_NOT_FOUND")

    async def test_build_summary(self):
        snap = _make_fixture_snapshot()
        tools = {t.name: t for t in register_tree_tools(snap)}
        result = await tools["build_summary"].execute({})
        self.assertEqual(result["class"]["base"], "Warrior")
        self.assertEqual(result["allocations"]["normal"]["count"], 1)

    async def test_all_tools_produce_nontrivial_results(self):
        snap = _make_fixture_snapshot()
        for tool in register_tree_tools(snap):
            args = {}
            if tool.name == "read_tree_nodes":
                args = {"ids": ["200"]}
            elif tool.name == "search_tree_nodes":
                args = {"query": "Strength"}
            elif tool.name == "read_tree_neighborhood":
                args = {"nodeId": "100", "maxHops": 1, "maxNodes": 10}
            elif tool.name == "find_tree_path":
                args = {"targetId": "300", "category": "general"}
            try:
                result = await tool.execute(args)
            except AgentError as e:
                if e.code not in ("NO_ASCENDANCY",):
                    raise
            self.assertIsNotNone(result, f"tool {tool.name} returned None")

    async def test_unknown_id_is_missing_not_crashed(self):
        snap = _make_fixture_snapshot()
        tools = {t.name: t for t in register_tree_tools(snap)}
        result = await tools["read_tree_nodes"].execute({"ids": ["99999999", "88888888"]})
        self.assertEqual(len(result["nodes"]), 0)
        self.assertEqual(len(result["missing"]), 2)

    async def test_build_state_unchanged_after_tool_execution(self):
        snap = _make_fixture_snapshot()
        build_before = dict(snap.build["allocations"])
        for tool in register_tree_tools(snap):
            args = {}
            if tool.name == "read_tree_nodes":
                args = {"ids": ["200"]}
            elif tool.name == "search_tree_nodes":
                args = {"query": "Strength"}
            elif tool.name == "read_tree_neighborhood":
                args = {"nodeId": "100", "maxHops": 1}
            elif tool.name == "find_tree_path":
                args = {"targetId": "300", "category": "general"}
            try:
                await tool.execute(args)
            except AgentError:
                pass
        build_after = dict(snap.build["allocations"])
        self.assertEqual(build_before, build_after,
                         "No tool execution should mutate Build allocations")

    async def test_long_stats_are_capped_for_node_54814_pattern(self):
        snap = _make_fixture_snapshot()
        n200 = snap.node("200")
        original_stats = list(n200["stats"])
        extended_stats = original_stats + [f"stat line {i}" for i in range(3, 40)]
        n200_ext = dict(n200, stats=extended_stats[:32], statsTotal=len(extended_stats))
        nodes = dict(snap.nodes, **{"200": n200_ext})
        snap2 = TreeSnapshot(snapshot_id=snap.snapshot_id, node_count=snap.node_count,
                             nodes=nodes, adjacency=snap.adjacency, build=snap.build)
        tools = {t.name: t for t in register_tree_tools(snap2)}
        result = await tools["read_tree_nodes"].execute({"ids": ["200"], "statsOffset": 0, "statsLimit": 8})
        self.assertEqual(len(result["nodes"][0]["stats"]), 8)
        self.assertEqual(result["nodes"][0]["statsTotal"], len(extended_stats))
        self.assertFalse(result["nodes"][0]["statsComplete"])


if __name__ == "__main__":
    unittest.main()