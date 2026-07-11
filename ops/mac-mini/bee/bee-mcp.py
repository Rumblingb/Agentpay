#!/usr/bin/env python3
"""Bee MCP server: one safe structured front door for Codex, Claude, and Hermes.

The server reads the board directly for low-latency views, but all lifecycle writes
go through bee.mjs so packets, events, memory, routing, and founder gates stay in
one place.
"""

import json
import os
import re
import sqlite3
import subprocess
from pathlib import Path
from typing import Any, Optional

from mcp.server.fastmcp import FastMCP

BEE_DIR = Path(os.environ.get("BEE_DIR", Path.home() / ".bee"))
BEE_DB = Path(os.environ.get("BEE_DB", BEE_DIR / "labs-board.db"))
VAULT = Path(os.environ.get("BEE_VAULT", Path.home() / "Documents" / "memorybrain"))
BEE_MJS = Path(__file__).with_name("bee.mjs")
NODE = os.environ.get("BEE_NODE", "node")
TASK_PACKET_DIR = VAULT / "Agent-Shared" / "bee-tasks"
MEM_FILE = VAULT / "Agent-Shared" / "Bee-Memory.md"

ALLOWED_STATUSES = {"inbox", "routed", "in_progress", "blocked", "done"}
ALLOWED_LANES = {"labs", "fund"}
SAFE_TOKEN = re.compile(r"^[a-zA-Z0-9_.:@/-]{1,120}$")

mcp = FastMCP("bee")


def _error(message: str, **extra: Any) -> dict:
    out = {"ok": False, "error": message}
    out.update(extra)
    return out


def _db() -> sqlite3.Connection:
    if not BEE_DB.exists():
        raise FileNotFoundError(f"Bee database not found: {BEE_DB}")
    conn = sqlite3.connect(str(BEE_DB))
    conn.row_factory = sqlite3.Row
    return conn


def _run_bee(*args: str, timeout: int = 45) -> dict:
    env = os.environ.copy()
    env.setdefault("BEE_SILENT", "1")
    try:
        proc = subprocess.run(
            [NODE, str(BEE_MJS), *[str(a) for a in args]],
            capture_output=True,
            text=True,
            timeout=timeout,
            env=env,
            cwd=str(BEE_MJS.parent),
        )
    except subprocess.TimeoutExpired:
        return _error("bee command timed out", command=list(args))
    except Exception as exc:
        return _error(f"bee command failed to launch: {exc}", command=list(args))
    # State is consumed as JSON by bee_state/bee_approvals/bee_registry. Keep the
    # complete payload for that command; tail truncation can cut the JSON in half.
    stdout = proc.stdout if args and args[0] == "state" else proc.stdout[-6000:]
    return {
        "ok": proc.returncode == 0,
        "returncode": proc.returncode,
        "stdout": stdout,
        "stderr": proc.stderr[-3000:],
        "command": ["bee", *args],
    }


def _state_json() -> dict:
    result = _run_bee("state", timeout=20)
    if not result["ok"]:
        return result
    try:
        return {"ok": True, "state": json.loads(result["stdout"])}
    except json.JSONDecodeError:
        return _error("bee state was not JSON", stdout=result["stdout"], stderr=result["stderr"])


def _tail(path: Path, chars: int = 8000) -> str:
    try:
        text = path.read_text(errors="replace")
    except FileNotFoundError:
        return ""
    return text[-chars:]


def _safe_status(status: Optional[str]) -> Optional[str]:
    if not status:
        return None
    if status not in ALLOWED_STATUSES:
        raise ValueError(f"unsupported status: {status}")
    return status


def _safe_lane(lane: Optional[str]) -> Optional[str]:
    if not lane:
        return None
    if lane not in ALLOWED_LANES:
        raise ValueError(f"unsupported lane: {lane}")
    return lane


def _safe_assignee(assignee: Optional[str]) -> Optional[str]:
    if not assignee:
        return None
    if not SAFE_TOKEN.match(assignee):
        raise ValueError("assignee contains unsupported characters")
    return assignee


