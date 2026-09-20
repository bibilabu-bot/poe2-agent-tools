"""Agent, tool and bounded model/tool loop primitives."""

from __future__ import annotations

import asyncio
import json
import re
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Mapping, Sequence, TypedDict

from langgraph.graph import END, START, StateGraph
from langsmith import tracing_context

from .context import ContextError, HISTORY_CONTEXT_CHARS, select_context


class AgentError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class ToolCall:
    call_id: str
    name: str
    arguments: str


@dataclass(frozen=True)
class ModelReply:
    content: str = ""
    tool_calls: tuple[ToolCall, ...] = ()


class ModelProvider(ABC):
    @abstractmethod
    async def list_models(self) -> list[str]:
        raise NotImplementedError

    @abstractmethod
    async def complete(
        self,
        *,
        model: str,
        messages: Sequence[Mapping[str, Any]],
        tools: Sequence[Mapping[str, Any]],
    ) -> ModelReply:
        raise NotImplementedError


@dataclass(frozen=True)
class BaseAgent:
    name: str
    system_prompt: str = ""

    def __post_init__(self) -> None:
        if not self.name.strip():
            raise ValueError("Agent name is required")

    def initial_messages(
        self, history: Sequence[Mapping[str, Any]]
    ) -> list[dict[str, Any]]:
        messages = [dict(message) for message in history]
        if self.system_prompt:
            messages.insert(0, {"role": "system", "content": self.system_prompt[:8_000]})
        return messages


class ChatAgent(BaseAgent):
    def __init__(self) -> None:
        super().__init__(
            name="chat",
            system_prompt=(
                "You are a concise, helpful general assistant. Use the calculator "
                "when enabled and arithmetic is needed. Never claim a tool ran "
                "unless a tool result is present."
            ),
        )


class BaseTool(ABC):
    name: str
    description: str
    parameters: Mapping[str, Any]

    def definition(self) -> dict[str, Any]:
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": dict(self.parameters),
            },
        }

    def parse_arguments(self, raw_arguments: str) -> dict[str, Any]:
        if len(raw_arguments.encode("utf-8")) > 16 * 1024:
            raise AgentError("INVALID_TOOL_ARGUMENTS", "Tool arguments are too large")
        try:
            value = json.loads(raw_arguments)
        except json.JSONDecodeError as error:
            raise AgentError("INVALID_TOOL_ARGUMENTS", "Tool arguments are not valid JSON") from error
        if not isinstance(value, dict):
            raise AgentError("INVALID_TOOL_ARGUMENTS", "Tool arguments must be an object")
        self.validate(value)
        return value

    @abstractmethod
    def validate(self, arguments: Mapping[str, Any]) -> None:
        raise NotImplementedError

    @abstractmethod
    async def execute(self, arguments: Mapping[str, Any]) -> Any:
        raise NotImplementedError


class ToolRegistry:
    def __init__(self, tools: Sequence[BaseTool] = ()) -> None:
        self._tools: dict[str, BaseTool] = {}
        for tool in tools:
            self.register(tool)

    def register(self, tool: BaseTool) -> None:
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", tool.name):
            raise ValueError("Tool name is invalid")
        if tool.name in self._tools:
            raise ValueError(f"Duplicate tool: {tool.name}")
        self._tools[tool.name] = tool

    def get(self, name: str) -> BaseTool | None:
        return self._tools.get(name)

    def definitions(self) -> list[dict[str, Any]]:
        return [tool.definition() for tool in self._tools.values()]


@dataclass(frozen=True)
class RunnerLimits:
    max_model_rounds: int = 6
    max_tool_calls: int = 12
    max_history_chars: int = HISTORY_CONTEXT_CHARS
    max_text_chars: int = 32_000
    max_tool_result_chars: int = 8_000


@dataclass
class RunResult:
    text: str
    messages: list[dict[str, Any]]
    trace: list[dict[str, Any]] = field(default_factory=list)
    rounds: int = 0
    tool_calls: int = 0
    context_report: dict[str, Any] = field(default_factory=dict)


class RunState(TypedDict):
    """Per-invocation working state; credentials and durable history stay outside."""

    messages: list[dict[str, Any]]
    history: list[dict[str, Any]]
    instructions: list[dict[str, Any]]
    model_input: list[dict[str, Any]]
    context_report: dict[str, Any]
    trace: list[dict[str, Any]]
    calls: list[ToolCall]
    text: str
    rounds: int
    tool_count: int
    model: str
    tools_enabled: bool


