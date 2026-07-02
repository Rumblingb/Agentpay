#!/usr/bin/env python3
"""Bee MCP Server — unified agent communication layer for Hermes/Codex/Claude using FastMCP"""

import json
import sqlite3
from pathlib import Path
from mcp.server.fastmcp import FastMCP

BEE_DIR = Path.home() / '.bee'
VAULT = Path.home() / 'Documents/memorybrain'

mcp = FastMCP('bee')

@mcp.tool()
def bee_inbox_read(assignee: str = None, status: str = 'routed') -> dict:
    """Read assigned tasks from Bee board"""
    db_path = BEE_DIR / 'labs-board.db'
    if not db_path.exists():
        return {'tasks': [], 'count': 0}
    
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    try:
        if assignee:
            cur = conn.execute(f"SELECT id,title,body,assignee,status,model_tier,needs_human,rationale FROM tasks WHERE assignee='{assignee}' AND status='{status}' ORDER BY created_at DESC LIMIT 10")
        else:
            cur = conn.execute(f"SELECT id,title,body,assignee,status,model_tier,needs_human,rationale FROM tasks WHERE status='{status}' ORDER BY created_at DESC LIMIT 10")
        rows = [dict(r) for r in cur.fetchall()]
        return {'tasks': rows, 'count': len(rows)}
    finally:
        conn.close()

@mcp.tool()
def bee_inbox_claim(id: str, agent: str = 'unknown') -> dict:
    """Claim a task for execution"""
    import time
    db_path = BEE_DIR / 'labs-board.db'
    if not db_path.exists():
        return {'error': 'No database'}
    
    conn = sqlite3.connect(str(db_path))
    try:
        conn.execute(f"UPDATE tasks SET assignee='{agent}',status='in_progress',updated_at={int(time.time())} WHERE id='{id}'")
        conn.commit()
        return {'claimed': id, 'by': agent}
    finally:
        conn.close()

@mcp.tool()
def bee_outcome_report(id: str, result: str = '', status: str = 'done') -> dict:
    """Report task completion result"""
    import time
    db_path = BEE_DIR / 'labs-board.db'
    if not db_path.exists():
        return {'error': 'No database'}
    
    conn = sqlite3.connect(str(db_path))
    try:
        conn.execute(f"UPDATE tasks SET status='{status}',result='{(result or '')[:500]}',updated_at={int(time.time())} WHERE id='{id}'")
        conn.commit()
        return {'reported': id, 'status': status}
    finally:
        conn.close()

@mcp.tool()
def bee_registry_consult() -> dict:
    """Query agent capabilities and state"""
    reg_file = BEE_DIR / 'registry.json'
    try:
        reg = json.loads(reg_file.read_text())
    except:
        reg = {'agents': [], 'skills': []}
    
    state_file = BEE_DIR / 'state.json'
    try:
        state = json.loads(state_file.read_text())
        return {'agents': reg.get('agents', []), 'skills': reg.get('skills', []), 'mcp': reg.get('mcp', []), 'fleet_state': state.get('state'), 'presence': state.get('presence')}
    except:
        return {'agents': reg.get('agents', []), 'skills': reg.get('skills', []), 'mcp': reg.get('mcp', [])}

@mcp.tool()
def bee_state_poll() -> dict:
    """Get unified fleet state snapshot"""
    db_path = BEE_DIR / 'labs-board.db'
    if not db_path.exists():
        return {'error': 'No database'}
    
    conn = sqlite3.connect(str(db_path))
    try:
        routed = conn.execute("SELECT count(*) as c FROM tasks WHERE status='routed'").fetchone()[0]
        active = conn.execute("SELECT count(*) as c FROM tasks WHERE status='in_progress'").fetchone()[0]
        blocked = conn.execute("SELECT count(*) as c FROM tasks WHERE status='blocked'").fetchone()[0]
        state = 'active' if (routed > 0 or active > 0) else 'idle'
        return {'timestamp': int(__import__('time').time()), 'state': state, 'stats': {'routed': routed, 'active': active, 'blocked': blocked}}
    finally:
        conn.close()

@mcp.tool()
def bee_memory_query(keys: list = None) -> dict:
    """Query shared vault notes"""
    if keys is None:
        keys = []
    out = {}
    for k in keys:
        path = VAULT / 'Agent-Shared' / f'{k}.md'
        try:
            out[k] = path.read_text()[:2000]
        except:
            out[k] = '(not found)'
    return out

if __name__ == '__main__':
    mcp.run()