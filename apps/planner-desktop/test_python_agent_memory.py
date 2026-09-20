"""Memory acceptance tests use synthetic conversations, never cached credentials."""

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from python_agent.core import AgentError, ModelReply, ToolCall
from python_agent.memory import MemorySession, MemoryStore, MemoryTool, empty_notebook
from python_agent.service import AgentService, _trim_history
from test_python_agent_runtime import ScriptedProvider


def pair(question, answer):
    return [{"role": "user", "content": question}, {"role": "assistant", "content": answer}]


def block(request):
    content = next(m["content"] for m in request["messages"]
                   if m["content"].startswith("[MEMORY_CONTEXT_DATA]"))
    return json.loads(content.split("\n", 1)[1])


class MemoryTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.service = AgentService(str(Path(self.temp.name) / "memory.sqlite3"))
        self.service.configure("http://127.0.0.1:9999/v1", "synthetic-key-not-for-memory")
        self.store = self.service.memory_store
        self.cid = self.service.conversation_id

    def tearDown(self):
        self.store.db.close()
        self.temp.cleanup()

    def seed(self):
        turns = [pair("项目代号：琥珀-731", "已登记项目代号"),
                 pair("交付日期：周五", "已登记交付日期")]
        turns += [pair(f"长记录{i}", "中" * 30_000) for i in range(4)]
        for index, turn in enumerate(turns, 1):
            self.store.commit(self.cid, index, turn, empty_notebook())
        self.service.history = _trim_history(self.store.recent_history(self.cid))
        return turns

    async def test_all_four_strategies_and_current_turn(self):
        self.seed()
        provider = ScriptedProvider([
            ModelReply(tool_calls=(ToolCall("n", "update_notebook", json.dumps({"goal": "验证四项记忆策略", "constraints": ["不得编造历史"], "notes": {"验收口令": "蓝鹭-908"}}, ensure_ascii=False)),)),
            ModelReply(tool_calls=(ToolCall("s", "search_memory", '{"query":"琥珀"}'),)),
            ModelReply(tool_calls=(ToolCall("r", "read_memory", '{"start_turn_id":1,"count":2}'),)),
            ModelReply("已查证琥珀-731，交付日期周五；笔记本已更新。"),
        ])
        self.service.provider = provider
        result = await self.service.send("mock", "请搜索旧记忆并记录笔记", False)
        first = block(provider.requests[0])
        self.assertEqual(first["current_turn"], 7)
        self.assertEqual([row["turn_id"] for row in first["directory"]], list(range(1, 7)))
        self.assertFalse(any(m["content"] == "项目代号：琥珀-731" for m in provider.requests[0]["messages"]))
        self.assertGreater(result["context"]["omittedTurns"], 0)
        self.assertEqual(block(provider.requests[1])["notebook"]["notes"]["验收口令"], "蓝鹭-908")
        search = json.loads(result["trace"][1]["result"])
        self.assertEqual(search["matches"][0]["turn_id"], 1)
        self.assertTrue(search["metadata_only"])
        self.assertNotIn("messages", search["matches"][0])
        read = json.loads(result["trace"][2]["result"])
        self.assertTrue(read["complete"])
        self.assertEqual(read["turn_ids"], [1, 2])
        self.assertEqual(json.loads(read["text"])[1]["messages"][0]["content"], "交付日期：周五")
        self.assertEqual(self.store.notebook(self.cid)["revision"], 1)
        self.assertEqual(len(self.store.directory(self.cid)), 7)
        # Logs prove the actual provider inputs and actual tool results, not fabricated examples.
        print("MEMORY_EVIDENCE " + json.dumps({
            "directory": {"current_turn": first["current_turn"], "turn_ids": [r["turn_id"] for r in first["directory"]], "old_raw_turn_excluded": True},
            "notebook_next_model_input": block(provider.requests[1])["notebook"],
            "search_tool_result": search,
            "read_tool_result": read,
        }, ensure_ascii=False))

    async def test_failure_rolls_back_notebook_and_turn(self):
        class FailureAfterTool(ScriptedProvider):
            async def complete(self, **kwargs):
                if self.requests:
                    raise AgentError("PROVIDER_STREAM_ERROR", "partial output failed")
                return await super().complete(**kwargs)
        self.service.provider = FailureAfterTool([
            ModelReply(tool_calls=(ToolCall("n", "update_notebook", '{"goal":"not committed"}'),))])
        with self.assertRaises(AgentError):
            await self.service.send("mock", "failure", False)
        self.assertEqual(self.store.directory(self.cid), [])
        self.assertEqual(self.store.notebook(self.cid), empty_notebook())

    async def test_restart_scope_new_chat_and_legacy_import(self):
        self.service.restore(pair("旧会话", "旧答复"))
        self.service.restore(pair("旧会话", "旧答复"))
        self.assertEqual(len(self.store.directory(self.cid)), 1)
        other = AgentService(str(Path(self.temp.name) / "memory.sqlite3"))
        try:
            other.configure("http://127.0.0.1:9999/v1", "synthetic")
            self.assertEqual(other.conversation_id, self.cid)
            other.configure("http://127.0.0.1:9998/v1", "synthetic")
            self.assertEqual(other.memory_store.directory(other.conversation_id), [])
            other.configure("http://127.0.0.1:9999/v1", "synthetic")
            other.reset()
            self.assertNotEqual(other.conversation_id, self.cid)
            self.assertEqual(other.memory_store.directory(other.conversation_id), [])
            self.assertEqual(len(self.store.directory(self.cid)), 1)
        finally:
            other.memory_store.db.close()

    async def test_keyword_literal_paging_and_continuous_full_read(self):
        turns = [pair("关键词😀 100%_", "a" * 3500), pair("关键词😀", "尾部")]
        for index, turn in enumerate(turns, 1):
            self.store.commit(self.cid, index, turn, empty_notebook())
        self.assertEqual(len(self.store.search(self.cid, "%_", 5, 0)["matches"]), 1)
        self.assertEqual(self.store.search(self.cid, "关键词😀", 1, 0)["next_offset"], 1)
        session = MemorySession(self.store, self.cid)
        read = MemoryTool(session, "read_memory")
        fragments, offset = [], 0
        while True:
            result = await read.execute({"start_turn_id": 1, "count": 2, "offset": offset})
            fragments.append(result["text"])
            if result["complete"]:
                break
            offset = result["next_offset"]
        self.assertEqual([r["messages"] for r in json.loads("".join(fragments))], turns)
        self.assertNotIn("synthetic-key-not-for-memory", "".join(self.store.db.iterdump()))

    async def test_notebook_and_tool_validation(self):
        session = MemorySession(self.store, self.cid)
        update = MemoryTool(session, "update_notebook")
        await update.execute({"notes": {"old": "obsolete"}})
        update.validate({"notes": {"old": None, "new": "current"}})
        await update.execute({"notes": {"old": None, "new": "current"}})
        self.assertEqual(session.notebook["notes"], {"new": "current"})
        for args in ({}, {"unknown": "x"}, {"notes": {"x": 2}}, {"constraints": "x"}):
            with self.subTest(args=args), self.assertRaises(AgentError):
                update.validate(args)
        for name, args in (("search_memory", {"query": " "}), ("read_memory", {"start_turn_id": True})):
            with self.assertRaises(AgentError):
                MemoryTool(session, name).validate(args)

    async def test_import_is_atomic(self):
        from python_agent.context import ContextError
        with self.assertRaises(ContextError):
            self.store.import_turns(self.cid, [pair("valid", "answer"), [{"role": "user", "content": "unfinished"}]])
        self.assertEqual(self.store.directory(self.cid), [])

    async def test_directory_limit_fails_without_dropping_entries(self):
        self.store.commit(self.cid, 1, pair("first", "answer"), empty_notebook())
        with patch("python_agent.memory.MAX_DIRECTORY_CHARS", 1):
            with self.assertRaises(AgentError) as failed:
                self.store.commit(self.cid, 2, pair("second", "answer"), empty_notebook())
        self.assertEqual(failed.exception.code, "MEMORY_DIRECTORY_FULL")
        self.assertEqual([r["turn_id"] for r in self.store.directory(self.cid)], [1])

    async def test_working_cache_eviction_preserves_archive(self):
        for number in range(1, 33):
            self.store.commit(self.cid, number, pair(f"记录{number}", "answer"), empty_notebook())
        self.assertEqual(len(self.store.recent_history(self.cid)), 60)
        session = MemorySession(self.store, self.cid)
        self.assertEqual(len(session.model_context()["directory"]), 32)
        self.assertEqual(session.current_turn, 33)
        self.assertEqual(json.loads(self.store.read(self.cid, 1, 1, 0)["text"])[0]["messages"], pair("记录1", "answer"))


if __name__ == "__main__":
    unittest.main()
