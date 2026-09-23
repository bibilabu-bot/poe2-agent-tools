"""Offline retry/deadline/privacy tests; never connect to a hosted service."""
import asyncio
import socket
import ssl
import unittest
import urllib.error
from unittest.mock import AsyncMock, patch

from python_agent.core import AgentError
from python_agent.rag import RetrievalProvider
from python_agent.retrieval_retry import request_with_retry, retrieval_budget


class RetryTests(unittest.IsolatedAsyncioTestCase):
    async def test_transient_recovers_and_stops_after_three_attempts(self):
        for code in ("HTTP_408", "HTTP_429", "HTTP_500", "HTTP_502", "HTTP_503", "HTTP_504", "PROVIDER_TIMEOUT"):
            http=type("Http",(),{})()
            http._request=AsyncMock(side_effect=[AgentError(code,"secret"), {"ok":True}])
            with retrieval_budget(10000), patch("python_agent.retrieval_retry.asyncio.sleep",new_callable=AsyncMock) as sleep:
                self.assertEqual(await request_with_retry(http,"/fixture",{},"embedding"),{"ok":True})
                self.assertEqual(http._request.await_count,2)
                sleep.assert_awaited_once_with(0.25)
            http._request=AsyncMock(side_effect=AgentError(code,"secret"))
            with retrieval_budget(10000), patch("python_agent.retrieval_retry.asyncio.sleep",new_callable=AsyncMock) as sleep:
                with self.assertRaises(AgentError) as raised:
                    await request_with_retry(http,"/fixture",{},"rerank")
                self.assertEqual(http._request.await_count,3)
                self.assertEqual(sleep.await_count,2)
                self.assertNotIn("secret",str(raised.exception))
                self.assertIn("重排序",str(raised.exception))

    async def test_permanent_http_errors_do_not_retry(self):
        for code in ("HTTP_400","HTTP_401","HTTP_403","HTTP_404","HTTP_501","RAG_VECTOR","RAG_ENDPOINT"):
            http=type("Http",(),{})();http._request=AsyncMock(side_effect=AgentError(code,"sk-PRIVATE query"))
            with retrieval_budget(10000), patch("python_agent.retrieval_retry.asyncio.sleep",new_callable=AsyncMock) as sleep:
                with self.assertRaises(AgentError) as raised:
                    await request_with_retry(http,"/fixture",{},"embedding")
                self.assertEqual(raised.exception.code,code)
                self.assertNotIn("PRIVATE",str(raised.exception))
                self.assertEqual(http._request.await_count,1);sleep.assert_not_awaited()

    async def test_transport_classification_and_no_certificate_retry(self):
        for cause,retries in [(ConnectionResetError("private"),True),
                              (socket.gaierror(socket.EAI_AGAIN,"private"),True),
                              (socket.gaierror(socket.EAI_NONAME,"private"),False),
                              (ssl.SSLCertVerificationError("private"),False)]:
            error=AgentError("NETWORK_ERROR","private");error.__cause__=urllib.error.URLError(cause)
            http=type("Http",(),{})();http._request=AsyncMock(side_effect=error)
            with retrieval_budget(10000), patch("python_agent.retrieval_retry.asyncio.sleep",new_callable=AsyncMock):
                with self.assertRaises(AgentError):await request_with_retry(http,"/fixture",{},"embedding")
                self.assertEqual(http._request.await_count,3 if retries else 1)

    async def test_raw_connection_interruption_is_redacted(self):
        http=type("Http",(),{})();http._request=AsyncMock(side_effect=ConnectionResetError("sk-PRIVATE"))
        with retrieval_budget(10000), patch("python_agent.retrieval_retry.asyncio.sleep",new_callable=AsyncMock):
            with self.assertRaises(AgentError) as raised:await request_with_retry(http,"/fixture",{},"embedding")
            self.assertEqual(http._request.await_count,3)
            self.assertNotIn("PRIVATE",str(raised.exception))

    async def test_expired_budget_and_backoff_cannot_extend_deadline(self):
        http=type("Http",(),{})();http._request=AsyncMock(side_effect=AgentError("HTTP_503","private"))
        with retrieval_budget(0):
            with self.assertRaises(AgentError) as raised:await request_with_retry(http,"/fixture",{},"embedding")
            self.assertEqual(raised.exception.code,"RUN_TIMEOUT");http._request.assert_not_awaited()
        with retrieval_budget(100), patch("python_agent.retrieval_retry.asyncio.sleep",new_callable=AsyncMock) as sleep:
            with self.assertRaises(AgentError) as raised:await request_with_retry(http,"/fixture",{},"embedding")
            self.assertEqual(raised.exception.code,"RUN_TIMEOUT")
            self.assertEqual(http._request.await_count,1);sleep.assert_not_awaited()

    async def test_inflight_deadline_does_not_start_another_attempt(self):
        http=type("Http",(),{})();cancelled=asyncio.Event()
        async def blocked(*_):
            try:await asyncio.Event().wait()
            finally:cancelled.set()
        http._request=AsyncMock(side_effect=blocked)
        with retrieval_budget(25):
            with self.assertRaises(AgentError) as raised:await request_with_retry(http,"/fixture",{},"embedding")
            self.assertEqual(raised.exception.code,"RUN_TIMEOUT")
            self.assertTrue(cancelled.is_set());self.assertEqual(http._request.await_count,1)

    async def test_cancel_during_backoff_and_request_does_not_retry(self):
        for in_request in (False,True):
            gate=asyncio.Event()
            async def blocked(*_):gate.set();await asyncio.Event().wait()
            http=type("Http",(),{})()
            http._request=AsyncMock(side_effect=blocked if in_request else AgentError("HTTP_503","private"))
            with retrieval_budget(10000), patch("python_agent.retrieval_retry.asyncio.sleep",side_effect=blocked):
                task=asyncio.create_task(request_with_retry(http,"/fixture",{},"embedding"))
                await gate.wait();task.cancel()
                with self.assertRaises(asyncio.CancelledError):await task
                self.assertEqual(http._request.await_count,1)

    async def test_rerank_retry_does_not_repeat_embedding(self):
        profile={"baseUrl":"http://127.0.0.1","model":"fixture","dimensions":2,"apiKey":"synthetic"}
        provider=RetrievalProvider({"embedding":profile,"reranker":profile})
        provider.embed_http._request=AsyncMock(return_value={"data":[{"index":0,"embedding":[1,0]}]})
        provider.rank_http._request=AsyncMock(side_effect=[AgentError("HTTP_503","private"),{"results":[{"index":0,"relevance_score":1}]}])
        with retrieval_budget(10000), patch("python_agent.retrieval_retry.asyncio.sleep",new_callable=AsyncMock):
            await provider.embed(["fixture"]);await provider.rerank("fixture",["fixture"])
        self.assertEqual(provider.embed_http._request.await_count,1)
        self.assertEqual(provider.rank_http._request.await_count,2)

    async def test_no_budget_preserves_non_agent_single_attempt(self):
        http=type("Http",(),{})();http._request=AsyncMock(side_effect=AgentError("HTTP_503","fixture"))
        with self.assertRaises(AgentError):await request_with_retry(http,"/fixture",{},"embedding")
        self.assertEqual(http._request.await_count,1)

    async def test_nested_budget_cannot_extend_parent_and_resets_after_exit(self):
        http=type("Http",(),{})();http._request=AsyncMock(return_value={"ok":True})
        with retrieval_budget(0), retrieval_budget(999999999):
            with self.assertRaises(AgentError):await request_with_retry(http,"/fixture",{},"embedding")
        self.assertEqual(await request_with_retry(http,"/fixture",{},"embedding"),{"ok":True})
        self.assertEqual(http._request.await_count,1)

    async def test_service_and_rpc_forward_budget_without_changing_tool_schema(self):
        from python_agent.service import AgentService
        from python_agent.rpc_server import dispatch
        service=AgentService()
        http=type("Http",(),{})();http._request=AsyncMock(return_value={"ok":True})
        async def send_probe(*_):return await request_with_retry(http,"/fixture",{},"embedding")
        service._send=send_probe
        with self.assertRaises(AgentError) as raised:
            await dispatch(service,"send",{"_remainingMs":0})
        self.assertEqual(raised.exception.code,"RUN_TIMEOUT")
        http._request.assert_not_awaited()
        self.assertFalse(service.running)
        self.assertIsNone(service._tree_write_callback)