class AgentRunner:
    def __init__(
        self,
        provider: ModelProvider,
        registry: ToolRegistry,
        limits: RunnerLimits | None = None,
    ) -> None:
        self.provider = provider
        self.registry = registry
        self.limits = limits or RunnerLimits()
        self._run_lock = asyncio.Lock()
        graph = StateGraph(RunState)
        graph.add_node("prepare_context", self._prepare_context)
        graph.add_node("model", self._model_step)
        graph.add_node("tools", self._tools_step)
        graph.add_edge(START, "prepare_context")
        graph.add_edge("prepare_context", "model")
        graph.add_conditional_edges("model", self._next_step, {"tools": "tools", "done": END})
        graph.add_edge("tools", "prepare_context")
        self.graph = graph.compile()

    async def run(
        self,
        *,
        agent: BaseAgent,
        history: Sequence[Mapping[str, Any]],
        model: str,
        tools_enabled: bool = True,
    ) -> RunResult:
        if self._run_lock.locked():
            raise AgentError("RUN_IN_PROGRESS", "A response is already running")

        async with self._run_lock:
            # Caller supplies committed history followed by the current user message.
            boundary = next((i for i in range(len(history) - 1, -1, -1)
                             if history[i].get("role") == "user"), len(history))
            initial: RunState = {
                "messages": [dict(message) for message in history[boundary:]],
                "history": [dict(message) for message in history[:boundary]],
                "instructions": agent.initial_messages([]),
                "model_input": [], "context_report": {},
                "trace": [], "calls": [], "text": "", "rounds": 0,
                "tool_count": 0, "model": model, "tools_enabled": tools_enabled,
            }
            # Never upload user conversations through ambient LangSmith settings.
            # No checkpointer/retry: service commits only a fully successful turn.
            with tracing_context(enabled=False):
                state = await self.graph.ainvoke(
                    initial, {"recursion_limit": 3 * self.limits.max_model_rounds + 3}
                )
            return RunResult(state["text"], [*state["instructions"], *state["history"], *state["messages"]],
                             state["trace"], state["rounds"], state["tool_count"], state["context_report"])

    def _prepare_context(self, state: RunState) -> dict[str, Any]:
        try:
            selected = select_context(state["history"], state["messages"], state["instructions"],
                                      history_limit=self.limits.max_history_chars)
        except ContextError as error:
            raise AgentError("INVALID_HISTORY", str(error)) from error
        return {"model_input": selected.messages, "context_report": selected.report}

    async def _model_step(self, state: RunState) -> dict[str, Any]:
        if state["rounds"] >= self.limits.max_model_rounds:
            raise AgentError("MODEL_ROUND_LIMIT", "Model-round limit exceeded")
        reply = await self.provider.complete(
            model=state["model"], messages=state["model_input"],
            tools=self.registry.definitions() if state["tools_enabled"] else [],
        )
        content = reply.content[: self.limits.max_text_chars]
        calls = list(reply.tool_calls)
        call_ids = [call.call_id for call in calls]
        if any(not value or len(value) > 256 for value in call_ids) or len(set(call_ids)) != len(call_ids):
            raise AgentError("INVALID_TOOL_CALL", "Tool call IDs must be present and unique")
        if state["tool_count"] + len(calls) > self.limits.max_tool_calls:
            raise AgentError("TOOL_CALL_LIMIT", "Tool-call limit exceeded")
        if calls and not state["tools_enabled"]:
            raise AgentError("TOOLS_DISABLED", "Tools are disabled")
        assistant: dict[str, Any] = {"role": "assistant", "content": content}
        if calls:
            assistant["tool_calls"] = [
                {"id": call.call_id, "type": "function",
                 "function": {"name": call.name, "arguments": call.arguments}}
                for call in calls
            ]
        return {"messages": [*state["messages"], assistant], "calls": calls,
                "text": content, "rounds": state["rounds"] + 1}

    @staticmethod
    def _next_step(state: RunState) -> str:
        return "tools" if state["calls"] else "done"

    async def _tools_step(self, state: RunState) -> dict[str, Any]:
        messages = list(state["messages"])
        trace = list(state["trace"])
        for call in state["calls"]:
            result, ok = await self._execute_tool(call)
            result_text = _bounded_json(result, self.limits.max_tool_result_chars)
            trace.append({"callId": call.call_id, "name": call.name[:64],
                          "ok": ok, "result": result_text})
            messages.append({"role": "tool", "tool_call_id": call.call_id, "content": result_text})
        return {"messages": messages, "trace": trace,
                "tool_count": state["tool_count"] + len(state["calls"]), "calls": []}

    async def _execute_tool(self, call: ToolCall) -> tuple[Any, bool]:
        try:
            if not call.call_id or len(call.call_id) > 256:
                raise AgentError("INVALID_TOOL_CALL", "Tool call ID is invalid")
            tool = self.registry.get(call.name)
            if tool is None:
                raise AgentError("UNKNOWN_TOOL", f"Unknown tool: {call.name}")
            arguments = tool.parse_arguments(call.arguments)
            return await tool.execute(arguments), True
        except AgentError as error:
            return {"error": {"code": error.code, "message": str(error)[:500]}}, False
        except Exception:
            return {"error": {"code": "TOOL_EXECUTION_FAILED", "message": "Tool execution failed safely"}}, False


def _bounded_json(value: Any, limit: int) -> str:
    text = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    return text if len(text) <= limit else f"{text[:limit]}…[truncated]"
