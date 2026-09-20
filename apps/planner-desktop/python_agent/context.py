"""Pure, non-destructive selection of a contiguous suffix of completed turns."""

from copy import deepcopy
from dataclasses import dataclass
from typing import Any, Mapping, Sequence

HISTORY_CONTEXT_CHARS = 100_000


class ContextError(ValueError):
    pass


@dataclass(frozen=True)
class ContextSelection:
    messages: list[dict[str, Any]]
    report: dict[str, Any]


def message_chars(message: Mapping[str, Any]) -> int:
    """Unicode code points in text and tool payloads, not JSON framing/roles."""
    size = len(message.get("content") or "")
    size += len(message.get("tool_call_id") or "")
    for call in message.get("tool_calls") or []:
        function = call["function"]
        size += len(call["id"]) + len(function["name"]) + len(function["arguments"])
    return size


def validate_turn(turn: Sequence[Mapping[str, Any]], *, completed: bool) -> None:
    if not turn or not isinstance(turn[0], Mapping) or turn[0].get("role") != "user":
        raise ContextError("Conversation turn must begin with a user message")
    pending: set[str] = set()
    finalized = False
    for index, message in enumerate(turn):
        if not isinstance(message, Mapping) or finalized:
            raise ContextError("Invalid message after completed response")
        role = message.get("role")
        if not isinstance(message.get("content"), str):
            raise ContextError("Conversation content must be text")
        if role == "user":
            if index:
                raise ContextError("Unexpected user message inside a turn")
        elif role == "assistant":
            if pending:
                raise ContextError("Tool results are missing")
            calls = message.get("tool_calls", [])
            if not isinstance(calls, list):
                raise ContextError("Tool calls must be a list")
            for call in calls:
                if not isinstance(call, Mapping):
                    raise ContextError("Tool call must be an object")
                call_id = call.get("id")
                function = call.get("function", {})
                if (not isinstance(call_id, str) or not call_id or call_id in pending
                        or not isinstance(function, Mapping)
                        or not isinstance(function.get("name"), str)
                        or not isinstance(function.get("arguments"), str)):
                    raise ContextError("Invalid tool call in conversation")
                pending.add(call_id)
            finalized = not calls
        elif role == "tool":
            call_id = message.get("tool_call_id")
            if not isinstance(call_id, str) or call_id not in pending:
                raise ContextError("Tool result has no matching call")
            pending.remove(call_id)
        else:
            raise ContextError("Invalid conversation role")
    if pending:
        raise ContextError("Tool results are missing")
    if completed and (turn[-1].get("role") != "assistant" or turn[-1].get("tool_calls")):
        raise ContextError("History contains an unfinished turn")


def select_context(
    history: Sequence[Mapping[str, Any]],
    current_turn: Sequence[Mapping[str, Any]],
    instructions: Sequence[Mapping[str, Any]] = (),
    *,
    history_limit: int = HISTORY_CONTEXT_CHARS,
) -> ContextSelection:
    if history_limit < 0:
        raise ValueError("History limit cannot be negative")
    turns: list[list[Mapping[str, Any]]] = []
    for message in history:
        if not isinstance(message, Mapping):
            raise ContextError("History message must be an object")
        if message.get("role") == "user":
            turns.append([])
        if not turns:
            raise ContextError("History must begin with a user message")
        turns[-1].append(message)
    for turn in turns:
        validate_turn(turn, completed=True)
    if current_turn:
        validate_turn(current_turn, completed=False)
    used = 0
    start = len(turns)
    for index in range(len(turns) - 1, -1, -1):
        size = sum(message_chars(message) for message in turns[index])
        if used + size > history_limit:
            break
        used += size
        start = index
    selected = [message for turn in turns[start:] for message in turn]
    return ContextSelection(
        messages=deepcopy([*instructions, *selected, *current_turn]),
        report={"policy": "recent-complete-turns-v1", "historyLimit": history_limit,
                "historyChars": used, "selectedTurns": len(turns) - start,
                "omittedTurns": start,
                "currentChars": sum(message_chars(message) for message in current_turn)},
    )
