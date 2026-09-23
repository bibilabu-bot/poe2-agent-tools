"""Chinese defaults, exact migration and safe runtime inspection."""
import hashlib
import itertools
import json
import re
import unittest
import tempfile
from pathlib import Path
from unittest.mock import patch

from python_agent.prompts import build_system_prompt, PROMPT_VERSION, PromptStore, DEFAULTS, TOOL_DESCRIPTIONS
from python_agent.core import ChatAgent, ModelReply, ToolCall
from python_agent.memory import MemoryTool
from python_agent.rag import RagTool
from python_agent.service import AgentService
from test_python_agent_runtime import ScriptedProvider

# Chinese v5 combinations, in memory/rag/unavailable bit order.
BASELINE = {
    "100": "2557ff364da88847335e3e8680d06621acdea77a8b8a61ef1455cff088496576",
    "101": "91d79bfda3b4b445727a1f9edf2a50994861fdf187c212056e93d9da5cdcecd1",
    "110": "84fbc82bab44d21b9a0be1c10c2341b390921e8b9d170afc64b9af32f524fa97",
    "111": "86e11d3df40ead6df5792fcb63184ff6062dd16bc70621a441afd19d027198a5",
    "000": "8324aa3aea50c87025f1021aab09a6fb816b16cfe4f6544adb30c14e8d6ff4b0",
    "001": "8143d53cc929a44d85a500b7f50f4f11438e17de9943802c095e27a3919107ee",
    "010": "054e9b767d5033742ae7df50036c5b45b6dc41e55a8b9033bbc70be0fb56b543",
    "011": "0d0c2ba985d70f81ab902584144f5a512b015b75a67c7d730e407842b1871f7a"
}


