"""Bounded OpenAI-compatible HTTP provider using the Python standard library."""

from __future__ import annotations

import asyncio
import ipaddress
import json
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Mapping, Sequence

from .core import AgentError, ModelProvider, ModelReply, ToolCall

MAX_REQUEST_BYTES = 512 * 1024
MAX_RESPONSE_BYTES = 2 * 1024 * 1024


def normalize_base_url(value: str) -> str:
    parsed = urllib.parse.urlsplit(value)
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise AgentError("INVALID_BASE_URL", "API address contains forbidden URL components")
    loopback = parsed.hostname in {"localhost", "127.0.0.1", "::1"}
    if parsed.scheme != "https" and not (parsed.scheme == "http" and loopback):
        raise AgentError("INVALID_BASE_URL", "Only HTTPS or HTTP loopback is allowed")
    if not parsed.hostname:
        raise AgentError("INVALID_BASE_URL", "API address is invalid")
    try:
        address = ipaddress.ip_address(parsed.hostname)
        if not loopback and not address.is_global:
            raise AgentError("INVALID_BASE_URL", "Private and link-local IP addresses are blocked")
    except ValueError:
        pass
    path = parsed.path.rstrip("/")
    return urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, path, "", ""))


class OpenAICompatibleProvider(ModelProvider):
    def __init__(self, base_url: str, api_key: str, timeout: float = 90.0) -> None:
        self.base_url = normalize_base_url(base_url)
        if not api_key or len(api_key) > 4096:
            raise AgentError("INVALID_API_KEY", "API Key is invalid")
        self._api_key = api_key
        self.timeout = timeout
        self._wire_api: str | None = None

    def clear_secret(self) -> None:
        self._api_key = ""

    async def list_models(self) -> list[str]:
        data = await self._request("/models")
        rows = data.get("data") if isinstance(data, dict) else None
        if not isinstance(rows, list):
            raise AgentError("INVALID_RESPONSE", "Model-list response is incompatible")
        return sorted(
            row["id"] for row in rows[:500]
            if isinstance(row, dict) and isinstance(row.get("id"), str) and len(row["id"]) <= 256
        )

    async def complete(
        self,
        *,
        model: str,
        messages: Sequence[Mapping[str, Any]],
        tools: Sequence[Mapping[str, Any]],
    ) -> ModelReply:
        if self._wire_api == "responses":
            return await self._complete_responses(model, messages, tools)
        body: dict[str, Any] = {"model": model, "messages": list(messages), "stream": False}
        if tools:
            body.update({"tools": list(tools), "tool_choice": "auto"})
        try:
            data = await self._request("/chat/completions", body)
        except AgentError as error:
            if error.code not in {"HTTP_404", "HTML_RESPONSE"}:
                raise
            self._wire_api = "responses"
            return await self._complete_responses(model, messages, tools)
        try:
            message = data["choices"][0]["message"]
            calls = tuple(
                ToolCall(call["id"], call["function"]["name"], call["function"]["arguments"])
                for call in message.get("tool_calls", [])
            )
            content = message.get("content") or ""
        except (KeyError, IndexError, TypeError) as error:
            raise AgentError("INVALID_RESPONSE", "Chat response is incompatible") from error
        if not content.strip() and not calls:
            raise AgentError("EMPTY_RESPONSE", "Service returned an empty response")
        return ModelReply(content, calls)

    async def _complete_responses(
        self,
        model: str,
        messages: Sequence[Mapping[str, Any]],
        tools: Sequence[Mapping[str, Any]],
    ) -> ModelReply:
        body: dict[str, Any] = {"model": model, "input": _responses_input(messages), "stream": False}
        if tools:
            body["tools"] = [
                {"type": "function", **tool["function"]}
                for tool in tools
            ]
        data = await self._request("/responses", body)
        output = data.get("output", []) if isinstance(data, dict) else []
        text = data.get("output_text", "") if isinstance(data, dict) else ""
        if not text:
            text = "".join(
                content.get("text", "")
                for item in output if item.get("type") == "message"
                for content in item.get("content", []) if content.get("type") == "output_text"
            )
        calls = tuple(
            ToolCall(item.get("call_id", ""), item.get("name", ""), item.get("arguments", ""))
            for item in output if item.get("type") == "function_call"
        )
        if not text.strip() and not calls:
            raise AgentError("EMPTY_RESPONSE", "Service returned an empty response")
        return ModelReply(text, calls)

    async def _request(self, path: str, body: Mapping[str, Any] | None = None) -> Any:
        return await asyncio.to_thread(self._request_sync, path, body)

    def _request_sync(self, path: str, body: Mapping[str, Any] | None) -> Any:
        encoded = json.dumps(body, ensure_ascii=False).encode("utf-8") if body is not None else None
        if encoded and len(encoded) > MAX_REQUEST_BYTES:
            raise AgentError("REQUEST_TOO_LARGE", "Request context exceeds the safe limit")
        request = urllib.request.Request(
            f"{self.base_url}{path}",
            data=encoded,
            method="POST" if encoded is not None else "GET",
            headers={"Authorization": f"Bearer {self._api_key}", "Content-Type": "application/json"},
        )
        opener = urllib.request.build_opener(_NoRedirect())
        try:
            with opener.open(request, timeout=self.timeout) as response:
                declared = int(response.headers.get("Content-Length", "0") or 0)
                if declared > MAX_RESPONSE_BYTES:
                    raise AgentError("RESPONSE_TOO_LARGE", "Service response is too large")
                raw = response.read(MAX_RESPONSE_BYTES + 1)
        except urllib.error.HTTPError as error:
            if 300 <= error.code < 400:
                raise AgentError("REDIRECT_BLOCKED", "Redirect blocked to protect the API Key") from error
            raise AgentError(f"HTTP_{error.code}", f"Service request failed (HTTP {error.code})") from error
        except urllib.error.URLError as error:
            raise AgentError("NETWORK_ERROR", "Unable to connect to the model service") from error
        if len(raw) > MAX_RESPONSE_BYTES:
            raise AgentError("RESPONSE_TOO_LARGE", "Service response is too large")
        text = raw.decode("utf-8", errors="strict")
        if text.lstrip().lower().startswith(("<!doctype html", "<html")):
            raise AgentError("HTML_RESPONSE", "Service returned HTML instead of an API response")
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            return _parse_chat_event_stream(text)


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: ANN001, ANN201
        return None


