import json
import sqlite3
import unittest
from python_agent.cluster_summary import ClusterSummaryHook
from python_agent.core import ModelReply
from python_agent.tree_tools import TreeSnapshot, TreeOverviewTool


class SummaryTests(unittest.IsolatedAsyncioTestCase):
    async def test_complete_graph_survives_runtime_result_limit(self):
        from python_agent.core import AgentRunner, ToolRegistry, ToolCall
        ids=list(map(str,range(60)))
        snap=TreeSnapshot(build={"allocations":{"normal":ids}},semantic_topology={
            "clusters":[{"id":n,"type":"passive","nodeIds":[n],"edges":[]} for n in ids],
            "nodeToCluster":{n:n for n in ids},"clusterEdges":[],"excludedAscendancyNodeIds":[]})
        registry=ToolRegistry()
        registry.register(TreeOverviewTool(snap))
        runner=AgentRunner(None,registry)
        output=await runner._tools_step({"messages":[],"trace":[],"calls":[ToolCall("c","tree_overview","{}")],"tool_count":0})
        wire=output["messages"][0]["content"]
        self.assertGreater(len(wire),8000)
        self.assertTrue(output["trace"][0]["ok"])
        self.assertEqual(len(json.loads(wire)["semanticTopology"]["items"]),60)

    async def test_complete_named_graph_ignores_legacy_paging_and_uses_cache(self):
        class Provider:
            base_url = "fixture"
            calls = 0
            async def complete(self, **args):
                self.calls += 1
                evidence=json.loads(args["messages"][1]["content"])
                return ModelReply(json.dumps({c["id"]:{"name":"护甲天赋簇","summary":"主要提供护甲"} for c in evidence}))
        ids=list(map(str,range(25)))
        snapshot=TreeSnapshot(nodes={n:{"id":n,"stats":["10% increased Armour"]} for n in ids},
            build={"allocations":{"normal":ids}},
            semantic_topology={"clusters":[{"id":n,"type":"passive","nodeIds":[n],"edges":[]} for n in ids],
                "nodeToCluster":{n:n for n in ids},"clusterEdges":[{"source":str(i),"target":str(i+1),"physicalEdges":[[str(i),str(i+1)]]} for i in range(24)],"excludedAscendancyNodeIds":[]})
        provider=Provider()
        tool=TreeOverviewTool(snapshot)
        tool.before_hook=ClusterSummaryHook(provider,"fixture",snapshot,{})
        first=await tool.execute({"limit":20})
        calls=provider.calls
        self.assertEqual(first["semanticTopology"]["summaryCache"]["generated"],25)
        second=await tool.execute({"offset":20})
        self.assertEqual(provider.calls,calls)
        self.assertEqual(second["semanticTopology"]["summaryCache"]["cached"],25)
        self.assertEqual(len(second["semanticTopology"]["items"]),25)
        self.assertEqual(len(first["semanticTopology"]["items"]),25)
        self.assertTrue(first["semanticTopology"]["complete"])
        self.assertIsNone(first["semanticTopology"]["nextOffset"])
        self.assertEqual(len(first["semanticTopology"]["clusterEdges"]),24)
        self.assertEqual(first["semanticTopology"]["clusterEdges"][0]["sourceName"],"护甲天赋簇")
        self.assertTrue(all(c["summarySource"]=="model_cache" for c in second["semanticTopology"]["items"]))

    async def test_hook_summary_cache_and_build_independence(self):
        class Provider:
            base_url = "fixture"
            calls = 0
            async def complete(self, **args):
                self.calls += 1
                assert args["tools"] == []
                assert len(args["messages"]) == 2
                return ModelReply('```json\n{"p":{"name":"能量护盾天赋簇","summary":"主要提供能量护盾上限"}}\n```')
        provider = Provider()
        db = sqlite3.connect(":memory:")
        snap = TreeSnapshot(nodes={"1":{"id":"1","name":"Shield","stats":["20% increased maximum Energy Shield"]}})
        clusters = [{"id":"p","type":"passive","nodeIds":["1"]},
                    {"id":"a","type":"attribute","nodeIds":["2","3"]},
                    {"id":"j","type":"jewel","nodeIds":["4"]}]
        hook = ClusterSummaryHook(provider,"fixture",snap,{},db)
        result = await hook(clusters)
        self.assertEqual(result["p"]["summary"],"主要提供能量护盾上限")
        self.assertEqual(result["a"]["summary"],"属性簇：2个属性节点")
        self.assertEqual(result["j"]["summary"],"珠宝孔")
        snap.build = {"allocations":{"normal":["1"]}}
        restarted = ClusterSummaryHook(provider,"fixture",snap,{},db)
        self.assertEqual((await restarted(clusters))["p"]["summarySource"],"model_cache")
        self.assertEqual(provider.calls,1)
        snap.nodes["1"]["stats"] = ["10% increased Armour"]
        await restarted(clusters)
        self.assertEqual(provider.calls,2)
        db.close()

    async def test_failure_is_explicit_and_not_cached(self):
        class Provider:
            async def complete(self, **args):
                raise ValueError("fixture failure")
        hook = ClusterSummaryHook(Provider(),"fixture",TreeSnapshot(nodes={"1":{"id":"1","stats":[]}}),{})
        result = await hook([{"id":"p","type":"passive","nodeIds":["1"]}])
        self.assertEqual(result["p"]["summarySource"],"unavailable")
        self.assertEqual(hook.cache,{})

    async def test_overview_hook_only_sees_touched_clusters_and_removes_highlights(self):
        snap = TreeSnapshot(nodes={"1":{"id":"1"}},build={"allocations":{"normal":["1"]},"highlights":[{"id":"1"}]},
            semantic_topology={"clusters":[{"id":"p","type":"passive","nodeIds":["1"],"edges":[]},
                {"id":"other","type":"passive","nodeIds":["2"],"edges":[]}],
                "nodeToCluster":{"1":"p","2":"other"},"clusterEdges":[],"excludedAscendancyNodeIds":[]})
        tool = TreeOverviewTool(snap)
        async def hook(clusters):
            self.assertEqual([c["id"] for c in clusters],["p"])
            return {"p":{"name":"护甲天赋簇","summary":"主要提供护甲","summarySource":"model"}}
        tool.before_hook = hook
        result = await tool.execute({})
        self.assertNotIn("highlight",json.dumps(result))
        self.assertEqual(result["semanticTopology"]["items"][0]["summary"],"主要提供护甲")
