"""Bounded OpenAI-compatible HTTP provider using the Python standard library."""

from __future__ import annotations

import asyncio
import ipaddress
import json
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Callable, Mapping, Sequence

from .core import AgentError, ModelProvider, ModelReply, ToolCall

MAX_REQUEST_BYTES = 512 * 1024
MAX_RESPONSE_BYTES = 2 * 1024 * 1024
DESKTOP_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36"
)


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
    def __init__(self, base_url: str, api_key: str, timeout: float = 90.0, accept: str = "application/json, text/event-stream") -> None:
        self.base_url = normalize_base_url(base_url)
        if not api_key or len(api_key) > 4096:
            raise AgentError("INVALID_API_KEY", "API Key is invalid")
        self._api_key = api_key
        self.timeout = timeout
        self.accept = accept
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
        on_event: Callable[[dict[str, Any]], None] | None = None,
    ) -> ModelReply:
        if self._wire_api == "responses":
            return await self._complete_responses(model, messages, tools, on_event)
        body: dict[str, Any] = {"model": model, "messages": list(messages), "stream": True}
        if tools:
            body.update({"tools": list(tools), "tool_choice": "auto"})
        try:
            data = await self._request_stream("/chat/completions", body, "chat", on_event)
        except AgentError as error:
            if error.code not in {"HTTP_404", "HTML_RESPONSE"}:
                raise
            self._wire_api = "responses"
            return await self._complete_responses(model, messages, tools, on_event)
        try:
            _check_chat_finish(data["choices"][0].get("finish_reason"))
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
        on_event: Callable[[dict[str, Any]], None] | None = None,
    ) -> ModelReply:
        body: dict[str, Any] = {"model": model, "input": _responses_input(messages), "stream": True}
        if tools:
            body["tools"] = [
                {"type": "function", **tool["function"]}
                for tool in tools
            ]
        data = await self._request_stream("/responses", body, "responses", on_event)
        _check_response_status(data)
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
        try:
            return await asyncio.to_thread(self._request_sync, path, body)
        except TimeoutError as error:
            raise AgentError("PROVIDER_TIMEOUT", "Model service stopped responding before completion") from error

    async def _request_stream(self, path: str, body: Mapping[str, Any], protocol: str,
                              on_event: Callable[[dict[str, Any]], None] | None) -> Any:
        try:
            return await asyncio.to_thread(self._request_stream_sync, path, body, protocol, on_event)
        except TimeoutError as error:
            raise AgentError("PROVIDER_TIMEOUT", "Model service stopped responding before completion") from error

    def _make_request(self, path: str, encoded: bytes | None) -> urllib.request.Request:
        return urllib.request.Request(
            f"{self.base_url}{path}", data=encoded,
            method="POST" if encoded is not None else "GET",
            headers={"Authorization": f"Bearer {self._api_key}", "Content-Type": "application/json",
                     "Accept": self.accept, "User-Agent": DESKTOP_USER_AGENT},
        )

    def _open(self, request: urllib.request.Request):
        try:
            return urllib.request.build_opener(_NoRedirect()).open(request, timeout=self.timeout)
        except urllib.error.HTTPError as error:
            if 300 <= error.code < 400:
                raise AgentError("REDIRECT_BLOCKED", "Redirect blocked to protect the API Key") from error
            raise AgentError(f"HTTP_{error.code}", f"Service request failed (HTTP {error.code})") from error
        except (urllib.error.URLError, TimeoutError) as error:
            raise AgentError("NETWORK_ERROR", "Unable to connect to the model service") from error

    def _request_stream_sync(self, path: str, body: Mapping[str, Any], protocol: str,
                             on_event: Callable[[dict[str, Any]], None] | None) -> Any:
        encoded = json.dumps(body, ensure_ascii=False).encode("utf-8")
        if len(encoded) > MAX_REQUEST_BYTES:
            raise AgentError("REQUEST_TOO_LARGE", "Request context exceeds the safe limit")
        with self._open(self._make_request(path, encoded)) as response:
            content_type = response.headers.get("Content-Type", "").lower()
            if "text/event-stream" not in content_type:
                raw = response.read(MAX_RESPONSE_BYTES + 1)
                if len(raw) > MAX_RESPONSE_BYTES:
                    raise AgentError("RESPONSE_TOO_LARGE", "Service response is too large")
                try:
                    text = raw.decode("utf-8", errors="strict")
                    if text.lstrip().lower().startswith(("<!doctype html", "<html")):
                        raise AgentError("HTML_RESPONSE", "Service returned HTML instead of an API response")
                    return json.loads(text)
                except (UnicodeDecodeError, json.JSONDecodeError) as error:
                    raise AgentError("INVALID_RESPONSE", "Service returned invalid JSON") from error
            parser = _ChatStream(on_event) if protocol == "chat" else _ResponsesStream(on_event)
            total = 0
            event_name: str | None = None
            data_lines: list[str] = []
            while True:
                raw_line = response.readline(MAX_RESPONSE_BYTES + 1)
                if not raw_line:
                    break
                total += len(raw_line)
                if total > MAX_RESPONSE_BYTES:
                    raise AgentError("RESPONSE_TOO_LARGE", "Service response is too large")
                try:
                    line = raw_line.decode("utf-8", errors="strict").rstrip("\r\n")
                except UnicodeDecodeError as error:
                    raise AgentError("INVALID_RESPONSE", "Service returned invalid UTF-8 event data") from error
                if not line:
                    if data_lines:
                        payload = "\n".join(data_lines)
                        if payload == "[DONE]":
                            parser.mark_done()
                        else:
                            parser.feed(event_name, payload)
                    event_name, data_lines = None, []
                    if parser.is_terminal:
                        return parser.finish()
                elif line.startswith("event:"):
                    event_name = line[6:].strip()
                elif line.startswith("data:"):
                    data_lines.append(line[5:].lstrip())
            if data_lines:
                payload = "\n".join(data_lines)
                if payload == "[DONE]": parser.mark_done()
                else: parser.feed(event_name, payload)
            return parser.finish()

    def _request_sync(self, path: str, body: Mapping[str, Any] | None) -> Any:
        encoded = json.dumps(body, ensure_ascii=False).encode("utf-8") if body is not None else None
        if encoded and len(encoded) > MAX_REQUEST_BYTES:
            raise AgentError("REQUEST_TOO_LARGE", "Request context exceeds the safe limit")
        try:
            with self._open(self._make_request(path, encoded)) as response:
                declared = int(response.headers.get("Content-Length", "0") or 0)
                if declared > MAX_RESPONSE_BYTES:
                    raise AgentError("RESPONSE_TOO_LARGE", "Service response is too large")
                raw = response.read(MAX_RESPONSE_BYTES + 1)
        except AgentError:
            raise
        if len(raw) > MAX_RESPONSE_BYTES:
            raise AgentError("RESPONSE_TOO_LARGE", "Service response is too large")
        text = raw.decode("utf-8", errors="strict")
        if text.lstrip().lower().startswith(("<!doctype html", "<html")):
            raise AgentError("HTML_RESPONSE", "Service returned HTML instead of an API response")
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            if self.accept == "application/json":
                raise AgentError("INVALID_RESPONSE", "Service returned invalid JSON") from None
            return _parse_chat_event_stream(text)


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: ANN001, ANN201
        return None