def _parse_chat_event_stream(text: str) -> dict[str, Any]:
    payloads = [
        line[5:].strip()
        for line in text.splitlines()
        if line.startswith("data:") and line[5:].strip() not in {"", "[DONE]"}
    ]
    if not payloads:
        raise AgentError("INVALID_RESPONSE", "Service returned invalid JSON")
    try:
        events = [json.loads(payload) for payload in payloads]
    except json.JSONDecodeError as error:
        raise AgentError("INVALID_RESPONSE", "Service returned invalid event data") from error
    content: list[str] = []
    calls: dict[int, dict[str, Any]] = {}
    for event in events:
        choices = event.get("choices", []) if isinstance(event, dict) else []
        if not choices:
            continue
        if isinstance(choices[0].get("message"), dict):
            return event
        delta = choices[0].get("delta", {})
        if isinstance(delta.get("content"), str):
            content.append(delta["content"])
        for call in delta.get("tool_calls", []):
            index = call.get("index", len(calls))
            current = calls.setdefault(index, {"id": "", "type": "function", "function": {"name": "", "arguments": ""}})
            if isinstance(call.get("id"), str):
                current["id"] = call["id"]
            function = call.get("function", {})
            if isinstance(function.get("name"), str):
                current["function"]["name"] += function["name"]
            if isinstance(function.get("arguments"), str):
                current["function"]["arguments"] += function["arguments"]
    return {"choices": [{"message": {"role": "assistant", "content": "".join(content), "tool_calls": list(calls.values())}}]}


def _responses_input(messages: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for message in messages:
        if message.get("role") == "tool":
            result.append({"type": "function_call_output", "call_id": message.get("tool_call_id"), "output": message.get("content", "")})
        elif message.get("role") == "assistant" and isinstance(message.get("tool_calls"), list):
            if message.get("content"):
                result.append({"role": "assistant", "content": message["content"]})
            for call in message["tool_calls"]:
                result.append({"type": "function_call", "call_id": call.get("id"), "name": call.get("function", {}).get("name"), "arguments": call.get("function", {}).get("arguments")})
        else:
            result.append({"role": message.get("role"), "content": message.get("content", "")})
    return result
