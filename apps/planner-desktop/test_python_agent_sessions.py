"""Synthetic legacy upgrade and durable session boundary regressions."""
import json
import asyncio
import sqlite3
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path

from python_agent.core import AgentError
from python_agent.memory import MemoryStore, empty_notebook
from python_agent.memory import MemorySession
from python_agent.service import AgentService
from python_agent.core import ModelReply
from test_python_agent_runtime import ScriptedProvider


class SessionTests(unittest.TestCase):
    def test_delete_is_scoped_transactional_and_removes_exclusive_vectors(self):
        from python_agent.rag import digest
        with tempfile.TemporaryDirectory() as folder:
            service=AgentService(str(Path(folder)/"memory.sqlite3"))
            service.configure("http://localhost:9999/v1","synthetic")
            store=service.memory_store; first=service.conversation_id
            pair=lambda t:[{"role":"user","content":t},{"role":"assistant","content":"answer"}]
            store.commit(first,1,pair("unique"),{**empty_notebook(),"goal":"deleted notebook"},{"trace":[]})
            service.reset();second=service.conversation_id
            store.commit(second,1,pair("shared"),empty_notebook())
            store.commit(first,2,pair("shared"),empty_notebook())
            other=store.activate("other-service")
            store.commit(other,1,pair("other"),empty_notebook())
            store.db.execute("CREATE TABLE failed_runs(conversation_id TEXT,details TEXT)")
            store.db.executemany("INSERT INTO failed_runs VALUES (?,?)",[(first,"first"),(second,"second")]);store.db.commit()
            rag=sqlite3.connect(service.rag_cache_path)
            rag.executescript("CREATE TABLE vectors(profile TEXT,hash TEXT,vector TEXT);CREATE TABLE nodes(hash TEXT);")
            unique=digest(store.directory(first)[0]["summary"]);shared=digest(store.directory(second)[0]["summary"])
            rag.executemany("INSERT INTO vectors VALUES ('p',?,'[]')",[(unique,),(shared,),("public",)])
            rag.execute("INSERT INTO nodes VALUES ('public')");rag.commit()
            with self.assertRaises(AgentError):service.delete_session(other,True)
            with self.assertRaises(AgentError):service.delete_session(first,False)
            # An induced mid-delete failure must roll back both attached vector and archive writes.
            store.db.execute("CREATE TRIGGER fail_delete BEFORE DELETE ON turns BEGIN SELECT RAISE(ABORT,'fixture'); END")
            store.db.commit()
            with self.assertRaises(sqlite3.IntegrityError):service.delete_session(first,True)
            self.assertEqual(rag.execute("SELECT count(*) FROM vectors WHERE hash=?",(unique,)).fetchone()[0],1)
            self.assertEqual(len(store.directory(first)),2)
            store.db.execute("DROP TRIGGER fail_delete");store.db.commit()
            result=service.delete_session(first,True)
            self.assertEqual(result["selectedId"],second)
            for table in ("turns","turn_display","conversation_metadata","failed_runs"):
                self.assertEqual(store.db.execute(f"SELECT count(*) FROM {table} WHERE conversation_id=?",(first,)).fetchone()[0],0)
            self.assertEqual(store.db.execute("SELECT count(*) FROM conversations WHERE id=?",(first,)).fetchone()[0],0)
            self.assertEqual({r[0] for r in rag.execute("SELECT hash FROM vectors")},{shared,"public"})
            self.assertEqual(len(store.directory(other)),1)
            self.assertEqual(service.provider._api_key,"synthetic")
            with self.assertRaises(AgentError):store.commit(first,1,pair("late"),empty_notebook())
            self.assertEqual(store.db.execute("SELECT count(*) FROM conversations WHERE id=?",(first,)).fetchone()[0],0)
            service.delete_session(second,True)
            self.assertIsNone(service.conversation_id)
            self.assertEqual(service.sessions()["sessions"],[])
            with self.assertRaises(AgentError):service.restore(pair("legacy resurrection"))
            store.db.close();rag.close()
            restarted=AgentService(str(Path(folder)/"memory.sqlite3"))
            restarted.configure("http://localhost:9999/v1","synthetic")
            self.assertIsNone(restarted.conversation_id)
            restarted.reset()
            self.assertEqual(len(restarted.sessions()["sessions"]),1)
            with self.assertRaises(AgentError):restarted.restore(pair("old display"))
            restarted.memory_store.db.close()

    def test_delete_current_selects_remaining_history(self):
        service=AgentService(":memory:");service.configure("http://localhost:9999/v1","synthetic")
        first=service.conversation_id
        pair=[{"role":"user","content":"keep"},{"role":"assistant","content":"answer"}]
        service.memory_store.commit(first,1,pair,empty_notebook())
        service.reset();second=service.conversation_id
        result=service.delete_session(second,True)
        self.assertEqual(result["selectedId"],first)
        self.assertEqual(service.history,pair)
        self.assertEqual(service.memory_store.activate(service.provider.base_url),first)
        with self.assertRaises(AgentError):service.session_history(second)
        service.memory_store.db.close()

    def test_legacy_upgrade_preserves_archive_and_selected_session(self):
        with tempfile.TemporaryDirectory() as folder:
            filename = str(Path(folder) / "old.sqlite3")
            db = sqlite3.connect(filename)
            db.executescript("""
                CREATE TABLE conversations(id TEXT PRIMARY KEY,endpoint TEXT NOT NULL,notebook TEXT NOT NULL);
                CREATE TABLE active_conversations(endpoint TEXT PRIMARY KEY,conversation_id TEXT NOT NULL);
                CREATE TABLE turns(conversation_id TEXT,turn_id INTEGER,created_at TEXT,summary TEXT,messages TEXT,search_text TEXT,chars INTEGER,PRIMARY KEY(conversation_id,turn_id));
            """)
            messages = json.dumps([{"role":"user","content":"旧会话甲"},{"role":"assistant","content":"原文保全"}],ensure_ascii=False)
            notebook = json.dumps({**empty_notebook(),"goal":"旧笔记"},ensure_ascii=False)
            db.execute("INSERT INTO conversations VALUES ('old','endpoint',?)",(notebook,))
            db.execute("INSERT INTO active_conversations VALUES ('endpoint','old')")
            db.execute("INSERT INTO turns VALUES ('old',1,'2026-01-01','摘要',?,?,?)",(messages,messages,len(messages)))
            db.commit(); db.close()
            store = MemoryStore(filename)
            self.assertEqual(store.activate("endpoint"),"old")
            self.assertEqual(store.db.execute("SELECT messages FROM turns").fetchone()[0],messages)
            self.assertEqual(store.db.execute("SELECT notebook FROM conversations").fetchone()[0],notebook)
            self.assertEqual(store.list_conversations("endpoint")[0]["title"],"旧会话甲")
            newer = store.activate("endpoint",new=True)
            store.select("endpoint","old")
            store.db.close()
            store = MemoryStore(filename)
            self.assertEqual(store.activate("endpoint"),"old")
            self.assertEqual(len(store.list_conversations("endpoint")),2)
            with self.assertRaises(AgentError): store.select("other-endpoint",newer)
            self.assertEqual(store.notebook("old")["goal"],"旧笔记")
            store.db.close()

    def test_paged_history_is_complete_and_scoped(self):
        store=MemoryStore(":memory:")
        first=store.activate("endpoint")
        for i in range(35):
            store.commit(first,i+1,[{"role":"user","content":f"甲{i}"},{"role":"assistant","content":"答案"}],empty_notebook())
        second=store.activate("endpoint",new=True)
        store.commit(second,1,[{"role":"user","content":"乙"},{"role":"assistant","content":"私有乙"}],empty_notebook())
        page=store.display_history("endpoint",first)
        self.assertEqual(len(page["turns"]),20)
        older=store.display_history("endpoint",first,page["before"])
        self.assertEqual(len(older["turns"]),15)
        self.assertIsNone(older["before"])
        self.assertEqual(older["turns"][0]["user"],"甲0")
        self.assertNotIn("私有乙",json.dumps(page,ensure_ascii=False))
        with self.assertRaises(AgentError): store.display_history("other",first)
        store.db.close()


