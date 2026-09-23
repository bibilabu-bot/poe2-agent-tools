"""Request-local retries for agent retrieval, never model turns or index builds."""
from __future__ import annotations

import asyncio
from contextlib import contextmanager
from contextvars import ContextVar
import http.client
import math
import socket
import ssl
import time
import urllib.error

from .core import AgentError

_deadline: ContextVar[float | None] = ContextVar("retrieval_deadline", default=None)
_RETRY_CODES = {"HTTP_408", "HTTP_429", "HTTP_500", "HTTP_502", "HTTP_503", "HTTP_504", "PROVIDER_TIMEOUT"}
_BACKOFF = (0.25, 0.75)


@contextmanager
def retrieval_budget(remaining_ms: float | None = None):
    """Electron owns the 300s run budget; nested scopes cannot extend it."""
    if remaining_ms is None:
        remaining_ms = 300_000
    if type(remaining_ms) not in (int, float) or not math.isfinite(remaining_ms):
        raise AgentError("INVALID_DEADLINE", "无效的检索运行预算")
    deadline = time.monotonic() + max(0, min(300_000, remaining_ms)) / 1000
    parent = _deadline.get()
    token = _deadline.set(min(parent, deadline) if parent is not None else deadline)
    try:
        yield
    finally:
        _deadline.reset(token)


def _transient(error: Exception) -> bool:
    if isinstance(error, AgentError):
        if error.code in _RETRY_CODES:
            return True
        if error.code != "NETWORK_ERROR":
            return False
        error = error.__cause__
    if isinstance(error, urllib.error.URLError):
        error = error.reason
    if isinstance(error, ssl.SSLCertVerificationError):
        return False
    if isinstance(error, socket.gaierror):
        return error.errno == socket.EAI_AGAIN
    return isinstance(error, (TimeoutError, ConnectionError, http.client.IncompleteRead, ssl.SSLEOFError))


async def request_with_retry(http, path, body, stage: str):
    deadline = _deadline.get()
    if deadline is None:
        # Index builds/connection probes retain their existing single-attempt policy.
        return await http._request(path, body)
    deadline = min(deadline, time.monotonic() + 90)
    label = "向量" if stage == "embedding" else "重排序"
    for attempt in range(3):
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise AgentError("RUN_TIMEOUT", f"{label}请求剩余预算不足，已停止")
        timeout = asyncio.timeout(remaining)
        try:
            async with timeout:
                return await http._request(path, body)
        except asyncio.CancelledError:
            raise
        except Exception as error:
            if timeout.expired():
                # Do not retry an abandoned to_thread request after its deadline.
                raise AgentError("RUN_TIMEOUT", f"{label}请求预算已耗尽，已停止") from None
            if not _transient(error) or attempt == 2:
                code = error.code if isinstance(error, AgentError) else "RAG_TRANSPORT_ERROR"
                # Never propagate raw transport text, request data, headers or bodies.
                raise AgentError(code, f"{label}请求失败，已尝试 {attempt + 1} 次") from None
            delay = _BACKOFF[attempt]
            if deadline - time.monotonic() <= delay:
                raise AgentError("RUN_TIMEOUT", f"{label}请求剩余预算不足，未发起重试") from None
            await asyncio.sleep(delay)
