"""Stateful Python-owned agent service."""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any, Callable

from .context import ContextError
from .core import AgentError, AgentRunner, BaseAgent, ToolRegistry
from .memory import MemorySession, MemoryStore
from .provider import OpenAICompatibleProvider
from .tools import CalculatorTool
from .session_display import redact
from .prompts import build_system_prompt, PromptStore, DEFAULTS, BLOCK_LABELS, TOOL_DESCRIPTIONS

MAX_INPUT_CHARS = 12_000
MAX_HISTORY_MESSAGES = 60
MAX_HISTORY_CHARS = 256_000


class AgentService:
    def __init__(self, memory_path: str | None = None) -> None:
        self.provider: OpenAICompatibleProvider | None = None
        self.history: list[dict[str, Any]] = []
        self.memory_store = MemoryStore(memory_path) if memory_path else None
        self.conversation_id: str | None = None
        self.rag = None
        self.running = False
        self.prompts = PromptStore(str(Path(memory_path).with_suffix(".prompts.json")) if memory_path and memory_path != ":memory:" else None)

    def configure(self, base_url: str, api_key: str) -> dict[str, Any]:
        self.clear()
        self.provider = OpenAICompatibleProvider(base_url, api_key)
        if self.memory_store:
            self.conversation_id = self.memory_store.activate(self.provider.base_url)
            self.history = _trim_history(self.memory_store.recent_history(self.conversation_id))
        return self.status()

    def clear(self) -> dict[str, Any]:
        if self.provider:
            self.provider.clear_secret()
        self.provider = None
        self.history = []
        self.conversation_id = None
        return self.status()

    def reset(self) -> dict[str, bool]:
        self._idle()
        self.history = []
        if self.memory_store and self.provider:
            self.conversation_id = self.memory_store.activate(self.provider.base_url, new=True)
        return {"ok": True}

    def _idle(self) -> None:
        if self.running:
            raise AgentError("RUN_IN_PROGRESS", "请先停止当前回复，再切换会话")

    def sessions(self) -> dict[str, Any]:
        self._idle()
        if not self.memory_store or not self.conversation_id:
            raise AgentError("MEMORY_UNAVAILABLE", "持久会话暂不可用")
        return {"selectedId": self.conversation_id,
                "sessions": self.memory_store.list_conversations(self._provider().base_url, getattr(self.provider, "_api_key", ""))}

    def select_session(self, conversation_id: str) -> dict[str, Any]:
        self._idle()
        self.sessions()
        endpoint = self._provider().base_url
        try:
            history = _trim_history(self.memory_store.selection_history(endpoint, conversation_id))
            # Prepare every fallible response/display read before publishing either ID.
            self.memory_store.display_history(endpoint, conversation_id)
            result = {"selectedId": conversation_id,
                      "sessions": self.memory_store.list_conversations(endpoint, getattr(self.provider, "_api_key", ""))}
        except (ValueError, TypeError, KeyError) as error:
            raise AgentError("INVALID_HISTORY", "目标会话记录损坏，未切换会话") from error
        self.memory_store.select(endpoint, conversation_id)
        self.conversation_id = conversation_id
        self.history = history
        return result

    def session_history(self, conversation_id: str, before: int | None = None) -> dict[str, Any]:
        self._idle()
        self.sessions()
        return redact(self.memory_store.display_history(self._provider().base_url, conversation_id, before), getattr(self.provider, "_api_key", ""))

    def restore(self, history: Any) -> dict[str, Any]:
        if self.memory_store and self.conversation_id and self.memory_store.directory(self.conversation_id):
            # Renderer caches only display pairs; never overwrite the full durable archive.
            self.history = _trim_history(self.memory_store.recent_history(self.conversation_id))
            return {"messages": len(self.history), "source": "archive"}
        if not isinstance(history, list) or not all(isinstance(message, dict) for message in history):
            raise AgentError("INVALID_HISTORY", "Conversation checkpoint is invalid")
        allowed_roles = {"user", "assistant", "tool"}
        if any(message.get("role") not in allowed_roles for message in history):
            raise AgentError("INVALID_HISTORY", "Conversation checkpoint contains an invalid role")
        restored = _trim_history(history)
        if self.memory_store and self.conversation_id:
            turns: list[list[dict[str, Any]]] = []
            for message in restored:
                if message.get("role") == "user":
                    turns.append([])
                if not turns:
                    raise AgentError("INVALID_HISTORY", "History must begin with a user message")
                turns[-1].append(message)
            try:
                self.memory_store.import_turns(self.conversation_id, redact(turns, getattr(self.provider, "_api_key", "")))
            except ContextError as error:
                raise AgentError("INVALID_HISTORY", str(error)) from error
        self.history = restored
        return {"messages": len(self.history)}

    def status(self) -> dict[str, Any]:
        return {
            "configured": self.provider is not None,
            "baseUrl": self.provider.base_url if self.provider else None,
        }

    async def list_models(self) -> list[str]:
        return await self._provider().list_models()

    def prompt_spec(self):
        return build_system_prompt(memory=bool(self.memory_store and self.conversation_id),
                                   rag=bool(self.rag), rag_unavailable=bool(getattr(self, "rag_unavailable", False)),
                                   overrides=dict(self.prompts.blocks))

    def inspect_prompt(self) -> dict[str, Any]:
        # Describe template selection only; never call MemorySession/model_context here.
        return {**self.prompt_spec().describe(), "configured": self.provider is not None,
                "basis": "runtime-state-at-inspection", "privateContextIncluded": False,
                "blocks": [{"id": name, "text": text, "custom": text != dict(DEFAULTS)[name],
                            "label": BLOCK_LABELS[name], "category": "tool" if name.startswith("tool_") else "system",
                            "usage": ("随该工具启用发送；仅修改描述，不改变参数和权限" if name.startswith("tool_") else
                                      "记忆启用时放在动态上下文前；上下文仍为用户数据，不提升权限" if name == "memory_prefix" else
                                      "按功能状态拼入系统消息，保留原文及空白")}
                           for name,text in self.prompts.blocks],
                "storageError": self.prompts.error}

    def save_prompts(self, overrides: dict) -> dict[str, Any]:
        self._idle()
        try:
            self.prompts.save(overrides)
        except (ValueError, TypeError) as error:
            raise AgentError("INVALID_PROMPT", str(error)) from error
        except OSError as error:
            raise AgentError("PROMPT_SAVE_FAILED", "提示词保存失败，原配置未变") from error
        return self.inspect_prompt()

    async def send(self, model: str, text: str, tools_enabled: bool,
                   on_event: Callable[[dict[str, Any]], None] | None = None) -> dict[str, Any]:
        self._idle()
        self.running = True
        try:
            return await self._send(model, text, tools_enabled, on_event)
        finally:
            self.running = False

    async def _send(self, model: str, text: str, tools_enabled: bool,
                    on_event: Callable[[dict[str, Any]], None] | None = None) -> dict[str, Any]:
        if self.prompts.error:
            raise AgentError("PROMPT_CONFIG_INVALID", self.prompts.error)
        started = time.monotonic()
        if not model or len(model) > 256:
            raise AgentError("INVALID_MODEL", "Model ID is invalid")
        text = text.strip()
        if not text or len(text) > MAX_INPUT_CHARS:
            raise AgentError("INVALID_INPUT", f"Message must contain 1-{MAX_INPUT_CHARS} characters")
        candidate = [*self.history, {"role": "user", "content": text}]
        memory = MemorySession(self.memory_store, self.conversation_id) if self.memory_store and self.conversation_id else None
        prompt_values = dict(self.prompts.blocks)
        registry = ToolRegistry([CalculatorTool()] if tools_enabled else [],
                                {name: prompt_values["tool_" + name] for name in TOOL_DESCRIPTIONS})
        agent = BaseAgent("chat", self.prompt_spec().text)
        if memory:
            for tool in memory.tools():
                registry.register(tool)
        if self.rag:
            from .rag import RagTool
            for name in ("search_passive_nodes", "read_passive_nodes"):
                registry.register(RagTool(self.rag,name))
            if memory:
                registry.register(RagTool(self.rag,"search_memory_semantic",memory))
        runner = AgentRunner(self._provider(), registry, memory_context=memory.model_context if memory else None,
                             on_event=on_event, memory_prefix=prompt_values["memory_prefix"])
        result = await runner.run(agent=agent, history=candidate, model=model, tools_enabled=bool(memory) or bool(self.rag) or tools_enabled)
        completed_history = [message for message in result.messages if message.get("role") != "system"]
        retained = _trim_history(completed_history)
        if memory:
            current = completed_history[len(self.history):]
            secret = getattr(self.provider, "_api_key", "")
            self.memory_store.commit(self.conversation_id, memory.current_turn, redact(current, secret),
                                     redact(memory.notebook, secret),
                                     {"durationMs": round((time.monotonic()-started)*1000),
                                      "trace": redact(result.trace, secret)})
        self.history = retained
        return {"text": result.text, "trace": result.trace, "rounds": result.rounds, "toolCalls": result.tool_calls, "history": self.history, "context": result.context_report}

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
