"""Offline RAG invariants; live semantic accuracy is a separate opt-in check."""
import json
import tempfile
import unittest
from pathlib import Path
from python_agent.core import AgentError
from python_agent.rag import RagIndex, RagTool, RetrievalProvider, unit
from python_agent.memory import MemoryStore, MemorySession


class FakeProvider:
    fingerprint = "fixture-model"
    dimensions = 2

    def __init__(self):
        self.calls = 0
        self.fail = False

    async def embed(self, texts):
        self.calls += 1
        if self.fail: raise AgentError("FIXTURE_FAILURE", "simulated")
        return [unit([1, 1 if "shield" in text else -1], 2) for text in texts]

    async def rerank(self, query, texts):
        return sorted([{"index":i,"relevance_score":1 if "shield" in text else 0} for i,text in enumerate(texts)], key=lambda r:r["relevance_score"], reverse=True)


class RagTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.provider = FakeProvider()
        self.index = RagIndex(str(Path(self.temp.name)/"rag.db"),self.provider)
        self.corpus = {"version":"v1","nodes":[
            {"id":"901","name":"fixture shield","text":"shield recovery","stats":[{"text":"shield recovery; cannot recharge"}]},
            {"id":"902","name":"fixture fire","text":"fire damage","stats":[]}]}

    async def asyncTearDown(self):
        self.index.db.close()
        self.temp.cleanup()

    async def test_search_read_and_cache(self):
        await self.index.build(self.corpus)
        count=self.provider.calls
        await self.index.build(self.corpus)
        self.assertEqual(self.provider.calls,count)
        result=await RagTool(self.index,"search_passive_nodes").execute({"query":"shield"})
        self.assertEqual(result["matches"][0]["id"],"901")
        self.assertNotIn("stats",result["matches"][0])
        self.assertFalse(result["complete_listing"])
        read=await RagTool(self.index,"read_passive_nodes").execute({"ids":["901","999"]})
        self.assertIn("cannot recharge",read["nodes"][0]["stats"][0]["text"])
        self.assertEqual(read["missing"],["999"])

    async def test_failed_build_preserves_published_index(self):
        await self.index.build(self.corpus)
        self.provider.fail=True
        with self.assertRaises(AgentError): await self.index.build({"version":"v2","nodes":[{"id":"903","text":"new text"}]})
        self.assertEqual(self.index.status()["version"],"v1")
        self.assertEqual(len(self.index.records()),2)

    async def test_changed_model_and_source_are_not_ready(self):
        await self.index.build(self.corpus)
        self.provider.fingerprint="new-model"
        with self.assertRaises(AgentError):self.index.records()
        self.provider.fingerprint="fixture-model"
        self.index.source_version="new-source"
        self.assertFalse(self.index.status()["ready"])

    async def test_memory_scoped_to_completed_current_conversation(self):
        store=MemoryStore(":memory:")
        try:
            first=store.activate("https://one.example")
            second=store.activate("https://one.example",new=True)
            for conversation,text in [(first,"shield recovery"),(second,"private other conversation")]:
                store.commit(conversation,1,[{"role":"user","content":text},{"role":"assistant","content":"noted"}],store.notebook(conversation))
            tool=RagTool(self.index,"search_memory_semantic",MemorySession(store,first))
            result=await tool.execute({"query":"shield"})
            self.assertEqual(result["total"],1)
            self.assertNotIn("private",json.dumps(result))
            self.assertTrue(result["metadata_only"])
        finally:store.db.close()

    async def test_schema_and_vectors_fail_closed(self):
        for vector in [[0,0],[1],[True,1],[float("nan"),1]]:
            with self.assertRaises(AgentError):unit(vector,2)
        tool=RagTool(self.index,"read_passive_nodes")
        for args in [{"ids":["1;DROP"]},{"ids":[]},{"ids":["1"],"query":"x"}]:
            with self.assertRaises(AgentError):tool.validate(args)

    async def test_malformed_provider_results_fail_closed(self):
        profile = {"baseUrl":"http://127.0.0.1", "model":"fixture", "dimensions":2, "apiKey":"fixture"}
        provider = RetrievalProvider({"embedding":profile, "reranker":profile})
        self.assertEqual(provider.embed_http.accept, "application/json")
        self.assertEqual(provider.rank_http.accept, "application/json")
        class Response:
            def __init__(self, payload): self.payload = payload
            async def _request(self, *_): return self.payload
        for rows in [[{"index":False,"embedding":[1,0]}], [{"index":"0","embedding":[1,0]}], []]:
            provider.embed_http = Response({"data":rows})
            with self.assertRaises(AgentError): await provider.embed(["fixture"])
        for payload in [None, [], {"output":None}, {"results":[{"index":0,"relevance_score":float("nan")}]},
                        {"results":[{"index":False,"relevance_score":1}]}]:
            provider.rank_http = Response(payload)
            with self.assertRaises(AgentError): await provider.rerank("query", ["fixture"])

    async def test_duplicate_passives_do_not_crowd_distinct_mechanics_out(self):
        nodes = [{"id":str(i),"text":"shield generic","stats":[]} for i in range(120)]
        nodes.append({"id":"9001","text":"shield specific mechanic","stats":[]})
        async def rank(query, texts):
            return sorted([{"index":i,"relevance_score":1 if "specific" in text else 0} for i,text in enumerate(texts)],key=lambda r:r["relevance_score"],reverse=True)
        self.provider.rerank = rank
        await self.index.build({"version":"duplicates","nodes":nodes})
        result = await RagTool(self.index,"search_passive_nodes").execute({"query":"shield"})
        self.assertEqual(result["candidate_count"],2)
        self.assertEqual(result["matches"][0]["id"],"9001")
        repeated = result["matches"][1]
        self.assertEqual(repeated["equivalent_count"],120)
        self.assertFalse(repeated["equivalent_ids_complete"])
        self.assertEqual(len(repeated["equivalent_ids"]),20)


if __name__ == "__main__":unittest.main()