class PromptTests(unittest.IsolatedAsyncioTestCase):
    def test_v4_retired_overviews_migrate_without_writing(self):
        with tempfile.TemporaryDirectory() as folder:
            filename=Path(folder)/"prompts.json"
            filename.write_text(json.dumps({"version":"chat-prompts-zh-v4","overrides":{
                "base":"先 build_summary，再 tree_summary 或 list_tree_clusters",
                "tool_build_summary":"old","tool_tree_summary":"old","tool_list_tree_clusters":"old",
                "tool_read_tree_nodes":"keep"}}),encoding="utf-8")
            before=filename.read_bytes()
            store=PromptStore(str(filename))
            self.assertIsNone(store.error)
            self.assertEqual(filename.read_bytes(),before)
            blocks=dict(store.blocks)
            self.assertEqual(blocks["base"],"先 tree_overview，再 tree_overview 或 tree_overview")
            self.assertEqual(blocks["tool_read_tree_nodes"],"keep")
            self.assertTrue({"tool_build_summary","tool_tree_summary","tool_list_tree_clusters"}.isdisjoint(blocks))

    def test_v3_explicit_english_override_survives_v4_migration(self):
        from python_agent.prompts_legacy import ENGLISH_DEFAULTS
        with tempfile.TemporaryDirectory() as folder:
            filename=Path(folder)/"prompts.json"
            filename.write_text(json.dumps({"version":"chat-prompts-zh-v3","overrides":{"base":ENGLISH_DEFAULTS["base"]}}),encoding="utf-8")
            store=PromptStore(str(filename))
            self.assertIsNone(store.error)
            self.assertEqual(dict(store.blocks)["base"],ENGLISH_DEFAULTS["base"])

    def test_english_defaults_migrate_but_custom_values_survive_and_reset_chinese(self):
        from python_agent.prompts_legacy import ENGLISH_DEFAULTS
        for version in ("chat-system-v1","chat-prompts-v2"):
            with self.subTest(version=version), tempfile.TemporaryDirectory() as folder:
                filename=Path(folder)/"prompts.json"
                values=dict(ENGLISH_DEFAULTS)
                values["base"]="My custom English policy.\n保留🙂"
                values["tool_read_memory"]="Read my CUSTOM evidence.\n"
                values["tool_calculator"]="obsolete override must disappear"
                filename.write_text(json.dumps({"version":version,"overrides":values}),encoding="utf-8")
                before=filename.read_bytes();store=PromptStore(str(filename))
                self.assertIsNone(store.error);self.assertEqual(filename.read_bytes(),before)
                actual=dict(store.blocks)
                self.assertEqual(actual["base"],values["base"])
                self.assertEqual(actual["tool_read_memory"],values["tool_read_memory"])
                self.assertNotIn("tool_calculator",actual)
                for key,default in DEFAULTS:
                    if key not in ("base","tool_read_memory"):self.assertEqual(actual[key],default)
                store.save(actual)
                saved=json.loads(filename.read_text(encoding="utf-8"))
                self.assertEqual(saved["overrides"],{key:values[key] for key in ("base","tool_read_memory")})
                self.assertEqual(PromptStore(str(filename)).blocks,store.blocks)
                store.save({});self.assertEqual(PromptStore(str(filename)).blocks,DEFAULTS)
                self.assertEqual(json.loads(filename.read_text(encoding="utf-8"))["overrides"],{})

    def test_all_old_defaults_upgrade_and_current_explicit_english_stays_custom(self):
        from python_agent.prompts_legacy import ENGLISH_DEFAULTS
        with tempfile.TemporaryDirectory() as folder:
            filename=Path(folder)/"prompts.json"
            for version in ("chat-system-v1","chat-prompts-v2"):
                filename.write_text(json.dumps({"version":version,"overrides":ENGLISH_DEFAULTS}),encoding="utf-8")
                self.assertEqual(PromptStore(str(filename)).blocks,DEFAULTS)
            store=PromptStore(str(filename));store.save({"base":ENGLISH_DEFAULTS["base"]})
            self.assertEqual(dict(PromptStore(str(filename)).blocks)["base"],ENGLISH_DEFAULTS["base"])
            for name,text in DEFAULTS:
                self.assertRegex(text,r"[\u4e00-\u9fff]")
                self.assertNotIn("calculator",text)
                self.assertNotIn("计算器",text)

    async def test_removed_tool_is_never_registered_and_fails_as_unknown(self):
        service=AgentService(":memory:")
        try:
            service.configure("http://127.0.0.1:9999/v1","synthetic")
            provider=ScriptedProvider([ModelReply(tool_calls=(ToolCall("c","calculator",'{"operator":"add","a":1,"b":2}'),)),ModelReply("工具不可用")])
            service.provider=provider
            result=await service.send("mock","test",True)
            self.assertFalse(result["trace"][0]["ok"])
            self.assertIn("UNKNOWN_TOOL",result["trace"][0]["result"])
            for request in provider.requests:
                self.assertNotIn("calculator",[t["function"]["name"] for t in request["tools"]])
            self.assertNotIn("tool_calculator",[b["id"] for b in service.inspect_prompt()["blocks"]])
        finally:service.memory_store.db.close()

    def test_nonbase_length_boundary_is_stable_after_save_and_restart(self):
        with tempfile.TemporaryDirectory() as folder:
            filename=str(Path(folder)/"memory.sqlite3")
            service=AgentService(filename)
            try:
                for name in ("memory","rag","rag_unavailable"):
                    with self.assertRaises(Exception):
                        service.save_prompts({name:"x"*4001})
                    service.save_prompts({name:"x"*4000})
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
        self.assertIn("检索当前不可用",result["text"])

    def test_documented_text_is_exact_and_complete(self):
        doc=(Path(__file__).resolve().parents[2]/"docs/SYSTEM_PROMPTS.md").read_text(encoding="utf-8")
        sections=re.findall(r"```text\n(.*?)\n```",doc,re.S)
        self.assertEqual(sections,[text for _,text in DEFAULTS])

    def test_all_combinations_match_exact_chinese_defaults(self):
        self.assertEqual(PROMPT_VERSION,"chat-prompts-zh-v5")
        self.assertIn("必须先调用 tree_overview",build_system_prompt().text)
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

    def test_all_fixed_descriptions_are_catalogued_with_unchanged_defaults(self):
        tools=[MemoryTool(None,n) for n in ("search_memory","read_memory","update_notebook")]
        tools += [RagTool(None,n) for n in ("read_passive_nodes","search_passive_nodes","search_memory_semantic")]
        digest=hashlib.sha256(json.dumps([t.definition() for t in tools],sort_keys=True).encode()).hexdigest()
        self.assertEqual(digest,"ec0ffbd8373b396a20f809fb16b4e878fb1621910c992d490e1e895f1460232a")
        from python_agent.prompts_legacy import ENGLISH_DEFAULTS
        old_definitions=[tool.definition() for tool in tools]
        for definition in old_definitions:
            definition["function"]["description"]=ENGLISH_DEFAULTS["tool_"+definition["function"]["name"]]
        self.assertEqual(hashlib.sha256(json.dumps(old_definitions,sort_keys=True).encode()).hexdigest(),
                         "70ab4ef644f124761a55542f2b6d9d49305d94e4e240b204e77bc9ed2af6880a")
        blocks=AgentService().inspect_prompt()["blocks"]
        self.assertEqual(len([b for b in blocks if b["category"]=="system"]),5)
        self.assertEqual(len([b for b in blocks if b["category"]=="tool"]),15)
        self.assertEqual({b["id"]:b["text"] for b in blocks},dict(DEFAULTS))

    async def test_every_override_reaches_actual_provider_without_changing_schemas(self):
        service=AgentService(":memory:")
        try:
            service.configure("http://127.0.0.1:9999/v1","SYNTHETIC")
            service.rag=object();service.rag_unavailable=True
            overrides={name:f" [{name} 自定义全文🙂] \n" for name,_ in DEFAULTS}
            service.save_prompts(overrides)
            provider=ScriptedProvider([ModelReply("ok")]);service.provider=provider
            await service.send("mock","hello",True)
            request=provider.requests[0]
            self.assertEqual(request["messages"][0]["content"],"".join(overrides[k] for k in ("base","memory","rag","rag_unavailable")))
            self.assertTrue(request["messages"][1]["content"].startswith(overrides["memory_prefix"]))
            self.assertEqual(request["messages"][1]["role"],"user")
            self.assertEqual({t["function"]["name"]:t["function"]["description"] for t in request["tools"]},
                             {name:overrides["tool_"+name] for name in TOOL_DESCRIPTIONS if name in {t["function"]["name"] for t in request["tools"]}})
            self.assertNotIn("calculator",[t["function"]["name"] for t in request["tools"]])
            service.save_prompts({});service.rag=None
            service.provider=ScriptedProvider([ModelReply("reset")])
            await service.send("mock","again",True)
            self.assertEqual(service.provider.requests[0]["tools"][0]["function"]["description"],TOOL_DESCRIPTIONS["search_memory"])
        finally:service.memory_store.db.close()

    def test_v1_migration_preserves_text_and_adds_tool_defaults(self):
        with tempfile.TemporaryDirectory() as folder:
            filename=Path(folder)/"prompts.json"
            old={"version":"chat-system-v1","overrides":{"base":"旧配置🙂", "memory":"  原有空白\n"}}
            filename.write_text(json.dumps(old),encoding="utf-8")
            before=filename.read_bytes();store=PromptStore(str(filename))
            self.assertIsNone(store.error);self.assertEqual(filename.read_bytes(),before)
            self.assertEqual(dict(store.blocks)["memory"],old["overrides"]["memory"])
            self.assertEqual(dict(store.blocks)["tool_search_memory"],TOOL_DESCRIPTIONS["search_memory"])
            values=dict(store.blocks);values["tool_search_memory"]="工具自定义\n 全文"
            store.save(values)
            self.assertEqual(json.loads(filename.read_text(encoding="utf-8"))["version"],PROMPT_VERSION)
            self.assertEqual(dict(PromptStore(str(filename)).blocks),values)

    def test_v1_maximum_system_budget_migrates_without_writes_or_truncation(self):
        with tempfile.TemporaryDirectory() as folder:
            filename=Path(folder)/"prompts.json"
            overrides={"base":"x"*4000,"memory":" "*999+"m","rag":" "*1999+"r","rag_unavailable":" "*999+"u"}
            filename.write_text(json.dumps({"version":"chat-system-v1","overrides":overrides}),encoding="utf-8")
            before=filename.read_bytes();store=PromptStore(str(filename))
            self.assertIsNone(store.error);self.assertEqual(filename.read_bytes(),before)
            text=build_system_prompt(memory=True,rag=True,rag_unavailable=True,overrides=dict(store.blocks)).text
            self.assertEqual(len(text),8000);self.assertEqual(text,"".join(overrides.values()))

    def test_tool_budget_and_failed_save_are_atomic_and_corruption_recoverable(self):
        with tempfile.TemporaryDirectory() as folder:
            filename=Path(folder)/"prompts.json";store=PromptStore(str(filename))
            store.save({"tool_search_memory":"原文"});before=filename.read_bytes()
            with self.assertRaises(ValueError):store.save({"tool_"+name:"x"*4000 for name in TOOL_DESCRIPTIONS})
            with patch("python_agent.prompts.os.replace",side_effect=OSError("synthetic")):
                with self.assertRaises(OSError):store.save({"tool_search_memory":"不能保存"})
            self.assertEqual(filename.read_bytes(),before)
            self.assertEqual(dict(store.blocks)["tool_search_memory"],"原文")
            filename.write_text("corrupt",encoding="utf-8")
            broken=PromptStore(str(filename));self.assertIsNotNone(broken.error)
            broken.save({});self.assertIsNone(broken.error);self.assertEqual(broken.blocks,DEFAULTS)