def _row_to_task(row: sqlite3.Row) -> dict:
    task = dict(row)
    packet = TASK_PACKET_DIR / f"{task['id']}.md"
    task["packet"] = str(packet)
    task["packet_exists"] = packet.exists()
    return task


@mcp.tool()
def bee_state() -> dict:
    """Return Bee's unified state snapshot from the real Bee CLI."""
    return _state_json()


@mcp.tool()
def bee_tasks(
    assignee: Optional[str] = None,
    status: Optional[str] = "routed",
    lane: Optional[str] = None,
    needs_human: Optional[bool] = None,
    limit: int = 20,
) -> dict:
    """List Bee tasks with safe filters; use this before claiming work."""
    try:
        assignee = _safe_assignee(assignee)
        status = _safe_status(status)
        lane = _safe_lane(lane)
    except ValueError as exc:
        return _error(str(exc))
    limit = max(1, min(int(limit or 20), 100))
    clauses = []
    params = []
    if assignee:
        clauses.append("assignee = ?")
        params.append(assignee)
    if status:
        clauses.append("status = ?")
        params.append(status)
    if lane:
        clauses.append("lane = ?")
        params.append(lane)
    if needs_human is not None:
        clauses.append("needs_human = ?")
        params.append(1 if needs_human else 0)
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    try:
        with _db() as conn:
            rows = conn.execute(
                f"""SELECT id,title,body,lane,assignee,status,model_tier,needs_human,
                           approval_ready,rationale,result,created_at,updated_at
                    FROM tasks {where}
                    ORDER BY CASE status WHEN 'routed' THEN 0 WHEN 'in_progress' THEN 1
                                         WHEN 'blocked' THEN 2 ELSE 3 END,
                             updated_at DESC
                    LIMIT ?""",
                [*params, limit],
            ).fetchall()
        tasks = [_row_to_task(row) for row in rows]
        return {"ok": True, "count": len(tasks), "tasks": tasks}
    except Exception as exc:
        return _error(str(exc))


@mcp.tool()
def bee_task(id: str, include_packet: bool = True) -> dict:
    """Read one task, recent events, and its Obsidian packet."""
    if not SAFE_TOKEN.match(id or ""):
        return _error("invalid task id")
    try:
        with _db() as conn:
            row = conn.execute(
                """SELECT id,title,body,lane,difficulty,risk,assignee,model_tier,status,
                          needs_human,rationale,result,approval_ready,approval_packet,
                          source_key,created_by,created_at,updated_at
                   FROM tasks WHERE id = ?""",
                [id],
            ).fetchone()
            if not row:
                return _error("task not found", id=id)
            events = conn.execute(
                "SELECT kind,detail,at FROM events WHERE task_id = ? ORDER BY at DESC LIMIT 25",
                [id],
            ).fetchall()
        task = _row_to_task(row)
        payload = {"ok": True, "task": task, "events": [dict(e) for e in events]}
        if include_packet:
            payload["packet_text"] = _tail(TASK_PACKET_DIR / f"{id}.md")
        return payload
    except Exception as exc:
        return _error(str(exc), id=id)


@mcp.tool()
def bee_create(request: str, created_by: str = "mcp") -> dict:
    """Create, route, and dispatch a Bee task. This never bypasses Bee's safety gates."""
    request = (request or "").strip()
    if len(request) < 3:
        return _error("request is too short")
    if not SAFE_TOKEN.match(created_by or ""):
        return _error("created_by contains unsupported characters")
    return _run_bee("create", request[:4000], "--by", created_by)


@mcp.tool()
def bee_claim(id: str, agent: str = "mcp") -> dict:
    """Claim a routed Bee task by moving it to in_progress through Bee."""
    if not SAFE_TOKEN.match(id or "") or not SAFE_TOKEN.match(agent or ""):
        return _error("invalid id or agent")
    return _run_bee("start", id, f"claimed by {agent}")


