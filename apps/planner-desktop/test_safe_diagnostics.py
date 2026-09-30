"""Synthetic HTTP/SSE and content-free failure regressions; no owner data."""
import asyncio
import json
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from types import SimpleNamespace
from unittest.mock import patch

from python_agent.core import AgentError, ModelReply, ToolCall
from python_agent.diagnostics import record_failure
from python_agent.provider import OpenAICompatibleProvider
from python_agent.service import AgentService
from test_python_agent_runtime import ScriptedProvider


def sse(*events, done=False):
    return "".join("data: "+json.dumps(e)+"\n\n" for e in events)+( "data: [DONE]\n\n" if done else "")


class FixtureHandler(BaseHTTPRequestHandler):
    body = ""
    status = 200
    content_type = "text/event-stream"

    def log_message(self, *_args):
        pass

    def do_POST(self):
        self.rfile.read(int(self.headers.get("content-length",0)))
        payload = type(self).body.encode()
        self.send_response(type(self).status)
        self.send_header("content-type",type(self).content_type)
        self.send_header("content-length",str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)


class SafeProviderTests(unittest.IsolatedAsyncioTestCase):
    @classmethod
    def setUpClass(cls):
        cls.server=ThreadingHTTPServer(("127.0.0.1",0),FixtureHandler)
        cls.thread=threading.Thread(target=cls.server.serve_forever,daemon=True)
        cls.thread.start()
        cls.url=f"http://127.0.0.1:{cls.server.server_port}/v1"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown();cls.server.server_close();cls.thread.join(timeout=2)

    async def request(self, body, protocol="chat", error=None, status=200, content_type="text/event-stream", secret="DO_NOT_LOG_KEY"):
        FixtureHandler.body=body;FixtureHandler.status=status;FixtureHandler.content_type=content_type
        provider=OpenAICompatibleProvider(self.url,secret)
        provider._wire_api=protocol
        if error:
            with self.assertRaises(AgentError) as caught:
                await provider.complete(model="fixture",messages=[],tools=[])
            self.assertEqual(caught.exception.code,error)
            return caught.exception
        return await provider.complete(model="fixture",messages=[],tools=[])

    async def test_chat_accepts_nullable_heartbeats_and_text(self):
        reply=await self.request("event: ping\ndata: null\n\n"+sse(
            {"choices":None},{"choices":[]},{"choices":[{"delta":None}]},
            {"choices":[{"delta":{"role":"assistant","content":None,"tool_calls":None}}]},
            {"choices":[{"delta":{"content":"hello"}}]},
            {"choices":[{"delta":None,"finish_reason":"stop"}]}))
        self.assertEqual(reply.content,"hello")

    async def test_chat_malformed_shapes_are_controlled(self):
        for event in [None,[],{"choices":[None]}, {"choices":{}},
                      {"choices":[{"delta":[]} ]}, {"choices":[{"delta":{"content":[]}}]},
                      {"choices":[{"delta":{"tool_calls":[None]}}]},
                      {"choices":[{"delta":{"tool_calls":[{"index":[],"function":{}}]}}]},
                      {"choices":[{"delta":{"tool_calls":[{"function":{"arguments":{}}}]}}]},
                      {"choices":[{"message":{"content":[],"tool_calls":None}}]}]:
            with self.subTest(event=event):
                error=await self.request(sse(event,done=True),error="INVALID_RESPONSE")
                self.assertEqual(error._provider_diagnostic["protocol"],"chat")

    async def test_responses_normal_and_malformed_shapes(self):
        reply=await self.request("event: heartbeat\ndata: null\n\n"+sse(
            {"type":"response.output_text.delta","delta":None},
            {"type":"response.output_text.delta","delta":"hello"},
            {"type":"response.completed","response":{"status":"completed","output":[]}}),"responses")
        self.assertEqual(reply.content,"hello")
        for event in [None,{"type":[]},{"type":"response.output_text.delta","delta":{}},
                      {"type":"response.output_item.added","item":None},
                      {"type":"response.function_call_arguments.delta","delta":[]},
                      {"type":"response.completed","response":None},
                      {"type":"response.completed","response":{"output":[None]}},
                      {"type":"response.completed","response":{"output":[{"type":"message","content":[None]}]}}]:
            with self.subTest(event=event):
                await self.request(sse(event),"responses",error="INVALID_RESPONSE")

    async def test_json_response_shapes_and_http400_preserved(self):
        for protocol,body in [("chat",{"choices":[{"message":{"content":["bad"]}}]}),
                              ("responses",{"output_text":[],"output":[]}),
                              ("responses",{"output":[{"type":"function_call","call_id":[],"name":"x","arguments":"{}"}]})]:
            await self.request(json.dumps(body),protocol,error="INVALID_RESPONSE",content_type="application/json")
        e=await self.request('{"error":"secret"}',error="HTTP_400",status=400,content_type="application/json")
        self.assertEqual(e._provider_diagnostic["stage"],"open")

    async def test_error_vs_eof_and_only_allowlisted_metadata(self):
        for protocol in ("chat","responses"):
            event={"type":"response.failed" if protocol=="responses" else "error",
                   "request_id":"req_0123456789abcdef0123456789abcdef",
                   "error":{"code":"rate_limit_exceeded","type":"server_error","message":"DO_NOT_LOG_KEY USER_TEXT Authorization: SECRET_HEADER"}}
            e=await self.request(sse(event),protocol,error="PROVIDER_STREAM_ERROR")
            meta=e._provider_diagnostic
            self.assertEqual(meta["service"]["code"],"rate_limit_exceeded")
            self.assertEqual(meta["events"],1)
            self.assertGreater(meta["responseBytes"],0)
            self.assertNotIn("DO_NOT_LOG",json.dumps(meta))
            self.assertNotIn("USER_TEXT",json.dumps(meta))
            await self.request(sse({"choices":[]} if protocol=="chat" else {"type":"response.created"}),protocol,error="PROVIDER_STREAM_EOF")
        event={"error":{"code":"USER_TEXT","type":"Authorization: SECRET_HEADER","request_id":"DO_NOT_LOG_KEY"}}
        e=await self.request(sse(event),error="PROVIDER_STREAM_ERROR")
        self.assertEqual(e._provider_diagnostic["service"],{"code":"other","type":"other","requestId":"unknown"})
        secret="0123456789abcdef0123456789abcdef"
        e=await self.request(sse({"error":{"request_id":secret}}),error="PROVIDER_STREAM_ERROR",secret=secret)
        self.assertNotIn(secret,json.dumps(e._provider_diagnostic))