def _check_chat_finish(reason: Any) -> None:
    # Missing finish_reason remains compatible with legacy JSON / [DONE] relays.
    if reason is not None and reason not in ("stop", "tool_calls"):
        raise AgentError("PROVIDER_INCOMPLETE", "Model response ended without successful completion")


def _check_response_status(response: Any) -> None:
    if not isinstance(response, dict):
        raise AgentError("INVALID_RESPONSE", "Service returned an invalid response")
    if (response.get("status") not in (None, "completed")
            or response.get("incomplete_details") or response.get("error")):
        raise AgentError("PROVIDER_INCOMPLETE", "Model response ended without successful completion")


class _ChatStream:
    def __init__(self, on_event: Callable[[dict[str, Any]], None] | None) -> None:
        self.on_event = on_event
        self.content: list[str] = []
        self.calls: dict[int, dict[str, Any]] = {}
        self.saw_event = False
        self.completed = False

    def mark_done(self) -> None:
        self.completed = True

    @property
    def is_terminal(self) -> bool:
        return self.completed

    def feed(self, event_name: str | None, payload: str) -> None:
        try:
            event = json.loads(payload)
        except json.JSONDecodeError as error:
            raise AgentError("INVALID_RESPONSE", "Service returned invalid event data") from error
        self.saw_event = True
        if event_name == "error" or event.get("error") or event.get("type") in {"error", "response.failed"}:
            raise AgentError("PROVIDER_STREAM_ERROR", "Service reported an error during streaming")
        choices = event.get("choices", [])
        if not choices:
            return
        if choices[0].get("finish_reason") is not None:
            _check_chat_finish(choices[0]["finish_reason"])
            self.completed = True
        message = choices[0].get("message")
        if isinstance(message, dict):
            text = message.get("content") or ""
            if text:
                self.content.append(text)
                self._delta(text)
            for index, call in enumerate(message.get("tool_calls", [])):
                self.calls[index] = call
            return
        delta = choices[0].get("delta", {})
        text = delta.get("content")
        if isinstance(text, str) and text:
            self.content.append(text)
            self._delta(text)
        for call in delta.get("tool_calls", []):
            index = call.get("index", len(self.calls))
            current = self.calls.setdefault(index, {"id": "", "type": "function", "function": {"name": "", "arguments": ""}})
            if isinstance(call.get("id"), str): current["id"] = call["id"]
            function = call.get("function", {})
            if isinstance(function.get("name"), str): current["function"]["name"] += function["name"]
            if isinstance(function.get("arguments"), str): current["function"]["arguments"] += function["arguments"]

    def _delta(self, text: str) -> None:
        if self.on_event:
            for offset in range(0, len(text), 4096):
                self.on_event({"type": "text_delta", "text": text[offset:offset + 4096]})

    def finish(self) -> dict[str, Any]:
        if not self.saw_event or not self.completed:
            raise AgentError("PROVIDER_STREAM_ERROR", "Service stream ended before completion")
        return {"choices": [{"message": {"role": "assistant", "content": "".join(self.content),
                                           "tool_calls": [self.calls[key] for key in sorted(self.calls)]}}]}


