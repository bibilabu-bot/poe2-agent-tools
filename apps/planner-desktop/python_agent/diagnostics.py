"""Content-free failure metadata. Never serialize exception text or frame locals."""
from __future__ import annotations

from contextlib import contextmanager
from contextvars import ContextVar
from pathlib import Path
import re
import time
import uuid

_current = ContextVar("agent_diagnostic", default=None)
_provider = ContextVar("provider_diagnostic", default=None)
_package = Path(__file__).resolve().parent
PHASES = {"run_setup", "prepare_context", "model_request", "tool_execute",
          "tool_result", "history_commit", "rpc", "unknown"}
_EXCEPTIONS = {"AgentError", "AttributeError", "TypeError", "KeyError", "IndexError",
               "ValueError", "RuntimeError", "TimeoutError", "UnicodeEncodeError",
               "UnicodeDecodeError", "JSONDecodeError", "OperationalError",
               "IntegrityError", "GraphRecursionError", "CancelledError"}
_CODES = {"INVALID_RESPONSE", "PROVIDER_STREAM_ERROR", "PROVIDER_STREAM_EOF", "PROVIDER_INCOMPLETE",
          "EMPTY_RESPONSE", "PROVIDER_TIMEOUT", "NETWORK_ERROR", "REQUEST_TOO_LARGE", "RESPONSE_TOO_LARGE",
          "HTML_RESPONSE", "REDIRECT_BLOCKED", "INVALID_REQUEST", "INVALID_HISTORY", "INVALID_TOOL_CALL",
          "MODEL_ROUND_LIMIT", "TOOL_CALL_LIMIT", "FINAL_SUMMARY_TOOL_CALL", "MEMORY_DIRECTORY_FULL",
          "TOOLS_DISABLED", "CANCELLED", "RUN_TIMEOUT", "NOT_CONFIGURED", "INVALID_INPUT", "INVALID_MODEL",
          "SESSION_REQUIRED", "PROMPT_CONFIG_INVALID", "AGENT_FAILED"}
SERVICE_CODES = {"rate_limit_exceeded", "insufficient_quota", "context_length_exceeded",
                 "invalid_request_error", "authentication_error", "permission_denied",
                 "server_error", "internal_server_error", "overloaded_error",
                 "model_not_found", "invalid_api_key", "content_filter", "timeout"}


def bounded_int(value, maximum=1_000_000_000):
    return min(maximum, max(0, value)) if type(value) is int else 0


def service_metadata(event):
    """Unknown vendor values are labels, never copied text. IDs are UUID/hex only."""
    error = event.get("error")
    if not isinstance(error, dict):
        response = event.get("response")
        error = response.get("error") if isinstance(response, dict) else None
    if not isinstance(error, dict):
        error = event
    result = {key: error.get(key) if isinstance(error.get(key), str) and error[key] in SERVICE_CODES
              else "other" for key in ("code", "type")}
    value = event.get("request_id", error.get("request_id"))
    # No arbitrary base64/tokens, headers or service messages. Opaque IDs outside
    # these narrow forms are deliberately unavailable, not truncated into logs.
    if isinstance(value, str) and re.fullmatch(r"(?:req[_-])?(?:[0-9a-fA-F]{32}|[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12})", value):
        result["requestId"] = value
    else:
        result["requestId"] = "unknown"
    return result


@contextmanager
def provider_observation(secret):
    data = {"protocol":"unknown", "stage":"unknown", "requestBytes":0, "responseBytes":0, "events":0}
    started = time.monotonic()
    token = _provider.set(data)
    try:
        yield
    except Exception as error:
        data["elapsedMs"] = bounded_int(round((time.monotonic()-started)*1000))
        meta = data.get("service")
        if meta and secret and secret in meta["requestId"]:
            meta["requestId"] = "unknown"
        error._provider_diagnostic = dict(data)
        raise
    finally:
        _provider.reset(token)


def provider_note(**values):
    data = _provider.get()
    if data is None:
        return
    for key, value in values.items():
        if key == "protocol":
            data[key] = value if value in ("chat", "responses") else "unknown"
        elif key == "stage":
            data[key] = value if value in ("encode", "open", "read", "parse", "decode") else "unknown"
        elif key in ("requestBytes", "responseBytes", "events"):
            data[key] = bounded_int(value)
        elif key == "service":
            data[key] = service_metadata(value)