class SessionRunTests(unittest.IsolatedAsyncioTestCase):
    async def test_delete_rejected_during_turn_and_empty_send_rejected(self):
        service=AgentService(":memory:");service.configure("http://localhost:9999/v1","synthetic")
        cid=service.conversation_id;started=asyncio.Event();release=asyncio.Event()
        async def complete(**kwargs):
            started.set();await release.wait();return ModelReply("done")
        service.provider.complete=complete
        pending=asyncio.create_task(service.send("synthetic","hi",False))
        await started.wait()
        with self.assertRaisesRegex(AgentError,"先停止"):service.delete_session(cid,True)
        release.set();await pending
        self.assertEqual(len(service.memory_store.directory(cid)),1)
        service.delete_session(cid,True)
        with self.assertRaisesRegex(AgentError,"新建"):await service.send("synthetic","hi",False)
        service.memory_store.db.close()
    async def test_failed_selection_keeps_memory_database_restart_and_next_send_on_a(self):
        for corruption in ("second_json", "second_unfinished", "display_read", "list_read"):
            with self.subTest(corruption=corruption), tempfile.TemporaryDirectory() as folder:
                filename=str(Path(folder)/"sessions.sqlite3")
                service=AgentService(filename)
                endpoint="http://127.0.0.1:9999/v1"
                service.configure(endpoint,"synthetic")
                store=service.memory_store
                a=service.conversation_id
                pair=lambda text:[{"role":"user","content":text},{"role":"assistant","content":text+"-response"}]
                store.commit(a,1,pair("A-private"),{**empty_notebook(),"goal":"A-notebook"})
                service.reset(); b=service.conversation_id
                store.commit(b,1,pair("B-first"),empty_notebook())
                store.commit(b,2,pair("B-second"),{**empty_notebook(),"goal":"B-notebook"})
                service.select_session(a)
                if corruption.startswith("second"):
                    broken="not-json" if corruption=="second_json" else json.dumps([{"role":"user","content":"unfinished"}])
                    store.db.execute("UPDATE turns SET messages=? WHERE conversation_id=? AND turn_id=2",(broken,b));store.db.commit()
                target="display_history" if corruption=="display_read" else "list_conversations"
                if corruption.endswith("read"):
                    failure=ValueError("synthetic read failure")
                    effect=[store.list_conversations(endpoint),failure] if corruption=="list_read" else failure
                    with patch.object(store,target,side_effect=effect):
                        with self.assertRaises((AgentError,ValueError)): service.select_session(b)
                else:
                    with self.assertRaises(AgentError): service.select_session(b)
                self.assertEqual(service.conversation_id,a)
                self.assertEqual(service.history,pair("A-private"))
                self.assertEqual(store.activate(endpoint),a)
                store.db.close()
                restarted=AgentService(filename)
                try:
                    restarted.configure(endpoint,"synthetic")
                    self.assertEqual(restarted.conversation_id,a)
                    self.assertEqual(restarted.history,pair("A-private"))
                    provider=ScriptedProvider([ModelReply("A-next-response")])
                    restarted.provider=provider
                    await restarted.send("mock","A-next",False)
                    request=json.dumps(provider.requests,ensure_ascii=False)
                    self.assertIn("A-private",request);self.assertIn("A-notebook",request)
                    self.assertNotIn("B-first",request);self.assertNotIn("B-notebook",request)
                    self.assertEqual(len(restarted.memory_store.directory(a)),2)
                    self.assertEqual(len(restarted.memory_store.directory(b)),2)
                finally: restarted.memory_store.db.close()

    async def test_import_redacts_new_records_and_legacy_titles(self):
        service=AgentService(":memory:")
        service.configure("http://127.0.0.1:9999/v1","SYNTHETIC_CONFIG_SECRET")
        service.restore([{"role":"user","content":'SYNTHETIC_CONFIG_SECRET {"apiKey":"legacy-secret"}'},
                         {"role":"assistant","content":'{"password":"hidden-value"}'}])
        dump="".join(service.memory_store.db.iterdump())
        self.assertNotIn("SYNTHETIC_CONFIG_SECRET",dump)
        self.assertNotIn("hidden-value",dump)
        # An existing archive is not rewritten, but its visible title is scrubbed.
        cid=service.conversation_id
        service.memory_store.db.execute("UPDATE turns SET messages=? WHERE conversation_id=?",(json.dumps([{"role":"user","content":'{"apiKey":"legacy-secret"}'},{"role":"assistant","content":"old"}]),cid))
        self.assertNotIn("legacy-secret",json.dumps(service.sessions()))
        self.assertNotIn("legacy-secret",json.dumps(service.session_history(cid)))
        long_secret="LONG_SYNTHETIC_KEY_"*8
        service.provider._api_key=long_secret
        service.memory_store.db.execute("UPDATE turns SET messages=? WHERE conversation_id=?",(json.dumps([{"role":"user","content":"prefix "+long_secret},{"role":"assistant","content":"old"}]),cid))
        self.assertNotIn("LONG_SYNTHETIC_KEY",json.dumps(service.sessions()))
        service.memory_store.db.close()

    async def test_switch_context_notebook_failures_and_redaction(self):
        service=AgentService(":memory:")
        service.configure("http://127.0.0.1:9999/v1","synthetic-key")
        first=service.conversation_id
        service.memory_store.commit(first,1,[{"role":"user","content":"甲独有"},{"role":"assistant","content":"甲答"}],{**empty_notebook(),"goal":"甲目标"})
        service.reset(); second=service.conversation_id
        provider=ScriptedProvider([ModelReply("乙答")]); provider.base_url="http://127.0.0.1:9999/v1"; provider._api_key="synthetic-key"
        service.provider=provider
        await service.send("mock","乙独有 synthetic-key",False)
        self.assertNotIn("甲独有",json.dumps(provider.requests,ensure_ascii=False))
        self.assertNotIn("synthetic-key",service.memory_store.db.execute("SELECT messages FROM turns WHERE conversation_id=?",(second,)).fetchone()[0])
        service.select_session(first)
        self.assertEqual(service.memory_store.notebook(first)["goal"],"甲目标")
        self.assertNotIn("乙独有",json.dumps(service.history,ensure_ascii=False))
        self.assertEqual(service.memory_store.search(first,"乙独有",5,0)["matches"],[])
        self.assertEqual(MemorySession(service.memory_store,first).conversation_id,first)
        async def fail(**kwargs): raise AgentError("PROVIDER_ERROR","synthetic failure")
        provider.complete=fail
        with self.assertRaises(AgentError): await service.send("mock","失败不入库",False)
        self.assertEqual(len(service.memory_store.directory(first)),1)
        service.running=True
        with self.assertRaises(AgentError): service.select_session(second)
        with self.assertRaises(AgentError): service.reset()
        service.running=False
        service.memory_store.db.close()
