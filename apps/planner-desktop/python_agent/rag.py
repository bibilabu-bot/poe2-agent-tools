"""Read-only retrieval over versioned passive records and completed conversation turns.

Only embedding vectors and source records persist. Provider secrets remain in memory.
"""
from __future__ import annotations

import hashlib
import json
import math
import sqlite3
from pathlib import Path
from typing import Any, Mapping

from .core import AgentError, BaseTool
from .prompts import TOOL_DESCRIPTIONS
from .provider import OpenAICompatibleProvider
from .retrieval_retry import request_with_retry


def encode(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def digest(value: Any) -> str:
    return hashlib.sha256(encode(value).encode("utf-8")).hexdigest()


def unit(vector: Any, dimensions: int) -> list[float]:
    if not isinstance(vector, list) or len(vector) != dimensions or any(
        type(v) not in (int, float) or not math.isfinite(v) for v in vector
    ):
        raise AgentError("RAG_VECTOR", "向量响应格式或维度不匹配")
    norm = math.sqrt(sum(v*v for v in vector))
    if not math.isfinite(norm) or norm == 0:
        raise AgentError("RAG_VECTOR", "向量响应无效")
    return [v / norm for v in vector]


class RetrievalProvider:
    def __init__(self, profiles: dict[str, Any]) -> None:
        self.embedding = profiles["embedding"]
        self.reranker = profiles["reranker"]
        self.dimensions = self.embedding["dimensions"]
        self.fingerprint = digest([self.embedding["baseUrl"], self.embedding["model"], self.dimensions, "node-text-v1"])
        self.embed_http = OpenAICompatibleProvider(self.embedding["baseUrl"], self.embedding["apiKey"], timeout=30, accept="application/json")
        self.rank_http = OpenAICompatibleProvider(self.reranker["baseUrl"], self.reranker["apiKey"], timeout=30, accept="application/json")

    async def embed(self, texts: list[str]) -> list[list[float]]:
        body = {"model":self.embedding["model"], "input":texts, "encoding_format":"float"}
        if self.embedding["model"] not in {"text-embedding-v1", "text-embedding-v2"}:
            body["dimensions"] = self.dimensions
        data = await request_with_retry(self.embed_http, "/embeddings", body, "embedding")
        rows = data.get("data") if isinstance(data, dict) else None
        if not isinstance(rows, list) or len(rows) != len(texts) or any(not isinstance(r, dict) for r in rows):
            raise AgentError("RAG_VECTOR", "向量响应数量不匹配")
        if any(type(r.get("index")) is not int for r in rows) or sorted(r["index"] for r in rows) != list(range(len(texts))):
            raise AgentError("RAG_VECTOR", "向量响应索引不匹配")
        return [unit(r.get("embedding"), self.dimensions) for r in sorted(rows,key=lambda r:r["index"])]

    async def rerank(self, query: str, texts: list[str]) -> list[dict[str, Any]]:
        native = self.reranker["baseUrl"].endswith("/text-rerank")
        if native and self.reranker["model"] == "qwen3-rerank":
            raise AgentError("RAG_ENDPOINT", "qwen3-rerank 需配置 compatible-api/v1/reranks 完整地址")
        body = {"model":self.reranker["model"]}
        values = {"query":query,"documents":texts}
        body.update({"input":values,"parameters":{"top_n":len(texts)}} if native else {**values,"top_n":len(texts)})
        data = await request_with_retry(self.rank_http, "", body, "rerank")
        if isinstance(data, dict) and data.get("code"):
            # Provider bodies can echo credentials or input; keep errors generic.
            raise AgentError("RAG_RERANK", "重排序服务报告业务错误，请检查模型与连接配置")
        output = data.get("output") if isinstance(data, dict) else None
        rows = data.get("results") if isinstance(data, dict) else None
        if rows is None and isinstance(output, dict):
            rows = output.get("results")
        if not isinstance(rows,list) or len(rows) != len(texts):
            actual = len(rows) if isinstance(rows, list) else "无结果列表"
            shape = ",".join(k for k in ["results","output","data","choices","error","message","code"] if isinstance(data,dict) and k in data)
            raise AgentError("RAG_RERANK", f"重排序响应数量不匹配：期望 {len(texts)}，实际 {actual}；结构 {shape}")
        if any(not isinstance(r,dict) or type(r.get("index")) is not int or
               type(r.get("relevance_score")) not in (float,int) or not math.isfinite(r["relevance_score"]) for r in rows):
            raise AgentError("RAG_RERANK", "重排序响应格式无效")
        if sorted(r["index"] for r in rows) != list(range(len(texts))):
            raise AgentError("RAG_RERANK", "重排序响应索引不匹配")
        return sorted(rows,key=lambda r:r["relevance_score"],reverse=True)


class RagIndex:
    def __init__(self, filename: str, provider: RetrievalProvider, source_version: str = "") -> None:
        Path(filename).parent.mkdir(parents=True,exist_ok=True)
        self.db = sqlite3.connect(filename)
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.executescript("""
            CREATE TABLE IF NOT EXISTS vectors (profile TEXT, hash TEXT, vector TEXT NOT NULL, PRIMARY KEY(profile,hash));
            CREATE TABLE IF NOT EXISTS nodes (id TEXT PRIMARY KEY, record TEXT NOT NULL, hash TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY,value TEXT NOT NULL);
        """)
        self.provider = provider
        self.source_version = source_version

    def status(self) -> dict[str, Any]:
        meta = dict(self.db.execute("SELECT key,value FROM meta"))
        return {"ready":meta.get("profile") == self.provider.fingerprint and meta.get("source", "") == self.source_version,
                "version":meta.get("version"),"count":self.db.execute("SELECT count(*) FROM nodes").fetchone()[0]}

    async def vectors(self, texts: list[str], progress=None) -> dict[str,list[float]]:
        unique = {digest(text):text for text in texts}
        cached = {h:json.loads(v) for h,v in self.db.execute("SELECT hash,vector FROM vectors WHERE profile=?",(self.provider.fingerprint,)) if h in unique}
        missing = [(h,t) for h,t in unique.items() if h not in cached]
        if progress: progress(len(cached),len(unique))
        # Small batches keep request/response bounds predictable and allow resumable work.
        for start in range(0,len(missing),10):
            batch = missing[start:start+10]
            values = await self.provider.embed([t for _,t in batch])
            if len(values) != len(batch): raise AgentError("RAG_VECTOR","向量响应数量不匹配")
            with self.db:
                for (h,_),vector in zip(batch,values):
                    cached[h] = vector
                    self.db.execute("INSERT OR REPLACE INTO vectors VALUES (?,?,?)",(self.provider.fingerprint,h,encode(vector)))
            if progress: progress(len(cached),len(unique))
        return cached

    async def build(self, corpus: dict[str,Any], progress=None) -> dict[str,Any]:
        nodes = corpus["nodes"]
        if not nodes or len(nodes)>20000 or len({n["id"] for n in nodes}) != len(nodes):
            raise AgentError("RAG_CORPUS","天赋资料无效")
        await self.vectors([n["text"] for n in nodes],progress)
        # Atomic publication: cancelled/failed builds leave the previous index intact.
        with self.db:
            self.db.execute("DELETE FROM nodes")
            self.db.executemany("INSERT INTO nodes VALUES (?,?,?)",[(n["id"],encode(n),digest(n["text"])) for n in nodes])
            self.db.executemany("INSERT OR REPLACE INTO meta VALUES (?,?)",[("version",corpus["version"]),("profile",self.provider.fingerprint),("source",self.source_version)])
        return self.status()

    async def search(self, query: str, records: list[dict[str,Any]], limit: int=5) -> dict[str,Any]:
        if not records: return {"matches":[],"candidate_count":0,"total":0}
        vectors = await self.vectors([r["text"] for r in records])
        query_vector = (await self.provider.embed([query]))[0]
        ranked = sorted(((sum(a*b for a,b in zip(query_vector,vectors[digest(r["text"])])),r) for r in records), key=lambda x:x[0],reverse=True)
        # Repeated small passives must not crowd distinct mechanics out of recall.
        groups: dict[str, list[dict[str, Any]]] = {}
        candidates = []
        for similarity, record in ranked:
            key = digest(record["text"])
            if key not in groups and len(candidates) < 100:
                candidates.append((similarity, record))
            groups.setdefault(key, []).append(record)
        reranked = await self.provider.rerank(query,[r["text"] for _,r in candidates])
        matches = []
        for item in reranked[:limit]:
            similarity, record = candidates[item["index"]]
            match = {**{k:v for k,v in record.items() if k not in {"text","stats","neighbors"}},
                     "similarity":round(similarity,6),"rerank_score":round(item["relevance_score"],6)}
            if "id" in record:
                ids = [r["id"] for r in groups[digest(record["text"])]]
                match.update(equivalent_ids=ids[:20], equivalent_count=len(ids), equivalent_ids_complete=len(ids)<=20)
            matches.append(match)
        return {"matches":matches,"candidate_count":len(candidates),"total":len(records),
                "pipeline":"embedding → cosine top100 distinct texts → reranker", "complete_listing":False}

    def records(self) -> list[dict[str,Any]]:
        if not self.status()["ready"]: raise AgentError("RAG_NOT_READY","请在设置页构建与当前向量模型匹配的天赋索引")
        return [json.loads(row[0]) for row in self.db.execute("SELECT record FROM nodes ORDER BY id")]


class RagTool(BaseTool):
    def __init__(self, index: RagIndex, name: str, memory=None, tree_snapshot=None) -> None:
        self.index, self.name, self.memory, self.tree_snapshot = index,name,memory,tree_snapshot
        reading = name == "read_passive_nodes"
        self.description = TOOL_DESCRIPTIONS[name]
        self.parameters = {"type":"object","additionalProperties":False,"required":["ids" if reading else "query"],"properties":
                           {"ids":{"type":"array","minItems":1,"maxItems":3,"items":{"type":"string"}}} if reading else
                           {"query":{"type":"string","maxLength":300}}}

    def validate(self, arguments: Mapping[str,Any]) -> None:
        key = "ids" if self.name == "read_passive_nodes" else "query"
        if set(arguments) != {key}: raise AgentError("INVALID_TOOL_ARGUMENTS","RAG 参数无效")
        value = arguments[key]
        if key == "query":
            valid = isinstance(value,str) and 0<len(value.strip())<=300
        else:
            valid = isinstance(value,list) and 1<=len(value)<=3 and all(isinstance(v,str) and v.isdigit() and len(v)<=16 for v in value)
        if not valid: raise AgentError("INVALID_TOOL_ARGUMENTS","RAG 参数无效")

    async def execute(self, arguments: Mapping[str,Any]) -> dict[str,Any]:
        if self.name == "search_memory_semantic":
            rows = self.memory.store.directory(self.memory.conversation_id)
            # Summary-index retrieval deliberately avoids uploading full private transcripts.
            if len(rows)>1000: raise AgentError("RAG_MEMORY_LIMIT","会话摘要超过首版语义索引上限，请使用关键词搜索")
            records = [{**r,"text":r["summary"]} for r in rows]
            return {**await self.index.search(arguments["query"],records),"metadata_only":True,"coverage":"completed_turn_summaries"}
        records = self.index.records()
        if self.name == "search_passive_nodes":
            result = {**await self.index.search(arguments["query"],records),"version":self.index.status()["version"]}
            if self.tree_snapshot:
                from .tree_tools import path_summary
                for match in result.get("matches", []):
                    node_id = str(match.get("id", ""))
                    if self.tree_snapshot.has(node_id):
                        match["currentBuildPath"] = path_summary(self.tree_snapshot, node_id)
                result["liveSnapshotId"] = self.tree_snapshot.snapshot_id
            return result
        found = [{k:v for k,v in r.items() if k != "text"} for r in records if r["id"] in arguments["ids"]]
        if self.tree_snapshot:
            from .tree_tools import path_summary
            for node in found:
                node_id = str(node.get("id", ""))
                if self.tree_snapshot.has(node_id):
                    node["currentBuildPath"] = path_summary(self.tree_snapshot, node_id)
        result = {"nodes":found,"missing":[i for i in arguments["ids"] if i not in {r["id"] for r in found}],"version":self.index.status()["version"]}
        if self.tree_snapshot:
            result["liveSnapshotId"] = self.tree_snapshot.snapshot_id
        if len(encode(result))>7000: raise AgentError("RAG_READ_LIMIT","节点原文超出读取预算，请减少节点数量")
        return result
