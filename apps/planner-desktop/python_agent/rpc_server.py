"""Line-delimited JSON process boundary for Electron."""

from __future__ import annotations

import asyncio
import json
import sys
from typing import Any

from .core import AgentError
from .service import AgentService


async def dispatch(service: AgentService, method: str, params: dict[str, Any]) -> Any:
    if method == "status":
        return service.status()
    if method == "configure":
        return service.configure(params.get("baseUrl", ""), params.get("apiKey", ""))
    if method == "clear":
        return service.clear()
    if method == "reset":
        return service.reset()
    if method == "models":
        return {"models": await service.list_models()}
    if method == "send":
        return await service.send(params.get("model", ""), params.get("text", ""), bool(params.get("toolsEnabled")))
    raise AgentError("METHOD_NOT_FOUND", "Unknown agent runtime method")


async def main() -> None:
    service = AgentService()
    while line := await asyncio.to_thread(sys.stdin.buffer.readline):
        request_id: Any = None
        try:
            request = json.loads(line)
            request_id = request.get("id")
            result = await dispatch(service, request.get("method", ""), request.get("params") or {})
            response = {"id": request_id, "ok": True, "result": result}
        except AgentError as error:
            response = {"id": request_id, "ok": False, "error": {"code": error.code, "message": str(error)}}
        except Exception:
            response = {"id": request_id, "ok": False, "error": {"code": "AGENT_FAILED", "message": "Python agent runtime failed safely"}}
        sys.stdout.write(json.dumps(response, ensure_ascii=False, separators=(",", ":")) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    asyncio.run(main())
