"""Bounded read-only tree tools — snapshot, tool registration and error paths."""

import copy
import json
import unittest


class WriteRefreshTests(unittest.IsolatedAsyncioTestCase):
    async def test_cluster_refund_metadata_only_in_cluster_node_details(self):
        snap=_make_fixture_snapshot()
        snap.semantic_topology={"version":"v1","clusters":[{"id":"p","type":"passive","nodeIds":["100","200"],"edges":[["100","200"]]}],
            "nodeToCluster":{"100":"p","200":"p"},"clusterEdges":[],"unclassifiedNodes":[],"excludedAscendancyNodeIds":["600"]}
        snap.refund_impacts={"100":[{"category":"general","applicable":True,"refundable":True,
            "cascadeNodeIds":["300","400"],"additionalRefundCount":2,"totalRefundCount":3,"complete":True}],
            "600":[{"category":"ascendancy","applicable":True,"refundable":False,"errorCode":"START_NODE_PROTECTED"}]}
        before=copy.deepcopy(snap.__dict__)
        tools={t.name:t for t in register_tree_tools(snap)}
        result=await tools["read_tree_cluster"].execute({"nodeId":"100"})
        self.assertEqual(result["refundImpacts"]["100"]["snapshotId"],snap.snapshot_id)
        self.assertEqual(result["refundImpacts"]["100"]["categories"][0]["cascadeNodeIds"],["300","400"])
        self.assertEqual(result["refundImpacts"]["200"]["reason"],"not-allocated")
        asc=await tools["read_tree_cluster"].execute({"nodeId":"600"})
        self.assertFalse(asc["refundImpacts"]["600"]["categories"][0]["refundable"])
        for name,args in (("tree_overview",{}),("read_tree_nodes",{"ids":["100"]}),
                          ("search_tree_nodes",{"query":"100"}),("read_tree_cluster",{"nodeId":"100","section":"edges"})):
            self.assertNotIn("refundImpacts",await tools[name].execute(args))
        self.assertEqual(snap.__dict__,before)

    async def test_cluster_refund_pages_keep_whole_cascade_lists(self):
        ids=[str(i) for i in range(20)]
        snap=TreeSnapshot(snapshot_id="refund-fixture",build={"allocations":{"normal":ids}},semantic_topology={
            "version":"v1","clusters":[{"id":"p","type":"passive","nodeIds":ids,"edges":[]}],
            "nodeToCluster":{i:"p" for i in ids},"clusterEdges":[],"unclassifiedNodes":[],"excludedAscendancyNodeIds":[]})
        cascades=[str(i) for i in range(100,200)]
        snap.refund_impacts={i:[{"category":"general","refundable":True,"cascadeNodeIds":cascades,
            "additionalRefundCount":100,"totalRefundCount":101,"complete":True}] for i in ids}
        tool=register_tree_tools(snap)[-1]
        self.assertEqual(tool.name,"read_tree_cluster")
        found=[];offset=0
        while offset is not None:
            page=await tool.execute({"clusterId":"p","offset":offset})
            self.assertLessEqual(len(json.dumps(page,ensure_ascii=False,separators=(",",":"))),7500)
            found+=page["items"]
            for v in page["refundImpacts"].values():self.assertEqual(v["categories"][0]["cascadeNodeIds"],cascades)
            offset=page["nextOffset"]
        self.assertEqual(found,ids)
        snap.refund_impacts["0"][0]["cascadeNodeIds"]=["long-id-"+str(i) for i in range(1000)]
        with self.assertRaises(AgentError) as ctx:await tool.execute({"clusterId":"p","limit":1})
        self.assertEqual(ctx.exception.code,"REFUND_PREVIEW_TOO_LARGE")

    async def test_overview_budgets_and_degraded_snapshot_without_allocation_directory(self):
        snap=TreeSnapshot(build={"allocations":{"normal":[str(i) for i in range(65)]},
            "budgets":{"passive":123,"weaponSet":24,"ascendancy":8},
            "budgetUsage":{"normal":104,"weaponSet1":16,"weaponSet2":25,"ascendancy":9}})
        tools={t.name:t for t in register_tree_tools(snap)}
        self.assertTrue({"tree_summary","build_summary","list_tree_clusters"}.isdisjoint(tools))
        for error in (None,"fixture projection failure"):
            snap._error=error
            result=await tools["tree_overview"].execute({})
            self.assertNotIn("allocationsPage",result)
            self.assertNotIn("allocatedIds",result["build"]["detailTools"])
            self.assertEqual(result["build"]["allocations"]["normal"]["count"],65)
            self.assertNotIn("ids",result["build"]["allocations"]["normal"])
            with self.assertRaises(AgentError) as rejected:
                await tools["tree_overview"].execute({"section":"allocations","offset":60})
            self.assertEqual(rejected.exception.code,"INVALID_TOOL_ARGUMENTS")
            budgets=result["build"]["budgets"]
            self.assertEqual(budgets["passive"]["remaining"],19)
            self.assertEqual(budgets["ascendancy"]["overBudget"],1)
            self.assertEqual(budgets["weaponSet"]["weaponSet1Remaining"],8)
            self.assertEqual(budgets["weaponSet"]["weaponSet2OverBudget"],1)
            with self.assertRaises(AgentError):
                await tools["tree_overview"].execute({"limit":21})

    async def test_overview_removed_section_rejected_by_schema_parser_and_runner(self):
        from python_agent.core import AgentRunner, ToolCall, ToolRegistry
        from python_agent.prompts import DEFAULTS
        tool=register_tree_tools(TreeSnapshot())[0]
        self.assertEqual(tool.parameters["properties"]["section"]["enum"],["clusters","boundaries"])
        for section in ("allocations","nodes","edges"):
            with self.assertRaises(AgentError) as rejected:
                tool.parse_arguments(json.dumps({"section":section}))
            self.assertEqual(rejected.exception.code,"INVALID_TOOL_ARGUMENTS")
        runner=AgentRunner(None,ToolRegistry([tool]))
        result,ok=await runner._execute_tool(ToolCall("old","tree_overview",'{"section":"allocations"}'))
        self.assertFalse(ok)
        self.assertEqual(result["error"]["code"],"INVALID_TOOL_ARGUMENTS")
        for name,text in DEFAULTS:
            self.assertNotIn("allocations",text,name)

    async def test_overview_complete_clusters_hook_and_boundary_paging_unchanged(self):
        ids=[str(i) for i in range(25)]
        clusters=[{"id":"p:"+n,"type":"passive","nodeIds":[n],"edges":[]} for n in ids]
        edges=[{"source":"p:0","target":"p:"+n,"physicalEdges":[["0",n]]} for n in ids[1:]]
        # A real boundary can have an unallocated endpoint inside a touched cluster.
        clusters[-1]["nodeIds"].append("unallocated")
        edges[-1]["physicalEdges"]=[["0","unallocated"]]
        snap=TreeSnapshot(build={"allocations":{"normal":ids}},semantic_topology={
            "clusters":clusters,"clusterEdges":edges,"nodeToCluster":{n:"p:"+n for n in ids},
            "excludedAscendancyNodeIds":[]})
        before=copy.deepcopy(snap.build)
        tool=register_tree_tools(snap)[0]
        calls=[]
        async def hook(touched):
            calls.append([c["id"] for c in touched])
            return {c["id"]:{"name":"fixture "+c["id"],"summary":"fixture summary","summarySource":"model_cache"} for c in touched}
        tool.before_hook=hook
        for args in ({},{"section":"clusters","offset":20,"limit":1}):
            result=await tool.execute(args)
            graph=result["semanticTopology"]
            self.assertEqual(len(graph["items"]),25)
            self.assertEqual(len(graph["clusterEdges"]),24)
            self.assertTrue(graph["complete"])
            self.assertIsNone(graph["nextOffset"])
            self.assertEqual(graph["items"][0]["summary"],"fixture summary")
            self.assertEqual(graph["clusterEdges"][0]["sourceName"],"fixture p:0")
            self.assertNotIn("allocationsPage",result)
        pages=[(await tool.execute({"section":"boundaries","offset":offset}))["semanticTopology"] for offset in (0,20)]
        self.assertEqual([len(p["items"]) for p in pages],[20,4])
        self.assertEqual([p["nextOffset"] for p in pages],[20,None])
        self.assertEqual([p["total"] for p in pages],[24,24])
        self.assertTrue(pages[0]["items"][0]["bothEndpointsAllocated"])
        self.assertFalse(pages[1]["items"][-1]["bothEndpointsAllocated"])
        self.assertEqual(pages[1]["items"][-1]["physicalEdge"],["0","unallocated"])
        self.assertEqual(calls,[[c["id"] for c in clusters]]*2)
        with self.assertRaises(AgentError):
            await tool.execute({"section":"allocations"})
        self.assertEqual(len(calls),2)
        self.assertEqual(snap.build,before)

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
        snap=TreeSnapshot(snapshot_id="old",nodes={"100":{"id":"100"}},build={"budgetUsage":{"normal":9}},refund_impacts={"100":[{"category":"general"}]})
        async def callback(*args):
            return {"success":True,"refreshError":True}
        tools={t.name:t for t in register_tree_tools(snap,callback)}
        result=await tools["allocate_tree_node"].execute({"nodeId":"100"})
        self.assertTrue(result["success"])
        self.assertTrue(result["refreshError"])
        self.assertEqual(snap.build,{})
        self.assertTrue(snap._error)
        self.assertEqual(snap.refund_impacts,{})

    async def test_write_refreshes_shared_snapshot_without_exposing_full_catalog(self):
        from python_agent.tree_tools import TreeSnapshot, register_tree_tools
        snap = TreeSnapshot(snapshot_id="before", nodes={"100": {"id":"100"}})
        async def callback(method, args):
            return {"success": True, "snapshot": {"snapshotId":"after", "nodeCount":1,
                "nodes":[{"id":"100"}], "build":{"budgetUsage":{"normal":1}},
                "adjacency":{}, "_pathIndex":{"generalParent":{"100":None}},"refundImpacts":{"100":[{"category":"general","refundable":False}]}}}
        tools = {t.name:t for t in register_tree_tools(snap, callback)}
        result = await tools["allocate_tree_node"].execute({"nodeId":"100"})
        self.assertNotIn("snapshot", result)
        self.assertEqual(result["snapshotId"], "after")
        self.assertEqual(snap.build["budgetUsage"]["normal"], 1)
        self.assertEqual(tools["tree_overview"]._snapshot.snapshot_id,"after")
        self.assertEqual(tools["find_tree_path"]._snapshot._path_index["generalParent"],{"100":None})
        self.assertEqual(snap.refund_impacts,{"100":[{"category":"general","refundable":False}]})

    async def test_refund_snapshot_rpc_preserves_preview_data(self):
        from python_agent.rpc_server import dispatch
        class Service:
            _active_generation=None
        service=Service()
        impacts={"1":[{"category":"weaponSet1","refundable":True,"cascadeNodeIds":["2"]}]}
        await dispatch(service,"tree_snapshot",{"snapshot":{"nodes":[],"refundImpacts":impacts}})
        self.assertEqual(service.tree_snapshot.refund_impacts,impacts)

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
