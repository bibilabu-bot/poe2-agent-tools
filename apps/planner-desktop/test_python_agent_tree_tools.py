"""Bounded read-only tree tools — snapshot, tool registration and error paths."""

import copy
import unittest


class WriteRefreshTests(unittest.IsolatedAsyncioTestCase):
    async def test_overview_paging_budgets_and_degraded_snapshot(self):
        snap=TreeSnapshot(build={"allocations":{"normal":[str(i) for i in range(65)]},
            "budgets":{"passive":123,"weaponSet":24,"ascendancy":8},
            "budgetUsage":{"normal":104,"weaponSet1":16,"weaponSet2":25,"ascendancy":9}})
        tools={t.name:t for t in register_tree_tools(snap)}
        self.assertTrue({"tree_summary","build_summary","list_tree_clusters"}.isdisjoint(tools))
        for error in (None,"fixture projection failure"):
            snap._error=error
            result=await tools["tree_overview"].execute({"section":"allocations","offset":60})
            self.assertEqual(result["allocationsPage"]["total"],65)
            self.assertEqual([r["nodeId"] for r in result["allocationsPage"]["items"]],list(map(str,range(60,65))))
            self.assertIsNone(result["allocationsPage"]["nextOffset"])
            budgets=result["build"]["budgets"]
            self.assertEqual(budgets["passive"]["remaining"],19)
            self.assertEqual(budgets["ascendancy"]["overBudget"],1)
            self.assertEqual(budgets["weaponSet"]["weaponSet1Remaining"],8)
            self.assertEqual(budgets["weaponSet"]["weaponSet2OverBudget"],1)
            with self.assertRaises(AgentError):
                await tools["tree_overview"].execute({"limit":21})

    async def test_semantic_tools_locate_page_and_retain_physical_boundaries(self):
        topology={"version":"semantic-topology-v1","clusters":[{"id":"passive:1","type":"passive","nodeIds":[str(i) for i in range(30)],"edges":[["1","2"]]}],
                  "clusterEdges":[{"source":"attribute:9","target":"passive:1","physicalEdges":[["1","9"]]}],
                  "nodeToCluster":{"1":"passive:1"},"unclassifiedNodes":[{"nodeId":"99","reason":"unknown"}],"excludedAscendancyNodeIds":["88"]}
        snap=TreeSnapshot(semantic_topology=topology)
        tools={t.name:t for t in register_tree_tools(snap)}
        read=tools["read_tree_cluster"]
        result=await read.execute({"nodeId":"1"})
        self.assertEqual(len(result["items"]),20)
        self.assertEqual(result["nextOffset"],20)
        self.assertEqual((await read.execute({"nodeId":"1","offset":20}))["nextOffset"],None)
        self.assertEqual((await read.execute({"nodeId":"1","section":"boundaries"}))["items"][0]["physicalEdge"],["1","9"])
        self.assertEqual((await read.execute({"nodeId":"99"}))["reason"],"unknown")
        self.assertEqual((await read.execute({"nodeId":"88"}))["reason"],"ascendancy-excluded")
        with self.assertRaises(AgentError): await read.execute({"nodeId":"1","limit":100})

    async def test_refresh_failure_keeps_write_success_but_invalidates_old_reads(self):
        from python_agent.tree_tools import TreeSnapshot, register_tree_tools
        snap=TreeSnapshot(snapshot_id="old",nodes={"100":{"id":"100"}},build={"budgetUsage":{"normal":9}})
        async def callback(*args):
            return {"success":True,"refreshError":True}
        tools={t.name:t for t in register_tree_tools(snap,callback)}
        result=await tools["allocate_tree_node"].execute({"nodeId":"100"})
        self.assertTrue(result["success"])
        self.assertTrue(result["refreshError"])
        self.assertEqual(snap.build,{})
        self.assertTrue(snap._error)

    async def test_write_refreshes_shared_snapshot_without_exposing_full_catalog(self):
        from python_agent.tree_tools import TreeSnapshot, register_tree_tools
        snap = TreeSnapshot(snapshot_id="before", nodes={"100": {"id":"100"}})
        async def callback(method, args):
            return {"success": True, "snapshot": {"snapshotId":"after", "nodeCount":1,
                "nodes":[{"id":"100"}], "build":{"budgetUsage":{"normal":1}},
                "adjacency":{}, "_pathIndex":{"generalParent":{"100":None}}}}
        tools = {t.name:t for t in register_tree_tools(snap, callback)}
        result = await tools["allocate_tree_node"].execute({"nodeId":"100"})
        self.assertNotIn("snapshot", result)
        self.assertEqual(result["snapshotId"], "after")
        self.assertEqual(snap.build["budgetUsage"]["normal"], 1)
        self.assertEqual(tools["tree_overview"]._snapshot.snapshot_id,"after")
        self.assertEqual(tools["find_tree_path"]._snapshot._path_index["generalParent"],{"100":None})

    async def test_disabled_rpc_does_not_wire_write_callback(self):
        from python_agent.rpc_server import dispatch
        class Service:
            async def send(self, *args):
                assert self._tree_write_callback is None
                return {}
        await dispatch(Service(), "send", {"toolsEnabled":False})

