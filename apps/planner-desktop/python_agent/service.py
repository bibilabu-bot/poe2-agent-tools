"""Stateful Python-owned agent service."""

from __future__ import annotations

import json
from typing import Any

from .core import AgentError, AgentRunner, ChatAgent, ToolRegistry
from .provider import OpenAICompatibleProvider
from .tools import CalculatorTool

MAX_INPUT_CHARS = 12_000
MAX_HISTORY_MESSAGES = 60
MAX_HISTORY_CHARS = 256_000


class AgentService:
    def __init__(self) -> None:
        self.provider: OpenAICompatibleProvider | None = None
        self.history: list[dict[str, Any]] = []

    def configure(self, base_url: str, api_key: str) -> dict[str, Any]:
        self.clear()
        self.provider = OpenAICompatibleProvider(base_url, api_key)
        return self.status()

    def clear(self) -> dict[str, Any]:
        if self.provider:
            self.provider.clear_secret()
        self.provider = None
        self.history = []
        return self.status()

    def reset(self) -> dict[str, bool]:
        self.history = []
        return {"ok": True}

    def restore(self, history: Any) -> dict[str, Any]:
        if not isinstance(history, list) or not all(isinstance(message, dict) for message in history):
            raise AgentError("INVALID_HISTORY", "Conversation checkpoint is invalid")
        allowed_roles = {"user", "assistant", "tool"}
        if any(message.get("role") not in allowed_roles for message in history):
            raise AgentError("INVALID_HISTORY", "Conversation checkpoint contains an invalid role")
        self.history = _trim_history(history)
        return {"messages": len(self.history)}

    def status(self) -> dict[str, Any]:
        return {
            "configured": self.provider is not None,
            "baseUrl": self.provider.base_url if self.provider else None,
        }

    async def list_models(self) -> list[str]:
        return await self._provider().list_models()

    async def send(self, model: str, text: str, tools_enabled: bool) -> dict[str, Any]:
        if not model or len(model) > 256:
            raise AgentError("INVALID_MODEL", "Model ID is invalid")
        text = text.strip()
        if not text or len(text) > MAX_INPUT_CHARS:
            raise AgentError("INVALID_INPUT", f"Message must contain 1-{MAX_INPUT_CHARS} characters")
        candidate = _trim_history([*self.history, {"role": "user", "content": text}])
        runner = AgentRunner(self._provider(), ToolRegistry([CalculatorTool()]))
        result = await runner.run(agent=ChatAgent(), history=candidate, model=model, tools_enabled=tools_enabled)
        self.history = _trim_history([message for message in result.messages if message.get("role") != "system"])
        return {"text": result.text, "trace": result.trace, "rounds": result.rounds, "toolCalls": result.tool_calls, "history": self.history}

    def _provider(self) -> OpenAICompatibleProvider:
        if self.provider is None:
            raise AgentError("NOT_CONFIGURED", "Please connect an API service first")
        return self.provider


def _trim_history(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    turns: list[list[dict[str, Any]]] = []
    for message in messages:
        if message.get("role") == "user" or not turns:
            turns.append([])
        turns[-1].append(message)
    kept: list[list[dict[str, Any]]] = []
    count = size = 0
    for turn in reversed(turns):
        turn_size = len(json.dumps(turn, ensure_ascii=False))
        if kept and (count + len(turn) > MAX_HISTORY_MESSAGES or size + turn_size > MAX_HISTORY_CHARS):
            break
        if not kept and (len(turn) > MAX_HISTORY_MESSAGES or turn_size > MAX_HISTORY_CHARS):
            raise AgentError("HISTORY_LIMIT", "Latest conversation turn exceeds the safe history limit")
        kept.insert(0, turn)
        count += len(turn)
        size += turn_size
    return [message for turn in kept for message in turn]