@mcp.tool()
def bee_done(id: str, evidence: str) -> dict:
    """Close a task as done with concrete evidence. Use bee_block if evidence is missing."""
    evidence = (evidence or "").strip()
    if not SAFE_TOKEN.match(id or ""):
        return _error("invalid task id")
    if len(evidence) < 12:
        return _error("done requires concrete evidence")
    return _run_bee("done", id, evidence[:1200])


@mcp.tool()
def bee_block(id: str, reason: str) -> dict:
    """Block a task with a clear reason or missing prerequisite."""
    reason = (reason or "").strip()
    if not SAFE_TOKEN.match(id or ""):
        return _error("invalid task id")
    if len(reason) < 3:
        return _error("block requires a reason")
    return _run_bee("block", id, reason[:1200])


@mcp.tool()
def bee_dispatch(id: Optional[str] = None) -> dict:
    """Dispatch one routed card or all routed cards to fleet inboxes."""
    if id and not SAFE_TOKEN.match(id):
        return _error("invalid task id")
    return _run_bee("dispatch", id or "all")


@mcp.tool()
def bee_prepare_approval(id: str = "all", refresh: bool = False) -> dict:
    """Prepare founder-gated work to the final safe step; does not approve or execute it."""
    if id != "all" and not SAFE_TOKEN.match(id or ""):
        return _error("invalid task id")
    args = ["prepare-approval", id]
    if refresh:
        args.append("--refresh")
    return _run_bee(*args, timeout=60)


@mcp.tool()
def bee_approvals() -> dict:
    """List founder-only approval/final-step items."""
    state = _state_json()
    if not state.get("ok"):
        return state
    return {
        "ok": True,
        "approvals": state.get("state", {}).get("approvals", []),
        "actions": state.get("state", {}).get("actions", []),
        "mandates": state.get("state", {}).get("mandates", []),
    }


@mcp.tool()
def bee_run_blueprint(key: str) -> dict:
    """Run a Bee blueprint such as project-operator or polsia-completion."""
    if not SAFE_TOKEN.match(key or ""):
        return _error("invalid blueprint key")
    return _run_bee("run", key, timeout=90)


@mcp.tool()
def bee_memory(tail_lines: int = 30) -> dict:
    """Read the tail of Bee's Obsidian memory bank."""
    tail_lines = max(1, min(int(tail_lines or 30), 120))
    text = _tail(MEM_FILE, chars=24000)
    return {"ok": True, "memory": "\n".join(text.splitlines()[-tail_lines:])}


@mcp.tool()
def bee_remember(note: str) -> dict:
    """Append a coordination note to Bee memory through the real Bee CLI."""
    note = (note or "").strip()
    if len(note) < 3:
        return _error("note is too short")
    return _run_bee("remember", note[:2000])


@mcp.tool()
def bee_registry() -> dict:
    """Return current worker registry and Bee fleet state."""
    reg_file = BEE_DIR / "registry.json"
    try:
        registry = json.loads(reg_file.read_text())
    except Exception:
        registry = {"agents": [], "skills": [], "mcp": []}
    state = _state_json()
    return {
        "ok": bool(state.get("ok")),
        "registry": registry,
        "fleet_state": state.get("state") if state.get("ok") else None,
        "state_error": None if state.get("ok") else state,
    }


@mcp.tool()
def bee_policy() -> dict:
    """Return the hard safety contract MCP clients must obey."""
    return {
        "ok": True,
        "policy": [
            "Use Bee for create, claim, block, done, dispatch, memory, and final-step preparation.",
            "External sends, publishes, uploads, OAuth/account changes, credentials, permissions, and money are prepare-only until founder approval.",
            "Fund execution is never autonomous. Bee may stage/read/research only; founder executes outside Bee.",
            "Close done only with concrete evidence; otherwise block with the missing prerequisite.",
        ],
    }


if __name__ == "__main__":
    mcp.run()