from python_agent.core import AgentError
from python_agent.tree_tools import (
    TreeSnapshot,
    register_tree_tools,
    tree_tool_names,
    MAX_READ_IDS,
)
from python_agent.rag import RagTool


def _make_fixture_nodes():
    return {
        "100": {"id":"100","name":"Strength","stats":["+10 to Strength","5% increased melee damage"],
                "kind":"small","x":100,"y":200,"asc":None,"isJewelSocket":False,
                "isKeystone":False,"isNotable":False,"isAscendancy":False,"isClassStart":False,
                "isConditionalReveal":False,"constraintSatisfied":True,
                "isGeneralEligible":True,"isAscEligible":False,"neighbors":["200"]},
        "200": {"id":"200","name":"Notable Power","stats":["+20 to Strength","10% increased area damage","5% reduced attack speed"],
                "kind":"notable","x":200,"y":300,"asc":None,"isJewelSocket":False,
                "isKeystone":False,"isNotable":True,"isAscendancy":False,"isClassStart":False,
                "isConditionalReveal":False,"constraintSatisfied":True,
                "isGeneralEligible":True,"isAscEligible":False,"neighbors":["100","300","500"]},
        "300": {"id":"300","name":"Jewel Socket","stats":[],
                "kind":"jewel","x":300,"y":400,"asc":None,"isJewelSocket":True,"isOrdinaryJewelSocket":True,
                "isKeystone":False,"isNotable":False,"isAscendancy":False,"isClassStart":False,
                "isConditionalReveal":False,"constraintSatisfied":True,
                "isGeneralEligible":True,"isAscEligible":False,"neighbors":["200","400"]},
        "400": {"id":"400","name":"Keystone End","stats":["All damage is converted to Fire"],
                "kind":"keystone","x":400,"y":500,"asc":None,"isJewelSocket":False,
                "isKeystone":True,"isNotable":False,"isAscendancy":False,"isClassStart":False,
                "isConditionalReveal":False,"constraintSatisfied":True,
                "isGeneralEligible":True,"isAscEligible":False,"neighbors":["300"]},
        "500": {"id":"500","name":"Hidden Power","stats":["+40 to Strength","20% more damage"],
                "kind":"notable","x":250,"y":350,"asc":None,"isJewelSocket":False,
                "isKeystone":False,"isNotable":True,"isAscendancy":False,"isClassStart":False,
                "isConditionalReveal":True,"constraintSatisfied":False,
                "isGeneralEligible":False,"isAscEligible":False,"neighbors":["200"]},
        "600": {"id":"600","name":"Asc Notable","stats":["+15 to all Attributes"],
                "kind":"notable","x":50,"y":100,"asc":"Asc_Invoker","isJewelSocket":False,
                "isKeystone":False,"isNotable":True,"isAscendancy":True,"isClassStart":False,
                "isConditionalReveal":False,"constraintSatisfied":True,
                "isGeneralEligible":False,"isAscEligible":True,"neighbors":[]},
    }


def _make_fixture_snapshot():
    nodes = _make_fixture_nodes()
    adjacency = {nid: list(n.get("neighbors", [])) for nid, n in nodes.items()}
    # Precomputed path index for general category: start=100, BFS over eligible nodes
    general_parent = {"100": None, "200": "100", "300": "200", "400": "300"}
    return TreeSnapshot(
        snapshot_id="test-snapshot-001",
        node_count=len(nodes),
        nodes=nodes,
        adjacency=adjacency,
        _path_index={"generalParent": general_parent, "weaponSet1Parent": {},
                     "weaponSet2Parent": {}, "ascParent": {}},
        build={
            "baseClassName": "Warrior",
            "selectedAscendancyId": None,
            "classStartId": "100",
            "budgets": {"passive": 122, "weaponSet": 24, "ascendancy": 8},
            "budgetUsage": {"normal": 1, "weaponSet1": 0, "weaponSet2": 0, "ascendancy": 0, "instilled": 0},
            "allocations": {"normal": ["100"], "weaponSet1": [], "weaponSet2": [], "ascendancy": [], "instilled": []},
            "ascendancyOptions": [],
        },
    )


