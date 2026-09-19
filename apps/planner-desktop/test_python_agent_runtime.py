import asyncio
import json
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from python_agent.core import AgentError, AgentRunner, ChatAgent, ModelProvider, ModelReply, ToolCall, ToolRegistry
from python_agent.tools import CalculatorTool
from python_agent.provider import MAX_RESPONSE_BYTES, OpenAICompatibleProvider, _parse_chat_event_stream, normalize_base_url


class ProviderHandler(BaseHTTPRequestHandler):
    requests = []

    def log_message(self, _format, *_args):
        pass

    def _record(self):
        length = int(self.headers.get("content-length", "0"))
        body = self.rfile.read(length) if length else b""
        type(self).requests.append((self.command, self.path, self.headers.get("authorization"), body))

    def do_GET(self):
        self._record()
        if self.path == "/v1/redirect":
            self.send_response(302); self.send_header("location", "/v1/models"); self.end_headers(); return
        if self.path == "/v1/oversized":
            self.send_response(200); self.send_header("content-length", str(MAX_RESPONSE_BYTES + 1)); self.end_headers(); return
        self._json(200, {"data": [{"id": "model-b"}, {"id": "model-a"}]})

    def do_POST(self):
        self._record()
        if self.path == "/v1/chat/completions" and getattr(type(self), "responses_only", False):
            self._json(404, {"error": {"message": "missing"}}); return
        if self.path == "/v1/responses":
            self._json(200, {"output_text": "responses-ok", "output": []}); return
        self._json(200, {"choices": [{"message": {"content": "chat-ok"}}]})

    def _json(self, status, value):
        raw = json.dumps(value).encode()
        self.send_response(status); self.send_header("content-type", "application/json"); self.send_header("content-length", str(len(raw))); self.end_headers(); self.wfile.write(raw)


class ScriptedProvider(ModelProvider):
    def __init__(self, replies):
        self.replies = iter(replies)
        self.requests = []

    async def list_models(self):
        return ["mock"]

    async def complete(self, *, model, messages, tools):
        self.requests.append({"model": model, "messages": list(messages), "tools": list(tools)})
        return next(self.replies)


class PythonAgentRuntimeTests(unittest.IsolatedAsyncioTestCase):
    async def test_chat_without_tools(self):
        provider = ScriptedProvider([ModelReply("hello")])
        result = await AgentRunner(provider, ToolRegistry()).run(
            agent=ChatAgent(), history=[{"role": "user", "content": "hi"}], model="mock"
        )
        self.assertEqual(result.text, "hello")
        self.assertEqual(result.rounds, 1)

    async def test_calculator_tool_loop_preserves_call_id(self):
        provider = ScriptedProvider([
            ModelReply(tool_calls=(ToolCall("call-1", "calculator", '{"operator":"multiply","a":123,"b":456}'),)),
            ModelReply("56088"),
        ])
        result = await AgentRunner(provider, ToolRegistry([CalculatorTool()])).run(
            agent=ChatAgent(), history=[{"role": "user", "content": "calculate"}], model="mock"
        )
        self.assertEqual(result.text, "56088")
        self.assertEqual(result.trace[0]["callId"], "call-1")
        self.assertIn("56088", provider.requests[1]["messages"][-1]["content"])

    async def test_unknown_tool_returns_controlled_result(self):
        provider = ScriptedProvider([
            ModelReply(tool_calls=(ToolCall("call-2", "missing", "{}"),)),
            ModelReply("handled"),
        ])
        result = await AgentRunner(provider, ToolRegistry()).run(
            agent=ChatAgent(), history=[], model="mock"
        )
        self.assertFalse(result.trace[0]["ok"])
        self.assertIn("UNKNOWN_TOOL", result.trace[0]["result"])

    async def test_tool_call_limit_is_enforced(self):
        calls = tuple(ToolCall(f"c{i}", "calculator", '{"operator":"add","a":1,"b":1}') for i in range(13))
        runner = AgentRunner(ScriptedProvider([ModelReply(tool_calls=calls)]), ToolRegistry([CalculatorTool()]))
        with self.assertRaisesRegex(AgentError, "limit"):
            await runner.run(agent=ChatAgent(), history=[], model="mock")

    async def test_duplicate_tool_call_ids_fail_before_execution(self):
        calls = (
            ToolCall("same", "calculator", '{"operator":"add","a":1,"b":1}'),
            ToolCall("same", "calculator", '{"operator":"add","a":2,"b":2}'),
        )
        runner = AgentRunner(ScriptedProvider([ModelReply(tool_calls=calls)]), ToolRegistry([CalculatorTool()]))
        with self.assertRaisesRegex(AgentError, "unique"):
            await runner.run(agent=ChatAgent(), history=[], model="mock")

    async def test_chat_sse_fragments_preserve_tool_call_identity(self):
        parsed = _parse_chat_event_stream(
            'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","function":{"name":"calculator","arguments":"{\\"a\\":"}}]}}]}\n'
            'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"1}"}}]}}]}\n'
            'data: [DONE]\n'
        )
        call = parsed["choices"][0]["message"]["tool_calls"][0]
        self.assertEqual(call["id"], "call-1")
        self.assertEqual(call["function"]["arguments"], '{"a":1}')

    async def test_chat_sse_error_rejects_preceding_partial_output(self):
        with self.assertRaisesRegex(AgentError, "during streaming"):
            _parse_chat_event_stream(
                'data: {"choices":[{"delta":{"content":"partial"}}]}\n'
                '\nevent: error\n'
                'data: {"message":"upstream failed"}\n'
                'data: [DONE]\n'
            )


class PythonProviderTests(unittest.IsolatedAsyncioTestCase):
    @classmethod
    def setUpClass(cls):
        ProviderHandler.requests = []
        ProviderHandler.responses_only = False
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), ProviderHandler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base_url = f"http://127.0.0.1:{cls.server.server_port}/v1"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown(); cls.server.server_close(); cls.thread.join(timeout=2)

    async def test_models_and_chat_use_bearer_auth_without_returning_key(self):
        provider = OpenAICompatibleProvider(self.base_url, "test-secret")
        self.assertEqual(await provider.list_models(), ["model-a", "model-b"])
        reply = await provider.complete(model="model-a", messages=[{"role": "user", "content": "hi"}], tools=[])
        self.assertEqual(reply.content, "chat-ok")
        self.assertTrue(all(row[2] == "Bearer test-secret" for row in ProviderHandler.requests[-2:]))
        self.assertNotIn("test-secret", repr(reply))

    async def test_chat_falls_back_to_responses(self):
        ProviderHandler.responses_only = True
        try:
            provider = OpenAICompatibleProvider(self.base_url, "secret")
            reply = await provider.complete(model="model-a", messages=[], tools=[])
            self.assertEqual(reply.content, "responses-ok")
        finally:
            ProviderHandler.responses_only = False

    async def test_redirect_and_declared_oversize_are_rejected(self):
        provider = OpenAICompatibleProvider(self.base_url, "secret")
        with self.assertRaisesRegex(AgentError, "Redirect"):
            await provider._request("/redirect")
        with self.assertRaisesRegex(AgentError, "too large"):
            await provider._request("/oversized")

    async def test_url_policy_rejects_plaintext_remote_and_private_literals(self):
        with self.assertRaises(AgentError):
            normalize_base_url("http://example.com/v1")
        with self.assertRaises(AgentError):
            normalize_base_url("https://192.168.1.2/v1")
        with self.assertRaises(AgentError):
            normalize_base_url("https://user:pass@example.com/v1?x=1")


if __name__ == "__main__":
    unittest.main()