class _ResponsesStream:
    def __init__(self, on_event: Callable[[dict[str, Any]], None] | None) -> None:
        self.on_event = on_event
        self.text: list[str] = []
        self.calls: dict[str, dict[str, Any]] = {}
        self.completed: dict[str, Any] | None = None
        self.saw_event = False

    def mark_done(self) -> None:
        # Responses streams use response.completed as their authoritative terminator.
        return

    @property
    def is_terminal(self) -> bool:
        return self.completed is not None

    def feed(self, event_name: str | None, payload: str) -> None:
        try:
            event = json.loads(payload)
        except json.JSONDecodeError as error:
            raise AgentError("INVALID_RESPONSE", "Service returned invalid event data") from error
        self.saw_event = True
        kind = event.get("type") or event_name
        if kind == "response.incomplete":
            raise AgentError("PROVIDER_INCOMPLETE", "Model response ended without successful completion")
        if kind in {"error", "response.failed"} or event.get("error"):
            raise AgentError("PROVIDER_STREAM_ERROR", "Service reported an error during streaming")
        if kind == "response.output_text.delta" and isinstance(event.get("delta"), str):
            self.text.append(event["delta"])
            if self.on_event:
                for offset in range(0, len(event["delta"]), 4096):
                    self.on_event({"type": "text_delta", "text": event["delta"][offset:offset + 4096]})
        elif kind == "response.output_item.added":
            item = event.get("item", {})
            if item.get("type") == "function_call":
                key = str(event.get("output_index", len(self.calls)))
                self.calls[key] = {"type": "function_call", "call_id": item.get("call_id", ""),
                                   "name": item.get("name", ""), "arguments": item.get("arguments", "")}
        elif kind == "response.function_call_arguments.delta":
            key = str(event.get("output_index", "0"))
            call = self.calls.setdefault(key, {"type": "function_call", "call_id": event.get("call_id", ""),
                                               "name": event.get("name", ""), "arguments": ""})
            if isinstance(event.get("delta"), str): call["arguments"] += event["delta"]
        elif kind == "response.completed":
            _check_response_status(event.get("response"))
            self.completed = event["response"]

    def finish(self) -> dict[str, Any]:
        if not self.saw_event or self.completed is None:
            raise AgentError("PROVIDER_STREAM_ERROR", "Service stream ended before completion")
        output = list(self.completed.get("output", []))
        known = {item.get("call_id") for item in output if isinstance(item, dict)}
        output.extend(call for call in self.calls.values() if call.get("call_id") not in known)
        return {**self.completed, "output_text": "".join(self.text) or self.completed.get("output_text", ""), "output": output}


def _parse_chat_event_stream(text: str) -> dict[str, Any]:
    records: list[tuple[str | None, str]] = []
    event_name: str | None = None
    for line in text.splitlines():
        if not line:
            event_name = None
        elif line.startswith("event:"):
            event_name = line[6:].strip()
        elif line.startswith("data:"):
            payload = line[5:].strip()
            if payload not in {"", "[DONE]"}:
                records.append((event_name, payload))
    if not records:
        raise AgentError("INVALID_RESPONSE", "Service returned invalid JSON")
    try:
        events = [(event_name, json.loads(payload)) for event_name, payload in records]
    except json.JSONDecodeError as error:
        raise AgentError("INVALID_RESPONSE", "Service returned invalid event data") from error
    if any(
        event_name == "error"
        or (
            isinstance(event, dict)
            and (event.get("error") or event.get("type") in {"error", "response.failed"})
        )
        for event_name, event in events
    ):
        raise AgentError("PROVIDER_STREAM_ERROR", "Service reported an error during streaming")
    content: list[str] = []
    calls: dict[int, dict[str, Any]] = {}
    for _, event in events:
        choices = event.get("choices", []) if isinstance(event, dict) else []
        if not choices:
            continue
        _check_chat_finish(choices[0].get("finish_reason"))
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