def provider_event(event):
    data = _provider.get()
    if data is not None:
        data["events"] = bounded_int(data["events"]+1)
        data["stage"] = "parse"


def safe_provider(value):
    if not isinstance(value, dict):
        return {"protocol":"unknown"}
    result = {"protocol":value.get("protocol") if value.get("protocol") in ("chat","responses") else "unknown",
              "stage":value.get("stage") if value.get("stage") in ("encode","open","read","parse","decode") else "unknown"}
    for key in ("requestBytes","responseBytes","events","elapsedMs"):
        result[key] = bounded_int(value.get(key))
    meta = value.get("service")
    if isinstance(meta, dict):
        result["service"] = service_metadata({"error":meta,"request_id":meta.get("requestId")})
    return result


class RunDiagnostic:
    def __init__(self):
        self.id = "diag-" + uuid.uuid4().hex
        self.started = time.monotonic()
        self.phase = "unknown"
        self.round = 0
        self.tool_position = 0
        self.completed_tools = 0

    def capture(self, error):
        frames = []
        tb = error.__traceback__
        while tb:
            code = tb.tb_frame.f_code
            file = Path(code.co_filename)
            if file.parent == _package and re.fullmatch(r"[a-z_]+\.py", file.name):
                frames.append({"module": "python_agent." + file.stem,
                               "function": code.co_name if re.fullmatch(r"[A-Za-z_][A-Za-z_0-9]{0,63}|<lambda>|<module>", code.co_name) else "unknown",
                               "line": bounded_int(tb.tb_lineno)})
            tb = tb.tb_next
        code = getattr(error,"code",None)
        code = code if isinstance(code,str) and (code in _CODES or re.fullmatch(r"HTTP_[345][0-9]{2}",code)) else "AGENT_FAILED"
        return {"version":1, "id": self.id, "errorCode":code, "phase": self.phase, "modelRound": self.round,
                "toolBatchPosition": self.tool_position, "completedTools": self.completed_tools,
                "elapsedMs": bounded_int(round((time.monotonic()-self.started)*1000)),
                "exceptionType": type(error).__name__ if type(error).__name__ in _EXCEPTIONS else "OtherException",
                "frames": frames[-12:], "provider": safe_provider(getattr(error, "_provider_diagnostic", None))}


@contextmanager
def run_diagnostic():
    state = RunDiagnostic()
    token = _current.set(state)
    try:
        yield state
    finally:
        _current.reset(token)


def phase(name, *, model_round=None, tool_position=None, completed_tools=None):
    state = _current.get()
    if state is None:
        return
    state.phase = name if name in PHASES else "unknown"
    if model_round is not None:
        state.round = bounded_int(model_round, 20)
    if tool_position is not None:
        state.tool_position = bounded_int(tool_position, 100)
    if completed_tools is not None:
        state.completed_tools = bounded_int(completed_tools, 100)


def record_failure(error, store=None, conversation_id=None):
    """Once per exception; diagnostic-storage errors never replace the failure."""
    existing = getattr(error, "_diagnostic", None)
    if existing is not None:
        return existing
    state = _current.get()
    if state is None:
        state = RunDiagnostic()
        state.phase = "rpc"
    diagnostic = state.capture(error)
    error._diagnostic = diagnostic
    diagnostic["stored"] = False
    if store is not None:
        import json
        try:
            with store.db:
                store.db.execute("CREATE TABLE IF NOT EXISTS failed_runs (id INTEGER PRIMARY KEY, created_at TEXT DEFAULT CURRENT_TIMESTAMP, conversation_id TEXT, details TEXT)")
                diagnostic["stored"] = True
                store.db.execute("INSERT INTO failed_runs (conversation_id,details) VALUES (?,?)",
                                 (conversation_id, json.dumps({"diagnostic":diagnostic}, ensure_ascii=True)))
        except Exception:
            diagnostic["stored"] = False
    return diagnostic


def public_diagnostic(diagnostic):
    return {key: diagnostic[key] for key in ("id", "phase", "modelRound", "stored")}
