import asyncio
import json
import threading
import tempfile
from pathlib import Path
import unittest
from unittest.mock import patch
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from python_agent.core import AgentError, AgentRunner, ChatAgent, ModelProvider, ModelReply, RunnerLimits, ToolCall, ToolRegistry
from test_arithmetic_fixture import ArithmeticFixtureTool
from python_agent.context import ContextError, message_chars, select_context
from python_agent.service import AgentService
from python_agent.provider import MAX_RESPONSE_BYTES, OpenAICompatibleProvider, _ResponsesStream, _parse_chat_event_stream, normalize_base_url


class ProviderHandler(BaseHTTPRequestHandler):
    requests = []

    def log_message(self, _format, *_args):
        pass

    def _record(self):
        length = int(self.headers.get("content-length", "0"))
        body = self.rfile.read(length) if length else b""
        type(self).requests.append((
            self.command,
            self.path,
            self.headers.get("authorization"),
            body,
            self.headers.get("user-agent"),
            self.headers.get("accept"),
        ))

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

    async def complete(self, *, model, messages, tools, on_event=None):
        self.requests.append({"model": model, "messages": list(messages), "tools": list(tools)})
        return next(self.replies)


class PythonAgentRuntimeTests(unittest.IsolatedAsyncioTestCase):
    async def test_tool_duration_retains_submillisecond_precision(self):
        provider = ScriptedProvider([
            ModelReply(tool_calls=(ToolCall("c", "fixture_arithmetic", '{"operator":"multiply","a":2,"b":3}'),)),
            ModelReply("6"),
        ])
        runner = AgentRunner(provider, ToolRegistry([ArithmeticFixtureTool()]))
        # Replace this module's time reference, not the asyncio event loop's clock.
        with patch("python_agent.core.time") as clock:
            clock.monotonic.side_effect = [100.0, 100.000453]
            result = await runner.run(agent=ChatAgent(), history=[{"role": "user", "content": "calculate"}], model="mock")
        self.assertTrue(result.trace[0]["ok"])
        self.assertEqual(result.trace[0]["durationMs"], 0.453)

    async def test_graph_round_limit_does_not_make_extra_request(self):
        reply = ModelReply(tool_calls=(ToolCall("c", "missing", "{}"),))
        provider = ScriptedProvider([reply, reply, ModelReply("must not run")])
        runner = AgentRunner(provider, ToolRegistry(), RunnerLimits(max_model_rounds=2))
        with self.assertRaises(AgentError) as caught:
            await runner.run(agent=ChatAgent(), history=[{"role": "user", "content": "go"}], model="mock")
        self.assertEqual(caught.exception.code, "MODEL_ROUND_LIMIT")
        self.assertEqual(len(provider.requests), 2)

    async def test_graph_disabled_tools_and_reuse_isolate_state(self):
        provider = ScriptedProvider([
            ModelReply(tool_calls=(ToolCall("c", "missing", "{}"),)), ModelReply("fresh"),
        ])
        runner = AgentRunner(provider, ToolRegistry())
        with self.assertRaises(AgentError) as caught:
            await runner.run(agent=ChatAgent(), history=[], model="mock", tools_enabled=False)
        self.assertEqual(caught.exception.code, "TOOLS_DISABLED")
        result = await runner.run(agent=ChatAgent(), history=[], model="mock")
        self.assertEqual(result.rounds, 1)
        self.assertEqual(result.trace, [])
        self.assertEqual(len(result.messages), 2)

    async def test_graph_multiple_tools_leave_input_history_unchanged(self):
        history = [{"role": "user", "content": "中文 😀"}]
        provider = ScriptedProvider([
            ModelReply(tool_calls=tuple(ToolCall(str(i), "fixture_arithmetic", '{"operator":"multiply","a":3,"b":4}') for i in range(2))),
            ModelReply("12"),
        ])
        runner = AgentRunner(provider, ToolRegistry([ArithmeticFixtureTool()]))
        self.assertEqual(set(runner.graph.nodes), {"__start__", "prepare_context", "model", "tools"})
        result = await runner.run(agent=ChatAgent(), history=history, model="mock")
        self.assertEqual(result.tool_calls, 2)
        self.assertEqual([entry["callId"] for entry in result.trace], ["0", "1"])
        self.assertEqual(history, [{"role": "user", "content": "中文 😀"}])

    async def test_graph_cancellation_releases_lock(self):
        entered = asyncio.Event()
        class WaitingProvider(ScriptedProvider):
            async def complete(self, **kwargs):
                entered.set()
                await asyncio.Event().wait()
        runner = AgentRunner(WaitingProvider([]), ToolRegistry())
        task = asyncio.create_task(runner.run(agent=ChatAgent(), history=[], model="mock"))
        await asyncio.wait_for(entered.wait(), 5)
        task.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await task
        runner.provider = ScriptedProvider([ModelReply("continued")])
        result = await runner.run(agent=ChatAgent(), history=[], model="mock")
        self.assertEqual(result.text, "continued")
        self.assertEqual(result.rounds, 1)

    async def test_chat_without_tools(self):
        provider = ScriptedProvider([ModelReply("hello")])
        result = await AgentRunner(provider, ToolRegistry()).run(
            agent=ChatAgent(), history=[{"role": "user", "content": "hi"}], model="mock"
        )
        self.assertEqual(result.text, "hello")
        self.assertEqual(result.rounds, 1)

    async def test_fixture_arithmetic_tool_loop_preserves_call_id(self):
        provider = ScriptedProvider([
            ModelReply(tool_calls=(ToolCall("call-1", "fixture_arithmetic", '{"operator":"multiply","a":123,"b":456}'),)),
            ModelReply("56088"),
        ])
        result = await AgentRunner(provider, ToolRegistry([ArithmeticFixtureTool()])).run(
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
            agent=ChatAgent(), history=[{"role": "user", "content": "go"}], model="mock"
        )
        self.assertFalse(result.trace[0]["ok"])
        self.assertIn("UNKNOWN_TOOL", result.trace[0]["result"])

    async def test_tool_call_limit_is_enforced(self):
        calls = tuple(ToolCall(f"c{i}", "fixture_arithmetic", '{"operator":"add","a":1,"b":1}') for i in range(13))
        runner = AgentRunner(ScriptedProvider([ModelReply(tool_calls=calls)]), ToolRegistry([ArithmeticFixtureTool()]))
        with self.assertRaisesRegex(AgentError, "limit"):
            await runner.run(agent=ChatAgent(), history=[], model="mock")

    async def test_duplicate_tool_call_ids_fail_before_execution(self):
        calls = (
            ToolCall("same", "fixture_arithmetic", '{"operator":"add","a":1,"b":1}'),
            ToolCall("same", "fixture_arithmetic", '{"operator":"add","a":2,"b":2}'),
        )
        runner = AgentRunner(ScriptedProvider([ModelReply(tool_calls=calls)]), ToolRegistry([ArithmeticFixtureTool()]))
        with self.assertRaisesRegex(AgentError, "unique"):
            await runner.run(agent=ChatAgent(), history=[], model="mock")

    async def test_chat_sse_fragments_preserve_tool_call_identity(self):
        parsed = _parse_chat_event_stream(
            'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","function":{"name":"fixture_arithmetic","arguments":"{\\"a\\":"}}]}}]}\n'
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


class ContextSelectionTests(unittest.IsolatedAsyncioTestCase):
    @staticmethod
    def turn(text):
        return [{"role": "user", "content": text}, {"role": "assistant", "content": "ok"}]

    def test_exact_unicode_limit_and_current_exemption(self):
        history = self.turn("中😀" * 49_999)
        current = [{"role": "user", "content": "本" * 110_000}]
        instructions = [{"role": "system", "content": "rule"}]
        selected = select_context(history, current, instructions)
        self.assertEqual(selected.report["historyChars"], 100_000)
        self.assertEqual(selected.report["currentChars"], 110_000)
        self.assertEqual(selected.messages, instructions + history + current)
        self.assertEqual(select_context(history, current, history_limit=99_999).messages, current)

    def test_contiguous_suffix_not_cherry_picked_and_not_mutated(self):
        history = self.turn("old") + self.turn("x" * 100) + self.turn("recent")
        original = json.loads(json.dumps(history))
        selected = select_context(history, [], history_limit=20)
        self.assertEqual(selected.messages, self.turn("recent"))
        self.assertEqual(selected.report["omittedTurns"], 2)
        selected.messages[0]["content"] = "changed"
        self.assertEqual(history, original)

    def test_tool_payload_count_and_atomic_selection(self):
        turn = [{"role": "user", "content": "compute"},
                {"role": "assistant", "content": "", "tool_calls": [
                    {"id": "c", "function": {"name": "fixture_arithmetic", "arguments": "{}"}}]},
                {"role": "tool", "tool_call_id": "c", "content": "123"},
                {"role": "assistant", "content": "done"}]
        size = sum(message_chars(m) for m in turn)
        self.assertEqual(size, 36)
        self.assertEqual(select_context(turn, [], history_limit=size).messages, turn)
        self.assertEqual(select_context(turn, [], history_limit=size - 1).messages, [])
        with self.assertRaises(ContextError):
            select_context([turn[0], turn[2], turn[3]], [])
        with self.assertRaises(ContextError):
            select_context([], turn[:2])
        for malformed in ("bad", [None], [{"id": "c", "function": "bad"}]):
            with self.subTest(malformed=malformed), self.assertRaises(ContextError):
                select_context([], [turn[0], {"role": "assistant", "content": "", "tool_calls": malformed}])
        with self.assertRaises(ContextError):
            select_context(self.turn("question") + [{"role": "assistant", "content": "extra"}], [])

    async def test_graph_reselects_without_losing_archive_or_current_tools(self):
        history = self.turn("old" * 100) + self.turn("new")
        current = {"role": "user", "content": "calculate"}
        provider = ScriptedProvider([
            ModelReply(tool_calls=(ToolCall("c", "fixture_arithmetic", '{"operator":"multiply","a":3,"b":4}'),)),
            ModelReply("12")])
        runner = AgentRunner(provider, ToolRegistry([ArithmeticFixtureTool()]), RunnerLimits(max_history_chars=5))
        result = await runner.run(agent=ChatAgent(), history=[*history, current], model="mock")
        self.assertEqual(result.context_report["historyChars"], 5)
        self.assertGreater(result.context_report["currentChars"], 5)
        for request in provider.requests:
            self.assertEqual(request["messages"][0]["role"], "system")
            self.assertNotIn(history[0], request["messages"])
            self.assertIn(current, request["messages"])
        self.assertEqual(provider.requests[1]["messages"][-1]["tool_call_id"], "c")
        self.assertEqual(result.messages[1:1 + len(history)], history)

    async def test_completed_current_becomes_history_next_run_and_failure_not_committed(self):
        service = AgentService()
        history = self.turn("a" * 60_000) + self.turn("b" * 39_996)
        service.history = history
        provider = ScriptedProvider([ModelReply("answer"), ModelReply("next")])
        service.provider = provider
        first = await service.send("mock", "current", False)
        self.assertEqual(first["context"]["historyChars"], 100_000)
        self.assertEqual(first["history"][:4], history)
        second = await service.send("mock", "again", False)
        self.assertEqual(second["context"]["omittedTurns"], 1)
        self.assertIn({"role": "user", "content": "current"}, provider.requests[1]["messages"])
        committed = list(service.history)
        class FailingProvider(ScriptedProvider):
            async def complete(self, **kwargs):
                raise AgentError("PROVIDER_STREAM_ERROR", "partial stream failed")
        service.provider = FailingProvider([])
        with self.assertRaises(AgentError):
            await service.send("mock", "failed", False)
        self.assertEqual(service.history, committed)


class StreamTerminationTests(unittest.IsolatedAsyncioTestCase):
    async def run_stream(self, wire, protocol, expected_error=None):
        closed = threading.Event()

        class Handler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def log_message(self, *_args):
                pass

            def do_POST(self):
                self.rfile.read(int(self.headers.get("Content-Length", "0")))
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream")
                self.send_header("Connection", "keep-alive")
                self.end_headers()
                self.wfile.write(wire.encode("utf-8"))
                self.wfile.flush()
                # Never send HTTP EOF. Only the client's close can complete this.
                self.connection.settimeout(2)
                try:
                    if self.connection.recv(1) == b"":
                        closed.set()
                except OSError:
                    pass
                self.close_connection = True

        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with tempfile.TemporaryDirectory() as temp:
                service = AgentService(str(Path(temp) / "memory.sqlite3"))
                service.configure(f"http://127.0.0.1:{server.server_port}/v1", "synthetic")
                service.provider.timeout = 0.5
                if protocol == "responses":
                    service.provider._wire_api = "responses"
                service.restore([{"role": "user", "content": "seed"},
                                 {"role": "assistant", "content": "saved"}])
                history = list(service.history)
                before = list(service.memory_store.db.iterdump())
                try:
                    if expected_error:
                        with self.assertRaises(AgentError) as failed:
                            await service.send("mock", "unfinished", False)
                        self.assertEqual(failed.exception.code, expected_error)
                        self.assertEqual(service.history, history)
                        self.assertEqual(list(service.memory_store.db.iterdump()), before)
                    else:
                        result = await service.send("mock", "success", False)
                        self.assertEqual(result["text"], "hello")
                        self.assertEqual(len(service.memory_store.directory(service.conversation_id)), 2)
                    self.assertTrue(await asyncio.to_thread(closed.wait, 1),
                                    "client must release the connection without server EOF")
                finally:
                    service.memory_store.db.close()
        finally:
            await asyncio.to_thread(server.shutdown)
            server.server_close()
            thread.join()

    async def test_success_markers_close_connection_without_http_eof(self):
        delta = 'data: {"choices":[{"delta":{"content":"hello"}}]}\n\n'
        for ending in ('data: [DONE]\n\n',
                       'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n'):
            with self.subTest(ending=ending):
                await self.run_stream(delta + ending, "chat")
        await self.run_stream(
            'data: {"type":"response.output_text.delta","delta":"hello"}\n\n'
            'data: {"type":"response.completed","response":{"status":"completed","output":[]}}\n\n',
            "responses")

    async def test_incomplete_and_failed_streams_never_commit(self):
        delta = 'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'
        for reason in ("length", "content_filter", "unknown"):
            with self.subTest(reason=reason):
                await self.run_stream(delta + "data: " + json.dumps(
                    {"choices": [{"delta": {}, "finish_reason": reason}]}
                ) + "\n\ndata: [DONE]\n\n", "chat", "PROVIDER_INCOMPLETE")
        for kind, response, code in (
            ("response.incomplete", {"status": "incomplete", "incomplete_details": {"reason": "max_output_tokens"}}, "PROVIDER_INCOMPLETE"),
            ("response.incomplete", {"status": "incomplete", "incomplete_details": {"reason": "content_filter"}}, "PROVIDER_INCOMPLETE"),
            ("response.failed", {"status": "failed"}, "PROVIDER_STREAM_ERROR"),
            ("response.completed", {"status": "incomplete"}, "PROVIDER_INCOMPLETE"),
        ):
            with self.subTest(kind=kind, response=response):
                await self.run_stream(
                    'data: {"type":"response.output_text.delta","delta":"partial"}\n\n'
                    + "data: " + json.dumps({"type": kind, "response": response}) + "\n\n",
                    "responses", code)


class PythonProviderTests(unittest.IsolatedAsyncioTestCase):
    def test_responses_stream_assembles_text_and_function_arguments(self):
        events = []
        stream = _ResponsesStream(events.append)
        stream.feed(None, json.dumps({"type": "response.output_text.delta", "delta": "你"}))
        stream.feed(None, json.dumps({"type": "response.output_item.added", "output_index": 1,
                                      "item": {"type": "function_call", "call_id": "c1", "name": "fixture_arithmetic", "arguments": ""}}))
        stream.feed(None, json.dumps({"type": "response.function_call_arguments.delta", "output_index": 1, "delta": "{\"a\":"}))
        stream.feed(None, json.dumps({"type": "response.function_call_arguments.delta", "output_index": 1, "delta": "2}"}))
        stream.feed(None, json.dumps({"type": "response.completed", "response": {"output": []}}))
        result = stream.finish()
        self.assertEqual(result["output_text"], "你")
        self.assertEqual(result["output"][0]["arguments"], '{"a":2}')
        self.assertEqual(events, [{"type": "text_delta", "text": "你"}])

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
        self.assertTrue(all(row[4].startswith("Mozilla/5.0") for row in ProviderHandler.requests[-2:]))
        self.assertTrue(all("application/json" in row[5] for row in ProviderHandler.requests[-2:]))
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
        # Current-turn exemption is not an exemption from whole-request byte safety.
        before = len(ProviderHandler.requests)
        current = [{"role": "user", "content": "😀" * 140_000}]
        selection = select_context([], current)
        with self.assertRaises(AgentError) as caught:
            await provider.complete(model="mock", messages=selection.messages, tools=[])
        self.assertEqual(caught.exception.code, "REQUEST_TOO_LARGE")
        self.assertEqual(len(ProviderHandler.requests), before)

    async def test_url_policy_rejects_plaintext_remote_and_private_literals(self):
        with self.assertRaises(AgentError):
            normalize_base_url("http://example.com/v1")
        with self.assertRaises(AgentError):
            normalize_base_url("https://192.168.1.2/v1")
        with self.assertRaises(AgentError):
            normalize_base_url("https://user:pass@example.com/v1?x=1")


if __name__ == "__main__":
    unittest.main()
