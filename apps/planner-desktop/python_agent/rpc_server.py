"""Line-delimited JSON process boundary for Electron."""

from __future__ import annotations

import asyncio
import json
import os
import sys
from typing import Any

from .core import AgentError
from .service import AgentService


async def dispatch(service: AgentService, method: str, params: dict[str, Any]) -> Any:
    if method == "rag_configure":
        from .rag import RagIndex, RetrievalProvider
        if service.rag:
            service.rag.db.close()
        service.rag = None
        service.rag_unavailable = bool(params.get("unavailable"))
        service.rag = RagIndex(params["path"],RetrievalProvider(params["profiles"]),params.get("sourceVersion","")) if params.get("profiles") else None
        return service.rag.status() if service.rag else {"ready":False,"count":0}
    if method == "rag_build":
        if not service.rag: raise AgentError("RAG_NOT_CONFIGURED","请先保存向量化和重排序配置")
        def progress(completed, total):
            sys.stdout.write(json.dumps({"event":"rag_progress","completed":completed,"total":total}) + "\n")
            sys.stdout.flush()
        return await service.rag.build(params["corpus"],progress)
    if method == "rag_search":
        from .rag import RagTool
        if not service.rag: raise AgentError("RAG_NOT_CONFIGURED","请先配置 RAG")
        tool = RagTool(service.rag,params.get("tool","search_passive_nodes"))
        tool.validate(params["arguments"])
        return await tool.execute(params["arguments"])
    if method == "status":
        return service.status()
    if method == "configure":
        return service.configure(params.get("baseUrl", ""), params.get("apiKey", ""))
    if method == "clear":
        return service.clear()
    if method == "reset":
        return service.reset()
    if method == "restore":
        return service.restore(params.get("history"))
    if method == "models":
        return {"models": await service.list_models()}
    if method == "send":
        return await service.send(params.get("model", ""), params.get("text", ""), bool(params.get("toolsEnabled")))
    raise AgentError("METHOD_NOT_FOUND", "Unknown agent runtime method")


async def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8", errors="strict", newline="\n")
    sys.stderr.reconfigure(encoding="utf-8", errors="strict", newline="\n")
    service = AgentService(memory_path=os.environ.get("P2AT_AGENT_MEMORY_DB") or None)
    while line := await asyncio.to_thread(sys.stdin.buffer.readline):
        request_id: Any = None
        try:
            request = json.loads(line.decode("utf-8", errors="strict"))
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