class SafeRuntimeDiagnosticTests(unittest.IsolatedAsyncioTestCase):
    async def test_unknown_exception_persisted_once_without_private_text(self):
        service=AgentService(":memory:")
        service.configure("http://127.0.0.1:1/v1","DO_NOT_LOG_KEY")
        class Broken:
            async def complete(self,**kwargs):
                raise TypeError("DO_NOT_LOG_KEY USER_TEXT Authorization SECRET_HEADER")
        service.provider=Broken()
        try:
            with self.assertRaises(TypeError) as caught:
                await service.send("private-model","USER_TEXT",True)
            e=caught.exception;d=e._diagnostic
            self.assertEqual(d["exceptionType"],"TypeError")
            self.assertEqual(d["phase"],"model_request")
            self.assertEqual(d["modelRound"],1)
            self.assertTrue(any(f["module"]=="python_agent.core" for f in d["frames"]))
            self.assertEqual(record_failure(e,service.memory_store,service.conversation_id)["id"],d["id"])
            rows=service.memory_store.db.execute("SELECT details FROM failed_runs").fetchall()
            self.assertEqual(len(rows),1)
            for secret in ("DO_NOT_LOG_KEY","USER_TEXT","SECRET_HEADER","Authorization","private-model","C:","locals"):
                self.assertNotIn(secret,rows[0][0])
            self.assertEqual(service.history,[])
            self.assertEqual(service.memory_store.directory(service.conversation_id),[])
        finally:service.memory_store.db.close()

    async def test_tool_batch_phase_and_diagnostic_storage_failure_do_not_mask(self):
        service=AgentService(":memory:")
        service.configure("http://127.0.0.1:1/v1","synthetic")
        service.provider=ScriptedProvider([ModelReply(tool_calls=(ToolCall("a","missing","{}"),))])
        try:
            with patch("python_agent.core.AgentRunner._read_key",side_effect=KeyError("DO_NOT_LOG_PRIVATE")):
                with self.assertRaises(KeyError) as caught:await service.send("fixture","synthetic",True)
            d=caught.exception._diagnostic
            self.assertEqual((d["phase"],d["modelRound"],d["toolBatchPosition"]),("tool_execute",1,1))
            broken=SimpleNamespace(db=object())
            original=ValueError("DO_NOT_LOG_PRIVATE")
            self.assertFalse(record_failure(original,broken)["stored"])
            self.assertIs(record_failure(original,broken),original._diagnostic)
        finally:service.memory_store.db.close()

    async def test_session_deletion_removes_diagnostics_and_cancel_does_not_commit(self):
        service=AgentService(":memory:")
        service.configure("http://127.0.0.1:1/v1","synthetic")
        class Broken:
            async def complete(self,**kwargs):raise ValueError("private")
        try:
            ids=[]
            for _ in range(2):
                ids.append(service.conversation_id)
                service.provider=Broken()
                with self.assertRaises(ValueError):await service.send("fixture","fixture",True)
                service.provider=OpenAICompatibleProvider("http://127.0.0.1:1/v1","synthetic")
                service.reset()
            service.delete_session(ids[0],True)
            rows=service.memory_store.db.execute("SELECT conversation_id FROM failed_runs").fetchall()
            self.assertEqual([tuple(r) for r in rows],[(ids[1],)])
            entered=asyncio.Event()
            class Waiting:
                async def complete(self,**kwargs):entered.set();await asyncio.Event().wait()
            service.provider=Waiting()
            task=asyncio.create_task(service.send("fixture","private",True))
            await entered.wait();task.cancel()
            with self.assertRaises(asyncio.CancelledError):await task
            self.assertEqual(service.history,[]);self.assertFalse(service.running)
        finally:service.memory_store.db.close()
