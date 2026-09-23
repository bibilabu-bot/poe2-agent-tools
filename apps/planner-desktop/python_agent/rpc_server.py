"""Line-delimited JSON process boundary for Electron.

Callback protocol (Python → Node → Electron → Node → Python):
  - Python tool calls _tree_write_callback(method, params) during execute()
  - It writes {"callback":true,"callback_id":"…","method":"…","params":{…}} to stdout
  - Node reads the callback, calls window.plannerWriteAPI[method](nodeId) via Electron IPC
  - Node writes {"callback_result":true,"callback_id":"…","result":{…}} to Python's stdin
  - The background _stdin_reader resolves the waiting future
  - Tool awaits the future and returns the result to the model
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import uuid
from typing import Any

from .core import AgentError
from .service import AgentService

_callback_futures: dict[str, asyncio.Future] = {}
_request_queue: asyncio.Queue[dict[str, Any] | None] = asyncio.Queue()


def write_message(message: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(message, ensure_ascii=False, separators=(",", ":")) + "\n")
    sys.stdout.flush()


async def _tree_write_callback(method: str, params: dict[str, Any], timeout: float = 15.0) -> dict[str, Any]:
    """Send a tree write request to Electron and await the result."""
    loop = asyncio.get_running_loop()
    if method not in ("allocate", "deallocate"):
        raise AgentError("INVALID_WRITE_METHOD", f"不支持的天赋树操作: {method}")
    future: asyncio.Future[dict[str, Any]] = loop.create_future()
    callback_id = uuid.uuid4().hex[:12]
    _callback_futures[callback_id] = future
    write_message({"callback": True, "callback_id": callback_id, "method": method, "params": params})
    try:
        return await asyncio.wait_for(future, timeout=timeout)
    except asyncio.TimeoutError:
        _callback_futures.pop(callback_id, None)
        raise AgentError("TREE_WRITE_TIMEOUT", "天赋树写入超时，请重试")


async def _stdin_reader() -> None:
    """Background task: read stdin and route to callback futures or request queue."""
    while True:
        raw = await asyncio.to_thread(sys.stdin.buffer.readline)
        if not raw:
            await _request_queue.put(None)  # EOF signal
            return
        try:
            msg = json.loads(raw.decode("utf-8", errors="strict"))
        except Exception:
            continue
        if msg.get("callback_result"):
            future = _callback_futures.pop(msg.get("callback_id", ""), None)
            if future is not None and not future.done():
                error = msg.get("error")
                if error:
                    future.set_exception(AgentError(error.get("code", "TREE_WRITE_FAILED"), error.get("message", "天赋树写入失败")))
                else:
                    future.set_result(msg["result"])
        else:
            await _request_queue.put(msg)


async def dispatch(service: AgentService, method: str, params: dict[str, Any], request_id: Any = None) -> Any:
    if method == "rag_configure":
        if params.get("path"):
            service.rag_cache_path = params["path"]
        from .rag import RagIndex, RetrievalProvider
        if service.rag:
            service.rag.db.close()
        service.rag = None
        service.rag_unavailable = bool(params.get("unavailable"))
        service.rag = RagIndex(params["path"],RetrievalProvider(params["profiles"]),params.get("sourceVersion","")) if params.get("profiles") else None
        return service.rag.status() if service.rag else {"ready":False,"count":0}
    if method == "tree_snapshot":
        from .tree_tools import TreeSnapshot
        gen = params.get("generation")
        if gen is not None and service._active_generation is not None and str(gen) != str(service._active_generation):
            return {"ready": False, "nodeCount": 0, "stale": True}
        if not params or not params.get("snapshot"):
            service.tree_snapshot = None
            return {"ready": False, "nodeCount": 0}
        snap = TreeSnapshot(
            snapshot_id=params["snapshot"].get("snapshotId", ""),
            node_count=params["snapshot"].get("nodeCount", 0),
            nodes={n["id"]: n for n in params["snapshot"].get("nodes", [])},
            adjacency=params["snapshot"].get("adjacency", {}),
            build=params["snapshot"].get("build", {}),
            _path_index=params["snapshot"].get("_pathIndex", {}),
            _error=params["snapshot"].get("_error"),
            semantic_topology=params["snapshot"].get("semanticTopology"),
        )
        service.tree_snapshot = snap
        return {"ready": not bool(snap._error), "buildReady": True,
                "nodeCount": snap.node_count, "snapshotId": snap.snapshot_id,
                "error": snap._error}
    if method == "rag_build":
        if not service.rag: raise AgentError("RAG_NOT_CONFIGURED","请先保存向量化和重排序配置")
        def progress(completed, total):
            sys.stdout.write(json.dumps({"event":"rag_progress","completed":completed,"total":total}) + "\n")
            sys.stdout.flush()
        return await service.rag.build(params["corpus"],progress)
    if method == "rag_search":
        from .rag import RagTool
        if not service.rag: raise AgentError("RAG_NOT_CONFIGURED","请先配置 RAG")
        tool = RagTool(service.rag,params.get("tool","search_passive_nodes"),tree_snapshot=service.tree_snapshot)
        tool.validate(params["arguments"])
        return await tool.execute(params["arguments"])
    if method == "status":
        return service.status()
    if method == "inspect_prompt":
        return service.inspect_prompt()
    if method == "save_prompts":
        return service.save_prompts(params.get("overrides"))
    if method == "configure":
        return service.configure(params.get("baseUrl", ""), params.get("apiKey", ""))
    if method == "clear":
        return service.clear()
    if method == "reset":
        return service.reset()
    if method == "sessions":
        return service.sessions()
    if method == "select_session":
        return service.select_session(params.get("conversationId"))
    if method == "delete_session":
        return service.delete_session(params.get("conversationId"), params.get("confirmed"))
    if method == "session_history":
        return service.session_history(params.get("conversationId"), params.get("before"))
    if method == "restore":
        return service.restore(params.get("history"))
    if method == "models":
        return {"models": await service.list_models()}
    if method == "send":
        # Wire the tree write callback so tools can call back to Electron.
        service._tree_write_callback = _tree_write_callback if params.get("toolsEnabled") is True else None
        sequence = 0
        def progress(event: dict[str, Any]) -> None:
            nonlocal sequence
            sequence += 1
            write_message({"id": request_id, "event": "agent_run", "seq": sequence, **event})
        try:
            return await service.send(params.get("model", ""), params.get("text", ""),
                                      bool(params.get("toolsEnabled")), progress,
                                      remaining_ms=params.get("_remainingMs"))
        finally:
            service._tree_write_callback = None
    raise AgentError("METHOD_NOT_FOUND", "Unknown agent runtime method")


async def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8", errors="strict", newline="\n")
    sys.stderr.reconfigure(encoding="utf-8", errors="strict", newline="\n")
    service = AgentService(memory_path=os.environ.get("P2AT_AGENT_MEMORY_DB") or None)

    # Start the background stdin reader — it routes callback responses directly
    # and queues normal requests for the main loop below.
    reader_task = asyncio.create_task(_stdin_reader())

    try:
        while True:
            msg = await _request_queue.get()
            if msg is None:
                break  # EOF from stdin
            request_id: Any = msg.get("id")
            try:
                result = await dispatch(service, msg.get("method", ""), msg.get("params") or {}, request_id)
                response = {"id": request_id, "ok": True, "result": result}
            except AgentError as error:
                response = {"id": request_id, "ok": False, "error": {"code": error.code, "message": str(error)}}
            except Exception:
                response = {"id": request_id, "ok": False, "error": {"code": "AGENT_FAILED", "message": "Python agent runtime failed safely"}}
            write_message(response)
    finally:
        # Cancel any pending callbacks before shutting down.
        for future in _callback_futures.values():
            if not future.done():
                future.set_exception(AgentError("CANCELLED", "Python runtime is shutting down"))
        _callback_futures.clear()
        reader_task.cancel()


if __name__ == "__main__":
    asyncio.run(main())