class SnapshotTests(unittest.TestCase):
    def test_node_lookup(self):
        snap = _make_fixture_snapshot()
        self.assertTrue(snap.has("100"))
        self.assertFalse(snap.has("999"))
        n = snap.node("200")
        self.assertEqual(n["name"], "Notable Power")

    def test_missing_node_returns_none(self):
        self.assertIsNone(_make_fixture_snapshot().node("99999"))

    def test_eligibility_flags(self):
        snap = _make_fixture_snapshot()
        self.assertTrue(snap.is_general_eligible("100"))
        self.assertFalse(snap.is_general_eligible("600"))
        self.assertFalse(snap.is_asc_eligible("100"))
        self.assertTrue(snap.is_asc_eligible("600"))

    def test_allocation_categories(self):
        snap = _make_fixture_snapshot()
        self.assertIn("100", snap.build["allocations"]["normal"])


class ToolRegistrationTests(unittest.TestCase):
    def test_unified_overview_replaces_both_summaries(self):
        tools = register_tree_tools(_make_fixture_snapshot())
        self.assertEqual(len(tools), 5)
        self.assertEqual({t.name for t in tools},
                         {"tree_overview", "read_tree_nodes", "search_tree_nodes",
                          "read_tree_neighborhood", "find_tree_path"})

    def test_tool_names_match_convention(self):
        self.assertGreaterEqual(len(tree_tool_names()), 5)

    def test_error_snapshot_still_registers_all_tools(self):
        snap = _make_fixture_snapshot()
        snap._error = "localization unavailable"
        self.assertEqual({tool.name for tool in register_tree_tools(snap)},
                         {"tree_overview", "read_tree_nodes", "search_tree_nodes",
                          "read_tree_neighborhood", "find_tree_path"})


