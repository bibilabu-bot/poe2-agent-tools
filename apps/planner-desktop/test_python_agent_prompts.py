"""Byte-for-byte parity with main eb60779, plus safe runtime inspection."""
import hashlib
import itertools
import json
import re
import unittest
import tempfile
from pathlib import Path
from unittest.mock import patch

from python_agent.prompts import build_system_prompt, PROMPT_VERSION, PromptStore
from python_agent.core import ChatAgent, ModelReply
from python_agent.service import AgentService
from test_python_agent_runtime import ScriptedProvider

# Captured from the pre-refactor AST, in memory/rag/unavailable bit order.
BASELINE = {
    "000":"5462361f3ec91f4138b8e999e5763ea86d6b7b5d856a2bab5fb64730ac3e3344",
    "001":"8896af06b0db4bf2983703408fc8ac4b963340fa0ee5ef449a9a137649dc879c",
    "010":"7928dac8de2b833fcea8ba7f575e9317f63759a64ff2c57d36bc5a50c7c108a1",
    "011":"6aa46d7f85325eb7d823028683b24e6282898cff58da859f6e42ce599b91a2e2",
    "100":"b6e134285bcd51e03a00bec870dbb2ee0f4d60f069996eba0f7f31d495ce2ab7",
    "101":"fb4df5ee8c8f67a0439115047dd8c0e046057d7ed50b35e2412689cce56a6b7b",
    "110":"62bf2330e1288a0a9ad35b6a46e0dd43cfef220ea6f4a45114d2b59fa08aa397",
    "111":"298ef2f12dca3a4b5eb6309c5966c48b062a3821c907723ef751da554f572b33",
}


class PromptTests(unittest.IsolatedAsyncioTestCase):
    def test_nonbase_length_boundary_is_stable_after_save_and_restart(self):
        with tempfile.TemporaryDirectory() as folder:
            filename=str(Path(folder)/"memory.sqlite3")
            service=AgentService(filename)
            try:
                for name in ("memory","rag","rag_unavailable"):
                    with self.assertRaises(Exception):
                        service.save_prompts({name:"x"*4000})
                    service.save_prompts({name:"x"*3999})
                    self.assertEqual(len(dict(service.prompts.blocks)[name]),4000)
                    service.inspect_prompt()
                    restarted=AgentService(filename)
                    try:
                        self.assertIsNone(restarted.prompts.error)
                        self.assertEqual(restarted.inspect_prompt(),service.inspect_prompt())
                    finally: restarted.memory_store.db.close()
            finally: service.memory_store.db.close()

    async def test_edit_persists_and_is_used_after_restart_and_reset(self):
        with tempfile.TemporaryDirectory() as folder:
            filename=str(Path(folder)/"memory.sqlite3")
            service=AgentService(filename)
            service.save_prompts({"base":"CUSTOM_BASE_FIXTURE"})
            service.memory_store.db.close()
            restarted=AgentService(filename)
            try:
                provider=ScriptedProvider([ModelReply("ok")]);restarted.provider=provider
                await restarted.send("mock","hello",False)
                self.assertEqual(provider.requests[0]["messages"][0]["content"],"CUSTOM_BASE_FIXTURE")
                restarted.save_prompts({})
                self.assertEqual(restarted.inspect_prompt()["text"],ChatAgent().system_prompt)
                restarted.running=True
                with self.assertRaises(Exception):restarted.save_prompts({"base":"blocked"})
            finally:restarted.memory_store.db.close()

    def test_prompt_save_limits_and_disk_failure_preserve_old_config(self):
        with tempfile.TemporaryDirectory() as folder:
            filename=str(Path(folder)/"prompts.json")
            store=PromptStore(filename);store.save({"base":"old"})
            original=Path(filename).read_bytes()
            for value in ({"unknown":"x"},{"base":""},{"base":"x"*4001},{"base":"x"*4000,"memory":"y"*4000},None):
                with self.assertRaises(ValueError):store.save(value)
            with patch("python_agent.prompts.os.replace",side_effect=OSError("synthetic")):
                with self.assertRaises(OSError):store.save({"base":"new"})
            self.assertEqual(Path(filename).read_bytes(),original)
            self.assertEqual(dict(store.blocks)["base"],"old")

    def test_clear_keeps_legacy_rag_flags_without_claiming_base_only(self):
        service=AgentService();service.rag=object();service.rag_unavailable=True;service.clear()
        result=service.inspect_prompt()
        self.assertFalse(result["configured"]);self.assertTrue(result["features"]["rag"])
        self.assertIn("Retrieval is currently unavailable",result["text"])

    def test_documented_text_is_exact_and_complete(self):
        doc=(Path(__file__).resolve().parents[2]/"docs/SYSTEM_PROMPTS.md").read_text(encoding="utf-8")
        sections=re.findall(r"```text\n(.*?)\n```",doc,re.S)
        self.assertEqual(len(sections),4)
        self.assertEqual("".join(sections),build_system_prompt(memory=True,rag=True,rag_unavailable=True).text)

    def test_all_combinations_preserve_exact_legacy_text(self):
        self.assertEqual(PROMPT_VERSION,"chat-system-v1")
        for flags in itertools.product((False,True),repeat=3):
            with self.subTest(flags=flags):
                spec=build_system_prompt(memory=flags[0],rag=flags[1],rag_unavailable=flags[2])
                key="".join(str(int(x)) for x in flags)
                self.assertEqual(hashlib.sha256(spec.text.encode()).hexdigest(),BASELINE[key])
                self.assertLess(len(spec.text),8000)
                self.assertEqual(spec.text,"".join(s["text"] for s in spec.describe()["sections"]))
        self.assertEqual(ChatAgent().system_prompt,build_system_prompt().text)
        with self.assertRaises(TypeError): build_system_prompt(memory="private text")

    async def test_actual_provider_instructions_match_inspection_for_all_flags(self):
        for memory,rag,unavailable in itertools.product((False,True),repeat=3):
            service=AgentService(":memory:" if memory else None)
            try:
                service.configure("http://127.0.0.1:9999/v1","PRIVATE_KEY_FIXTURE")
                service.rag=object() if rag else None
                service.rag_unavailable=unavailable
                service.history=[{"role":"user","content":"PRIVATE_HISTORY"},{"role":"assistant","content":"PRIVATE_REPLY"}]
                with patch("python_agent.memory.MemorySession.model_context",side_effect=AssertionError("Inspection read private data")):
                    preview=service.inspect_prompt()
                self.assertNotIn("PRIVATE",json.dumps(preview))
                self.assertFalse(preview["privateContextIncluded"])
                service.history=[]
                provider=ScriptedProvider([ModelReply("fixture answer")]);service.provider=provider
                await service.send("mock","fixture user",False)
                systems=[m["content"] for m in provider.requests[0]["messages"] if m["role"]=="system"]
                self.assertEqual(systems,[preview["text"]])
            finally:
                if service.memory_store: service.memory_store.db.close()

    def test_unconfigured_inspection_is_public_base_only_and_read_only(self):
        service=AgentService(":memory:")
        try:
            before=service.memory_store.db.total_changes
            result=service.inspect_prompt()
            self.assertFalse(result["configured"])
            self.assertEqual(result["text"],ChatAgent().system_prompt)
            self.assertEqual(before,service.memory_store.db.total_changes)
        finally: service.memory_store.db.close()
