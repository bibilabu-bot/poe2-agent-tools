"""Test-only arithmetic fixture for generic tool-loop tests."""

from __future__ import annotations

import math
from typing import Any, Mapping

from python_agent.core import AgentError, BaseTool


class ArithmeticFixtureTool(BaseTool):
    name = "fixture_arithmetic"
    description = "Test-only arithmetic fixture."
    parameters = {
        "type": "object",
        "additionalProperties": False,
        "required": ["operator", "a", "b"],
        "properties": {
            "operator": {"type": "string", "enum": ["add", "subtract", "multiply", "divide"]},
            "a": {"type": "number"},
            "b": {"type": "number"},
        },
    }

    def validate(self, arguments: Mapping[str, Any]) -> None:
        if set(arguments) != {"operator", "a", "b"}:
            raise AgentError("INVALID_TOOL_ARGUMENTS", "Expected only operator, a and b")
        if arguments["operator"] not in {"add", "subtract", "multiply", "divide"}:
            raise AgentError("INVALID_TOOL_ARGUMENTS", "Unsupported calculator operator")
        for name in ("a", "b"):
            value = arguments[name]
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
                raise AgentError("INVALID_TOOL_ARGUMENTS", f"{name} must be a finite number")
            if abs(value) > 1e100:
                raise AgentError("INVALID_TOOL_ARGUMENTS", f"{name} exceeds the safe range")

    async def execute(self, arguments: Mapping[str, Any]) -> dict[str, float]:
        operator, a, b = arguments["operator"], arguments["a"], arguments["b"]
        if operator == "divide" and b == 0:
            raise AgentError("DIVISION_BY_ZERO", "Division by zero is not allowed")
        operations = {
            "add": lambda: a + b,
            "subtract": lambda: a - b,
            "multiply": lambda: a * b,
            "divide": lambda: a / b,
        }
        result = operations[operator]()
        if not math.isfinite(result):
            raise AgentError("NON_FINITE_RESULT", "Calculation result is not finite")
        return {"result": result}