class ToolExecutionTests(unittest.IsolatedAsyncioTestCase):
    async def test_error_snapshot_keeps_tree_overview_and_fails_tree_explicitly(self):
        snap = _make_fixture_snapshot()
        snap._error = "localization unavailable"
        tools = {tool.name: tool for tool in register_tree_tools(snap)}
        summary = await tools["tree_overview"].execute({})
        self.assertEqual(summary["build"]["budgets"]["passive"]["used"], 1)
        self.assertEqual(summary["warning"], "localization unavailable")
        with self.assertRaisesRegex(AgentError, "当前天赋树目录不可用"):
            await tools["read_tree_nodes"].execute({"ids":["100"]})
        for name, arguments in (
            ("read_tree_neighborhood", {"nodeId": "100"}),
            ("find_tree_path", {"targetId": "400"}),
        ):
            with self.subTest(name=name), self.assertRaisesRegex(AgentError, "当前天赋树目录不可用"):
                tools[name].validate(arguments)

    async def test_rag_search_adds_distance_to_current_build(self):
        class FakeIndex:
            def records(self):
                return [{"id": "400", "text": "fire", "name": "Keystone End"}]
            def status(self):
                return {"version": "fixture"}
            async def search(self, query, records):
                return {"matches": [{"id": "400", "name": "Keystone End"}]}
        result = await RagTool(FakeIndex(), "search_passive_nodes",
                               tree_snapshot=_make_fixture_snapshot()).execute({"query": "fire"})
        path = result["matches"][0]["currentBuildPath"]
        self.assertTrue(path["reachable"])
        self.assertEqual(path["edgeDistance"], 3)
        self.assertEqual(path["nearestAllocatedId"], "100")

    async def test_overview_only_current_build_clusters(self):
        snapshot = _make_fixture_snapshot()
        snapshot.semantic_topology={"version":"v1","clusters":[
            {"id":"passive:a","type":"passive","nodeIds":["100","200"],"edges":[["100","200"]]},
            {"id":"passive:b","type":"passive","nodeIds":["999"],"edges":[]}],
            "nodeToCluster":{"100":"passive:a","200":"passive:a","999":"passive:b"},
            "clusterEdges":[],"unclassifiedNodes":[],"excludedAscendancyNodeIds":[]}
        tool = register_tree_tools(snapshot)[0]
        self.assertEqual(tool.name, "tree_overview")
        result = await tool.execute({})
        self.assertNotIn("tree",result)
        self.assertEqual(result["scope"],"current_build")
        self.assertEqual(result["semanticTopology"]["clusterCount"],1)
        self.assertEqual([c["id"] for c in result["semanticTopology"]["items"]],["passive:a"])

    async def test_read_tree_nodes_single(self):
        tools = {t.name: t for t in register_tree_tools(_make_fixture_snapshot())}
        result = await tools["read_tree_nodes"].execute({"ids": ["200"]})
        self.assertEqual(len(result["nodes"]), 1)
        self.assertEqual(result["nodes"][0]["name"], "Notable Power")
        self.assertEqual(len(result["nodes"][0]["stats"]), 3)
        self.assertTrue(result["nodes"][0]["statsComplete"])

    async def test_read_tree_nodes_missing(self):
        tools = {t.name: t for t in register_tree_tools(_make_fixture_snapshot())}
        result = await tools["read_tree_nodes"].execute({"ids": ["200", "99999"]})
        self.assertEqual(len(result["nodes"]), 1)
        self.assertEqual(result["missing"], ["99999"])

    async def test_read_tree_nodes_stat_paging(self):
        tools = {t.name: t for t in register_tree_tools(_make_fixture_snapshot())}
        result = await tools["read_tree_nodes"].execute({"ids": ["200"], "statsOffset": 0, "statsLimit": 2})
        self.assertEqual(len(result["nodes"][0]["stats"]), 2)
        self.assertFalse(result["nodes"][0]["statsComplete"])
        self.assertEqual(result["nodes"][0]["nextStatsOffset"], 2)
        self.assertEqual(result["nodes"][0]["statsTotal"], 3)

    async def test_read_tree_nodes_too_many_ids(self):
        tools = {t.name: t for t in register_tree_tools(_make_fixture_snapshot())}
        with self.assertRaises(AgentError) as ctx:
            tools["read_tree_nodes"].validate({"ids": ["100", "200", "300", "400"]})
        self.assertEqual(ctx.exception.code, "INVALID_TOOL_ARGUMENTS")

    async def test_search_exact_id(self):
        tools = {t.name: t for t in register_tree_tools(_make_fixture_snapshot())}
        result = await tools["search_tree_nodes"].execute({"query": "200"})
        self.assertEqual(result["matchType"], "exact_id")
        self.assertEqual(result["matches"][0]["name"], "Notable Power")

    async def test_search_by_name_prefix(self):
        tools = {t.name: t for t in register_tree_tools(_make_fixture_snapshot())}
        result = await tools["search_tree_nodes"].execute({"query": "Notable"})
        self.assertGreaterEqual(result["totalMatches"], 1)

    async def test_search_by_stat_text(self):
        tools = {t.name: t for t in register_tree_tools(_make_fixture_snapshot())}
        result = await tools["search_tree_nodes"].execute({"query": "converted to Fire"})
        self.assertIn("Keystone End", [m["name"] for m in result["matches"]])

    async def test_search_paginates_more_than_sixteen_matches_without_silent_loss(self):
        snap = _make_fixture_snapshot()
        extra = {str(1000 + i): {"id": str(1000 + i), "name": f"火焰节点 {i}",
                 "stats": ["火焰伤害提高 5%"], "kind": "small", "isGeneralEligible": True}
                 for i in range(20)}
        nodes = {**snap.nodes, **extra}
        adjacency = {**snap.adjacency, **{node_id: [] for node_id in extra}}
        paged = TreeSnapshot(snapshot_id=snap.snapshot_id, node_count=len(nodes), nodes=nodes,
                             adjacency=adjacency, build=snap.build, _path_index=snap._path_index)
        tool = {t.name: t for t in register_tree_tools(paged)}["search_tree_nodes"]
        first = await tool.execute({"query": "火焰", "offset": 0})
        second = await tool.execute({"query": "火焰", "offset": first["nextOffset"]})
        self.assertEqual(first["totalMatches"], 20)
        self.assertEqual(len(first["matches"]), 16)
        self.assertEqual(len(second["matches"]), 4)
        self.assertNotIn("nextOffset", second)

    async def test_neighborhood_bounded(self):
        tools = {t.name: t for t in register_tree_tools(_make_fixture_snapshot())}
        result = await tools["read_tree_neighborhood"].execute({"nodeId": "100", "maxHops": 2, "maxNodes": 20})
        self.assertEqual(result["center"]["name"], "Strength")
        self.assertIn("hop1", result)
        self.assertEqual(result["hop1"]["nodeIds"], ["200"])

    async def test_neighborhood_missing_node(self):
        tools = {t.name: t for t in register_tree_tools(_make_fixture_snapshot())}
        with self.assertRaises(AgentError) as ctx:
            tools["read_tree_neighborhood"].validate({"nodeId": "99999"})
        self.assertEqual(ctx.exception.code, "NODE_NOT_FOUND")

    async def test_path_simple_general(self):
        tools = {t.name: t for t in register_tree_tools(_make_fixture_snapshot())}
        result = await tools["find_tree_path"].execute({"targetId": "400", "category": "general"})
        self.assertTrue(result["reachable"])
        self.assertEqual([n["id"] for n in result["path"]], ["100", "200", "300", "400"])
        self.assertEqual(result["edgeDistance"], 3)
        self.assertEqual(result["nearestAllocatedId"], "100")

    async def test_path_unreachable(self):
        tools = {t.name: t for t in register_tree_tools(_make_fixture_snapshot())}
        result = await tools["find_tree_path"].execute({"targetId": "500", "category": "general"})
        self.assertFalse(result["reachable"])

    async def test_path_missing_target(self):
        tools = {t.name: t for t in register_tree_tools(_make_fixture_snapshot())}
        with self.assertRaises(AgentError) as ctx:
            tools["find_tree_path"].validate({"targetId": "99999", "category": "general"})
        self.assertEqual(ctx.exception.code, "NODE_NOT_FOUND")

    async def test_path_from_explicit_start(self):
        tools = {t.name: t for t in register_tree_tools(_make_fixture_snapshot())}
        result = await tools["find_tree_path"].execute({"targetId": "300", "category": "general", "startId": "100"})
        self.assertTrue(result["reachable"])
        self.assertEqual([node["id"] for node in result["path"]], ["100", "200", "300"])
        self.assertEqual(result["edgeDistance"], 2)

    async def test_tree_overview(self):
        tools = {t.name: t for t in register_tree_tools(_make_fixture_snapshot())}
        result = await tools["tree_overview"].execute({})
        self.assertEqual(result["build"]["class"]["base"], "Warrior")
        self.assertEqual(result["build"]["allocations"]["normal"]["count"], 1)
        self.assertEqual(result["build"]["budgets"]["passive"]["used"], 1)

    async def test_unknown_id_is_missing_not_crashed(self):
        tools = {t.name: t for t in register_tree_tools(_make_fixture_snapshot())}
        result = await tools["read_tree_nodes"].execute({"ids": ["99999999", "88888888"]})
        self.assertEqual(len(result["nodes"]), 0)
        self.assertEqual(len(result["missing"]), 2)

    async def test_build_state_unchanged_after_tool_execution(self):
        snap = _make_fixture_snapshot()
        build_before = copy.deepcopy(snap.build)
        tools = {t.name: t for t in register_tree_tools(snap)}
        for tool in tools.values():
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
        self.assertEqual(build_before, snap.build)

    async def test_all_stats_paginated_no_silent_truncation(self):
        snap = _make_fixture_snapshot()
        n200 = snap.node("200")
        ext = list(n200["stats"]) + [f"stat line {i}" for i in range(3, 40)]
        n200_ext = {**n200, "stats": ext}
        nodes = {**snap.nodes, "200": n200_ext}
        snap2 = TreeSnapshot(snapshot_id=snap.snapshot_id, node_count=snap.node_count,
                             nodes=nodes, adjacency=snap.adjacency, build=snap.build,
                             _path_index=snap._path_index)
        tools = {t.name: t for t in register_tree_tools(snap2)}
        # First page
        r1 = await tools["read_tree_nodes"].execute({"ids": ["200"], "statsOffset": 0, "statsLimit": 8})
        self.assertEqual(len(r1["nodes"][0]["stats"]), 8)
        self.assertFalse(r1["nodes"][0]["statsComplete"])
        self.assertEqual(r1["nodes"][0]["nextStatsOffset"], 8)
        self.assertEqual(r1["nodes"][0]["statsTotal"], len(ext))
        # Last page
        r2 = await tools["read_tree_nodes"].execute({"ids": ["200"], "statsOffset": 32, "statsLimit": 8})
        self.assertTrue(r2["nodes"][0]["statsComplete"])


if __name__ == "__main__":
    unittest.main()
