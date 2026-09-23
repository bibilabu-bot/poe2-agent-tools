"""Local conversation archive, extractive directory and transactional notebook.

No credentials enter this module. Model-facing reads are scoped to one conversation.
"""

from __future__ import annotations

import json
import hashlib
import sqlite3
import uuid
from collections import deque
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping

from .context import validate_turn
from .core import AgentError, BaseTool
from .prompts import TOOL_DESCRIPTIONS
from .session_display import redact

MAX_DIRECTORY_CHARS = 60_000
MAX_NOTEBOOK_CHARS = 8_000
READ_CHUNK_CHARS = 1_500  # Escaping still fits the runner's 8k tool-result envelope.
MAX_READ_CHARS_PER_RUN = 12_000


def encode(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def empty_notebook() -> dict[str, Any]:
    return {"revision": 0, "goal": "", "constraints": [], "decisions": [], "notes": {},
            "updated_in_turn": None}


def short_summary(messages: list[dict[str, Any]]) -> str:
    """A source-faithful index label, not an inferred fact or model paraphrase."""
    def excerpt(text: str, limit: int) -> str:
        text = " ".join(text.split())
        return text if len(text) <= limit else text[:limit - 1] + "…"
    tools = list(dict.fromkeys(call["function"]["name"] for message in messages
                              for call in message.get("tool_calls", [])))
    suffix = " 工具:" + ",".join(tools) if tools else ""
    return excerpt("问:" + excerpt(messages[0]["content"], 32)
                   + " 答:" + excerpt(messages[-1]["content"], 32) + suffix, 96)


class MemoryStore:
    def __init__(self, filename: str) -> None:
        if filename != ":memory:":
            Path(filename).parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(filename)
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA foreign_keys=ON")
        self.db.executescript("""
            CREATE TABLE IF NOT EXISTS conversations (
                id TEXT PRIMARY KEY, endpoint TEXT NOT NULL, notebook TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS active_conversations (
                endpoint TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id));
            CREATE TABLE IF NOT EXISTS turns (
                conversation_id TEXT NOT NULL REFERENCES conversations(id),
                turn_id INTEGER NOT NULL, created_at TEXT NOT NULL, summary TEXT NOT NULL,
                messages TEXT NOT NULL, search_text TEXT NOT NULL, chars INTEGER NOT NULL,
                PRIMARY KEY(conversation_id, turn_id));
            CREATE TABLE IF NOT EXISTS conversation_metadata (
                conversation_id TEXT PRIMARY KEY REFERENCES conversations(id), created_at TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS turn_display (
                conversation_id TEXT NOT NULL, turn_id INTEGER NOT NULL, details TEXT NOT NULL,
                PRIMARY KEY(conversation_id,turn_id),
                FOREIGN KEY(conversation_id,turn_id) REFERENCES turns(conversation_id,turn_id));
            CREATE TABLE IF NOT EXISTS session_endpoints (
                endpoint TEXT PRIMARY KEY, legacy_import_blocked INTEGER NOT NULL DEFAULT 0);
        """)

    def activate(self, endpoint: str, *, new: bool = False) -> str | None:
        row = self.db.execute("SELECT conversation_id FROM active_conversations WHERE endpoint=?",
                              (endpoint,)).fetchone()
        if row and not new:
            return row[0]
        if not new and self.db.execute("SELECT 1 FROM session_endpoints WHERE endpoint=?", (endpoint,)).fetchone():
            return None
        conversation_id = uuid.uuid4().hex
        with self.db:
            self.db.execute("INSERT OR IGNORE INTO session_endpoints VALUES (?,0)", (endpoint,))
            self.db.execute("INSERT INTO conversations VALUES (?,?,?)",
                            (conversation_id, endpoint, encode(empty_notebook())))
            self.db.execute("INSERT OR REPLACE INTO active_conversations VALUES (?,?)",
                            (endpoint, conversation_id))
            self.db.execute("INSERT INTO conversation_metadata VALUES (?,?)",
                            (conversation_id, datetime.now(timezone.utc).isoformat()))
        return conversation_id

    def legacy_import_allowed(self, endpoint: str) -> bool:
        row = self.db.execute("SELECT legacy_import_blocked FROM session_endpoints WHERE endpoint=?", (endpoint,)).fetchone()
        return not row or not row[0]

    def delete_conversation(self, endpoint: str, conversation_id: str, rag_path: str | None = None,
                            secret: str = "") -> dict[str, Any]:
        """Delete an owned archive and exclusive derived records as one transaction."""
        self._check_owner(endpoint, conversation_id)
        attached = False
        try:
            if rag_path and Path(rag_path).is_file():
                self.db.execute("ATTACH DATABASE ? AS deletion_rag", (rag_path,))
                attached = True
            with self.db:
                active = self.db.execute("SELECT conversation_id FROM active_conversations WHERE endpoint=?", (endpoint,)).fetchone()
                sessions = [row for row in self.list_conversations(endpoint, secret) if row["id"] != conversation_id]
                selected = active[0] if active and active[0] != conversation_id else (sessions[0]["id"] if sessions else None)
                history = self.selection_history(endpoint, selected) if selected else []
                if selected:
                    self.display_history(endpoint, selected)
                if attached:
                    tables = {r[0] for r in self.db.execute("SELECT name FROM deletion_rag.sqlite_master WHERE type='table'")}
                    if "vectors" in tables:
                        digest = lambda text: hashlib.sha256(encode(text).encode("utf-8")).hexdigest()
                        owned = {digest(r[0]) for r in self.db.execute("SELECT summary FROM turns WHERE conversation_id=?", (conversation_id,))}
                        shared = {digest(r[0]) for r in self.db.execute("SELECT summary FROM turns WHERE conversation_id<>?", (conversation_id,))}
                        if "nodes" in tables:
                            shared.update(r[0] for r in self.db.execute("SELECT hash FROM deletion_rag.nodes"))
                        self.db.executemany("DELETE FROM deletion_rag.vectors WHERE hash=?", [(h,) for h in owned-shared])
                self.db.execute("DELETE FROM turn_display WHERE conversation_id=?", (conversation_id,))
                self.db.execute("DELETE FROM turns WHERE conversation_id=?", (conversation_id,))
                self.db.execute("DELETE FROM conversation_metadata WHERE conversation_id=?", (conversation_id,))
                if self.db.execute("SELECT 1 FROM sqlite_master WHERE name='failed_runs' AND type='table'").fetchone():
                    self.db.execute("DELETE FROM failed_runs WHERE conversation_id=?", (conversation_id,))
                self.db.execute("DELETE FROM active_conversations WHERE endpoint=?", (endpoint,))
                if selected:
                    self.db.execute("INSERT INTO active_conversations VALUES (?,?)", (endpoint, selected))
                self.db.execute("DELETE FROM conversations WHERE id=? AND endpoint=?", (conversation_id, endpoint))
                self.db.execute("INSERT OR REPLACE INTO session_endpoints VALUES (?,1)", (endpoint,))
            return {"selectedId":selected, "sessions":sessions, "history":history, "legacyImportAllowed":False}
        finally:
            if attached:
                self.db.execute("DETACH DATABASE deletion_rag")

    def _check_owner(self, endpoint: str, conversation_id: str) -> None:
        if not isinstance(conversation_id, str) or not self.db.execute(
                "SELECT 1 FROM conversations WHERE id=? AND endpoint=?", (conversation_id, endpoint)).fetchone():
            raise AgentError("SESSION_NOT_FOUND", "会话不属于当前服务")

    def select(self, endpoint: str, conversation_id: str) -> None:
        self._check_owner(endpoint, conversation_id)
        with self.db:
            self.db.execute("INSERT OR REPLACE INTO active_conversations VALUES (?,?)", (endpoint, conversation_id))

    def selection_history(self, endpoint: str, conversation_id: str) -> list[dict[str, Any]]:
        """Validate the entire target archive without publishing an active selection."""
        self._check_owner(endpoint, conversation_id)
        recent = deque(maxlen=30)
        for expected, row in enumerate(self.db.execute(
                "SELECT turn_id,messages FROM turns WHERE conversation_id=? ORDER BY turn_id", (conversation_id,)), 1):
            turn = json.loads(row["messages"])
            if row["turn_id"] != expected or not isinstance(turn, list):
                raise AgentError("INVALID_HISTORY", "目标会话历史损坏，未切换会话")
            validate_turn(turn, completed=True)
            recent.append(turn)
        if not isinstance(self.notebook(conversation_id), dict):
            raise AgentError("INVALID_HISTORY", "目标会话笔记损坏，未切换会话")
        return [message for turn in recent for message in turn]

    def list_conversations(self, endpoint: str, secret: str = "") -> list[dict[str, Any]]:
        rows = self.db.execute("""
            SELECT c.id, COALESCE((SELECT MAX(created_at) FROM turns WHERE conversation_id=c.id),m.created_at,'') updated_at,
                   (SELECT messages FROM turns WHERE conversation_id=c.id ORDER BY turn_id LIMIT 1) first_messages
            FROM conversations c LEFT JOIN conversation_metadata m ON c.id=m.conversation_id
            WHERE c.endpoint=? ORDER BY updated_at DESC,c.id
        """, (endpoint,))
        result = []
        for row in rows:
            text = json.loads(row["first_messages"])[0]["content"] if row["first_messages"] else "新会话"
            title = redact(text, secret)
            result.append({"id": row["id"], "title": " ".join(title.split())[:48], "updatedAt": row["updated_at"]})
        return result

    def display_history(self, endpoint: str, conversation_id: str, before: int | None = None) -> dict[str, Any]:
        self._check_owner(endpoint, conversation_id)
        if before is not None and (type(before) is not int or before < 1):
            raise AgentError("INVALID_SESSION_CURSOR", "无效历史页码")
        rows = self.db.execute("""
            SELECT t.turn_id,t.messages,d.details FROM turns t LEFT JOIN turn_display d
            ON t.conversation_id=d.conversation_id AND t.turn_id=d.turn_id
            WHERE t.conversation_id=? AND (? IS NULL OR t.turn_id<?) ORDER BY t.turn_id DESC LIMIT 21
        """, (conversation_id, before, before)).fetchall()
        turns = []
        for row in reversed(rows[:20]):
            messages = json.loads(row["messages"])
            turns.append({"turnId": row["turn_id"], "user": messages[0]["content"],
                          "assistant": messages[-1]["content"],
                          "details": json.loads(row["details"]) if row["details"] else None})
        return {"conversationId": conversation_id, "turns": turns,
                "before": turns[0]["turnId"] if len(rows) > 20 else None}

    def directory(self, conversation_id: str) -> list[dict[str, Any]]:
        return [dict(row) for row in self.db.execute(
            "SELECT turn_id,summary FROM turns WHERE conversation_id=? ORDER BY turn_id",
            (conversation_id,))]

    def notebook(self, conversation_id: str) -> dict[str, Any]:
        row = self.db.execute("SELECT notebook FROM conversations WHERE id=?", (conversation_id,)).fetchone()
        if not row:
            raise AgentError("MEMORY_NOT_FOUND", "Conversation memory is unavailable")
        return json.loads(row[0])

    def recent_history(self, conversation_id: str) -> list[dict[str, Any]]:
        # Working cache only; all earlier turns remain in SQLite and the directory.
        rows = self.db.execute("SELECT messages FROM turns WHERE conversation_id=? ORDER BY turn_id DESC LIMIT 30",
                               (conversation_id,)).fetchall()
        return [message for row in reversed(rows) for message in json.loads(row[0])]

    def commit(self, conversation_id: str, turn_id: int, messages: list[dict[str, Any]],
               notebook: dict[str, Any], details: dict[str, Any] | None = None) -> None:
        with self.db:
            self._insert_turn(conversation_id, turn_id, messages, notebook)
            if details is not None:
                self.db.execute("INSERT INTO turn_display VALUES (?,?,?)", (conversation_id, turn_id, encode(details)))

    def import_turns(self, conversation_id: str, turns: list[list[dict[str, Any]]]) -> None:
        """Import the legacy display cache atomically, including validation failures."""
        notebook = self.notebook(conversation_id)
        with self.db:
            for index, messages in enumerate(turns, 1):
                self._insert_turn(conversation_id, index, messages, notebook)

    def _insert_turn(self, conversation_id: str, turn_id: int, messages: list[dict[str, Any]],
                     notebook: dict[str, Any]) -> None:
        if not self.db.execute("SELECT 1 FROM conversations WHERE id=?", (conversation_id,)).fetchone():
            raise AgentError("SESSION_NOT_FOUND", "会话已删除，拒绝迟到记录")
        validate_turn(messages, completed=True)
        summary = short_summary(messages)
        directory = self.directory(conversation_id)
        if turn_id != len(directory) + 1:
            raise AgentError("MEMORY_CONFLICT", "Conversation changed; retry the turn")
        if len(encode([*directory, {"turn_id": turn_id, "summary": summary}])) > MAX_DIRECTORY_CHARS:
            raise AgentError("MEMORY_DIRECTORY_FULL", "Full memory directory exceeds its safe limit; start a new conversation")
        text = encode(messages)
        self.db.execute("INSERT INTO turns VALUES (?,?,?,?,?,?,?)",
                        (conversation_id, turn_id, datetime.now(timezone.utc).isoformat(),
                         summary, text, text.casefold(), len(text)))
        self.db.execute("UPDATE conversations SET notebook=? WHERE id=?", (encode(notebook), conversation_id))

    def search(self, conversation_id: str, query: str, limit: int, offset: int) -> dict[str, Any]:
        keywords = query.casefold().split()
        conditions = " AND ".join("instr(search_text, ?) > 0" for _ in keywords)
        rows = self.db.execute(
            "SELECT turn_id,created_at,summary,chars FROM turns WHERE conversation_id=? AND "
            + conditions + " ORDER BY turn_id LIMIT ? OFFSET ?",
            (conversation_id, *keywords, limit + 1, offset)).fetchall()
        return {"matches": [dict(row) for row in rows[:limit]],
                "next_offset": offset + limit if len(rows) > limit else None,
                "metadata_only": True}

    def read(self, conversation_id: str, start: int, count: int, offset: int) -> dict[str, Any]:
        rows = self.db.execute(
            "SELECT turn_id,messages FROM turns WHERE conversation_id=? AND turn_id>=? AND turn_id<? ORDER BY turn_id",
            (conversation_id, start, start + count)).fetchall()
        if not rows:
            raise AgentError("MEMORY_NOT_FOUND", "No completed turn in this range")
        text = encode([{"turn_id": row[0], "messages": json.loads(row[1])} for row in rows])
        if offset >= len(text):
            raise AgentError("INVALID_TOOL_ARGUMENTS", "Memory offset is outside the record")
        fragment = text[offset:offset + READ_CHUNK_CHARS]
        next_offset = offset + len(fragment)
        return {"start_turn_id": start, "count": count, "turn_ids": [row[0] for row in rows],
                "format": "json_text_fragment", "offset": offset, "total_chars": len(text),
                "text": fragment, "complete": next_offset == len(text),
                "next_offset": next_offset if next_offset < len(text) else None}


class MemorySession:
    """Per-run snapshot: notebook edits are staged until the response commits."""
    def __init__(self, store: MemoryStore, conversation_id: str) -> None:
        self.store = store
        self.conversation_id = conversation_id
        self.directory = store.directory(conversation_id)
        self.current_turn = len(self.directory) + 1
        self.notebook = store.notebook(conversation_id)
        self.read_chars = 0

    def model_context(self) -> dict[str, Any]:
        return {"current_turn": self.current_turn, "completed_turns": len(self.directory),
                "summary_kind": "extractive_index", "directory": self.directory,
                "notebook": deepcopy(self.notebook)}

    def update_notebook(self, patch: Mapping[str, Any]) -> dict[str, Any]:
        value = deepcopy(self.notebook)
        for key in ("goal", "constraints", "decisions"):
            if key in patch:
                value[key] = deepcopy(patch[key])
        if "notes" in patch:
            for key, note in patch["notes"].items():
                if note is None:
                    value["notes"].pop(key, None)
                else:
                    value["notes"][key] = note
        value["revision"] += 1
        value["updated_in_turn"] = self.current_turn
        if len(value["notes"]) > 32 or len(encode(value)) > MAX_NOTEBOOK_CHARS:
            raise AgentError("NOTEBOOK_FULL", "Notebook exceeds its safe size; consolidate notes first")
        self.notebook = value
        return {"revision": value["revision"], "updated_in_turn": self.current_turn,
                "staged": True, "commits_on_success": True}

    def tools(self) -> list[BaseTool]:
        return [MemoryTool(self, "search_memory"), MemoryTool(self, "read_memory"),
                MemoryTool(self, "update_notebook")]


class MemoryTool(BaseTool):
    def __init__(self, session: MemorySession, name: str) -> None:
        self.session = session
        self.name = name
        schemas = {
            "search_memory": (TOOL_DESCRIPTIONS["search_memory"],
                              ["query"], {"query": {"type": "string", "maxLength": 160}, "limit": {"type": "integer", "minimum": 1, "maximum": 5}, "offset": {"type": "integer", "minimum": 0}}),
            "read_memory": (TOOL_DESCRIPTIONS["read_memory"],
                            ["start_turn_id"], {"start_turn_id": {"type": "integer", "minimum": 1}, "count": {"type": "integer", "minimum": 1, "maximum": 5}, "offset": {"type": "integer", "minimum": 0}}),
            "update_notebook": (TOOL_DESCRIPTIONS["update_notebook"],
                                [], {"goal": {"type": "string", "maxLength": 512}, "constraints": {"type": "array", "maxItems": 16, "items": {"type": "string", "maxLength": 256}}, "decisions": {"type": "array", "maxItems": 16, "items": {"type": "string", "maxLength": 256}}, "notes": {"type": "object", "additionalProperties": {"type": ["string", "null"], "maxLength": 512}}}),
        }
        self.description, required, properties = schemas[name]
        self.parameters = {"type": "object", "additionalProperties": False,
                           "required": required, "properties": properties}

    def validate(self, arguments: Mapping[str, Any]) -> None:
        def invalid() -> None:
            raise AgentError("INVALID_TOOL_ARGUMENTS", "Invalid memory tool arguments")
        if not set(arguments).issubset(self.parameters["properties"]) or not set(self.parameters["required"]).issubset(arguments):
            invalid()
        if self.name == "update_notebook":
            if not arguments:
                invalid()
            for key, value in arguments.items():
                if key == "goal" and (not isinstance(value, str) or len(value) > 512):
                    invalid()
                if key in {"constraints", "decisions"} and (not isinstance(value, list) or len(value) > 16
                        or any(not isinstance(item, str) or len(item) > 256 for item in value)):
                    invalid()
                if key == "notes" and (not isinstance(value, dict) or len(value) > 32
                        or any(not isinstance(k, str) or not 1 <= len(k) <= 64
                               or (v is not None and (not isinstance(v, str) or len(v) > 512)) for k, v in value.items())):
                    invalid()
        else:
            if self.name == "search_memory":
                query = arguments.get("query")
                if not isinstance(query, str) or not query.strip() or len(query) > 160:
                    invalid()
            for key, value in arguments.items():
                if key == "query":
                    continue
                upper = 5 if key in {"limit", "count"} else 1_000_000_000
                lower = 0 if key == "offset" else 1
                if type(value) is not int or not lower <= value <= upper:
                    invalid()

    async def execute(self, arguments: Mapping[str, Any]) -> dict[str, Any]:
        session = self.session
        if self.name == "update_notebook":
            return session.update_notebook(arguments)
        if self.name == "search_memory":
            return session.store.search(session.conversation_id, arguments["query"],
                                        arguments.get("limit", 5), arguments.get("offset", 0))
        if session.read_chars + READ_CHUNK_CHARS > MAX_READ_CHARS_PER_RUN:
            raise AgentError("MEMORY_READ_LIMIT", "Per-turn memory reading budget exhausted")
        result = session.store.read(session.conversation_id, arguments["start_turn_id"],
                                    arguments.get("count", 1), arguments.get("offset", 0))
        session.read_chars += len(result["text"])
        return result
