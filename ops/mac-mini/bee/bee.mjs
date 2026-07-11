#!/usr/bin/env node
// Bee — founder control plane for the AgentPay fleet.
// Labs work may run autonomously; fund execution and external side effects are approval-gated.
// Storage: sqlite3 CLI (dependency-free). DB: ~/.bee/labs-board.db
// Spec: Agentpay/ops/mac-mini/BEE_ARCHITECTURE.md

import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, existsSync, readFileSync, readdirSync, renameSync, writeFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const BEE_DIR = join(homedir(), '.bee');
const DB = process.env.BEE_DB || join(BEE_DIR, 'labs-board.db');
const INBOX_DIR = join(BEE_DIR, 'inbox');           // drop a *.txt request here → daemon routes it
const VAULT = join(homedir(), 'Documents/memorybrain'); // fleet shared brain (agents read their lane inbox)
for (const d of [BEE_DIR, INBOX_DIR, join(INBOX_DIR, 'done')]) if (!existsSync(d)) mkdirSync(d, { recursive: true });

// Load ~/.bee/.env (local secrets: NVIDIA_API_KEY, …) into process.env — keys stay out of source + git.
(function loadEnv() {
  try {
    for (const line of readFileSync(join(BEE_DIR, '.env'), 'utf8').split('\n')) {
      if (/^\s*#/.test(line) || !line.includes('=')) continue;
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch {}
})();

// ---------- sqlite helpers ----------
const esc = (s) => String(s ?? '').replace(/'/g, "''");
function sql(query, { json = false } = {}) {
  const args = json ? ['-json', DB, query] : [DB, query];
  const out = execFileSync('sqlite3', args, { encoding: 'utf8' });
  if (!json) return out.trim();
  return out.trim() ? JSON.parse(out) : [];
}
const now = () => Math.floor(Date.now() / 1000);
const rid = (p) => `${p}_${now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
function writeJSONAtomic(file, value, mode = 0o600) {
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2), { mode });
  renameSync(tmp, file);
  try { chmodSync(file, mode); } catch {}
}

// ---------- schema ----------
function init() {
  sql(`
  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    body TEXT,
    lane TEXT NOT NULL DEFAULT 'labs',        -- labs|fund (fund autonomy is read-only)
    difficulty TEXT,                           -- trivial|standard|hard
    risk TEXT,                                 -- low|medium|high
    assignee TEXT,                             -- worker chosen by router
    model_tier TEXT,                           -- native|local|free|paid|paid-heavy|human
    status TEXT NOT NULL DEFAULT 'inbox',      -- inbox|routed|in_progress|blocked|done
    needs_human INTEGER NOT NULL DEFAULT 0,    -- the approval-wall flag
    rationale TEXT,
    result TEXT,                               -- worker output excerpt
    approval_ready INTEGER NOT NULL DEFAULT 0,
    approval_packet TEXT,
    source_key TEXT,                           -- stable origin for dedupe (blueprint/project/etc.)
    created_by TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT, kind TEXT, detail TEXT, at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
  `);
  // migrate older DBs that predate the result column
  const cols = sql(`PRAGMA table_info(tasks);`, { json: true }).map((c) => c.name);
  if (!cols.includes('result')) sql(`ALTER TABLE tasks ADD COLUMN result TEXT;`);
  if (!cols.includes('approval_ready')) sql(`ALTER TABLE tasks ADD COLUMN approval_ready INTEGER NOT NULL DEFAULT 0;`);
  if (!cols.includes('approval_packet')) sql(`ALTER TABLE tasks ADD COLUMN approval_packet TEXT;`);
  if (!cols.includes('source_key')) sql(`ALTER TABLE tasks ADD COLUMN source_key TEXT;`);
  sql(`CREATE INDEX IF NOT EXISTS idx_tasks_source_key ON tasks(source_key);`);
}

// ---------- lane detection + fund safety gate ----------
// Bee is a two-lane control plane (founder-authorized 2026-06-15). Fund lane:
//   research/analysis/backtest (read-only, no money) → autonomous on cheap workers
//   ANY execution (trade/order/money/live/bankroll) → founder-only, NEVER autonomous
const FUND_RE      = /\b(bill|hedge|trading|trade[ds]?|futures?|topstep|backtest|broker|hedge fund|p&l|pnl|clob|prediction[- ]?market|databento|bankroll)\b/i;
const FUND_EXEC_RE = /\b(execute|order|buy|sell|fill|position|go ?live|live[- ]?activat|deploy capital|withdraw|deposit|size up|increase bankroll|place .*trade|move money|transfer)\b/i;

// ---------- difficulty-classified router (the cost ladder) ----------
// Rule: cheap-by-default, but hard/high-stakes goes STRAIGHT to the heavy model.
const HUMAN_RE = /\b(oauth|log[- ]?in|sign[- ]?in|accounts?|app ?store|asc|play console|publish|upload|drag|stripe|api ?key|secret|token|\.env|mcpize|grant|2fa|verify|tiktok|instagram|facebook|connect .*channel|money|credential)\b/i;
const EXTERNAL_EFFECT_RE = /\b(submit|publish|upload|send|deploy)\b|\bpost\s+(?:to|on)\b|\brelease\s+to\b/i;
const HARD_RE  = /\b(architect|design|strategy|launch|pricing|revenue|customer|copy|narrative|brand|review|refactor|migrate|security|tradeoff)\b/i;
const IMPL_RE  = /\b(implement|build|code|fix bug|endpoint|api|test|ci|deploy|script|component|kaggle|github|app|release)\b/i;
const RESEARCH_RE = /\b(research|scrape|render|shorts?|video|summari[sz]e|monitor|sweep|draft|digest)\b/i;
const SCREEN_RE = /\b(screen|click|type into|fill .*form|browser|open .*app|navigate|on[- ]?screen|gui|window|tab|safari|chrome|button|drag)\b/i;

function safetyFloor(title, body = '') {
  const text = `${title} ${body}`.replace(/_/g, ' ');
  if (FUND_RE.test(text) && FUND_EXEC_RE.test(text)) return { ...KIND_MAP['fund-exec'] };
  if (EXTERNAL_EFFECT_RE.test(text)) return { ...KIND_MAP.human };
  if (HUMAN_RE.test(text)) return { ...KIND_MAP.human };
  return null;
}

// ---------- INTELLIGENT classifier: local LLM brain ($0) with a rule-based safety FLOOR ----------
const BRAIN_URL = process.env.BEE_BRAIN_URL || 'http://localhost:11434/v1/chat/completions';
const BRAIN_MODEL = process.env.BEE_BRAIN_MODEL || 'gemma3:12b';
// Cloud fallback: fast Nemotron for routine calls, Super for founder-level reasoning and deliverables.
const NIM_URL = process.env.BEE_NIM_URL || 'https://integrate.api.nvidia.com/v1/chat/completions';
const NIM_FAST_MODEL = process.env.BEE_NIM_FAST_MODEL || 'nvidia/nemotron-3-nano-30b-a3b';
const NIM_REASONING_MODEL = process.env.BEE_NIM_REASONING_MODEL || process.env.BEE_NIM_MODEL || 'nvidia/nemotron-3-super-120b-a12b';
function nimBrain(messages, max, model = NIM_FAST_MODEL) {
  const key = process.env.NVIDIA_API_KEY; if (!key) return '';
  const payload = JSON.stringify({ model, temperature: 0, max_tokens: max, stream: false, messages });
  try {
    const r = execFileSync('curl', ['-s', '-m', '45', NIM_URL, '-H', 'content-type: application/json', '-H', `authorization: Bearer ${key}`, '-d', payload], { encoding: 'utf8', maxBuffer: 1 << 20 });   // let deep reasoning finish (don't cut thinking short)
    return JSON.parse(r).choices?.[0]?.message?.content?.trim() || '';
  } catch { return ''; }
}
// Pull the plan JSON out of model output — reasoning models narrate first, so try the greedy match, then the last {...} block.
function extractJSON(out) {
  if (!out) return null;
  for (const s of [out.match(/\{[\s\S]*\}/)?.[0], out.slice(out.lastIndexOf('\n{')), out.slice(out.indexOf('{'))]) {
    if (!s) continue; try { return JSON.parse(s) } catch {}
  }
  return null;
}
// Local Gemma first for cheap calls; reasoning requests go directly to the stronger NIM tier.
function brain(prompt, { sys = '', max = 200, big = false } = {}) {
  const messages = [...(sys ? [{ role: 'system', content: sys }] : []), { role: 'user', content: prompt }];
  if (big) { const n = nimBrain(messages, max, NIM_REASONING_MODEL); if (n) return n; }
  try {
    const payload = JSON.stringify({ model: BRAIN_MODEL, temperature: 0, max_tokens: max, stream: false, messages });   // bound generation — unbounded runs blew the curl timeout
    const r = execFileSync('curl', ['-s', '-m', process.env.BEE_BRAIN_TIMEOUT || '40', BRAIN_URL, '-H', 'content-type: application/json', '-d', payload], { encoding: 'utf8', maxBuffer: 1 << 20 });
    const out = JSON.parse(r).choices?.[0]?.message?.content?.trim() || '';
    if (out) return out;
  } catch {}
  return nimBrain(messages, max, NIM_FAST_MODEL);
}
function llmClassify(title, body) {
  const sys = 'You are Bee, a sharp startup cofounder routing the founder\'s requests. Output ONLY compact JSON: '
    + '{"kind":one of [trivial,impl,research,judgment,human,fund-research,fund-exec],"needs_screen":bool,"say":"<spoken reply to the founder, <=12 words, natural, first person as Bee>","speak":bool}. '
    + 'kind=human if it needs a person to log in / OAuth / publish / move money / use an app store. '
    + 'kind=fund-exec ONLY for executing trades/orders/money/going-live. kind=fund-research for read-only market analysis. '
    + 'kind=judgment for design/strategy/copy/architecture/launch decisions. kind=impl for coding/building/shipping. needs_screen=true if it needs to see/control the desktop or browser GUI. '
    + 'say = what you would tell the founder out loud (e.g. "On it — handing the pricing page to Claude."). speak=true unless it is trivial/routine.';
  const out = brain(`Founder request: "${title}${body ? ' — ' + body : ''}"`, { sys });
  const m = out.match(/\{[\s\S]*\}/); if (!m) return null;
  try { const o = JSON.parse(m[0]); if (!o.kind) return null; return o; } catch { return null; }
}
const KIND_MAP = {
  'fund-exec':     { lane: 'fund', assignee: 'rajiv', model_tier: 'human', needs_human: 1, difficulty: 'standard', risk: 'high', rationale: '🔒 FUND EXECUTION — founder-only, never autonomous. Staged for your action.' },
  'fund-research': { lane: 'fund', assignee: 'hermes-lenovo', model_tier: 'free', needs_human: 0, difficulty: 'standard', risk: 'medium', rationale: 'Fund research/analysis (read-only, no money) — autonomous on cheap workers.' },
  human:    { lane: 'labs', assignee: 'rajiv', model_tier: 'human', needs_human: 1, difficulty: 'standard', risk: 'high', rationale: 'Needs a human action-time approval — staged for one-click.' },
  judgment: { lane: 'labs', assignee: 'claude', model_tier: 'paid-heavy', needs_human: 0, difficulty: 'hard', risk: 'high', rationale: 'High-stakes/judgment → heavy model (Claude Opus).' },
  impl:     { lane: 'labs', assignee: 'codex', model_tier: 'paid', needs_human: 0, difficulty: 'standard', risk: 'medium', rationale: 'Bounded implementation → Codex (gpt-5.5).' },
  research: { lane: 'labs', assignee: 'hermes-lenovo', model_tier: 'free', needs_human: 0, difficulty: 'standard', risk: 'low', rationale: 'Research/render → Hermes-Lenovo + free gateways ($0).' },
  trivial:  { lane: 'labs', assignee: 'local-gemma', model_tier: 'local', needs_human: 0, difficulty: 'trivial', risk: 'low', rationale: 'Trivial/triage → local model ($0).' },
};

function classify(title, body = '') {
  const t = `${title} ${body}`.replace(/_/g, ' ');
  // SAFETY FLOOR (rule-based, never delegated to the LLM): execution and external side effects.
  const safe = safetyFloor(title, body);
  if (safe) return safe;
  // Intelligent path: local LLM understands intent → mapped to policy in code.
  const llm = llmClassify(title, body);
  if (llm) {
    let kind = llm.kind;
    // A model cannot invent fund authority for a request that has no fund signal.
    if (!FUND_RE.test(t) && /^fund-/.test(kind)) kind = 'judgment';
    const base = KIND_MAP[kind] || KIND_MAP.trivial;
    const d = { ...base, rationale: `🧠 ${base.rationale}`, say: llm.say, speak: llm.speak !== false };
    if (llm.needs_screen && !d.needs_human) {
      if (d.lane === 'fund') { d.assignee = 'rajiv'; d.model_tier = 'human'; d.needs_human = 1; d.rationale = '🔒 Fund GUI control (broker/exec risk) — founder-only.'; }
      else { d.assignee = 'cua'; d.model_tier = 'cua'; d.rationale = '🧠🖥️ Screen/GUI control → CUA driver (Hermes computer_use, background).'; }
    }
    return d;
  }
  // FALLBACK: deterministic rules (LLM unreachable).
  return ruleClassify(title, body);
}

function ruleClassify(title, body = '') {
  const t = `${title} ${body}`.replace(/_/g, ' '); // underscores (ENV_VAR_NAMES) → spaces so \b works
  if (SCREEN_RE.test(t) && !FUND_RE.test(t) && !HUMAN_RE.test(t)) return { lane: 'labs', difficulty: 'standard', risk: 'medium', assignee: 'cua', model_tier: 'cua', needs_human: 0, rationale: '🖥️ Screen/GUI control → CUA driver.' };
  // ---- FUND lane (founder-authorized two-lane control) ----
  if (FUND_RE.test(t)) {
    if (FUND_EXEC_RE.test(t)) return { lane: 'fund', difficulty: 'standard', risk: 'high', assignee: 'rajiv', model_tier: 'human', needs_human: 1,
      rationale: '🔒 FUND EXECUTION — founder-only, never autonomous. Staged for your action.' };
    return { lane: 'fund', difficulty: 'standard', risk: 'medium', assignee: 'hermes-lenovo', model_tier: 'free', needs_human: 0,
      rationale: 'Fund research/analysis (read-only, no money) — autonomous on cheap workers.' };
  }
  // ---- LABS lane ----
  if (HUMAN_RE.test(t)) return { lane: 'labs', difficulty: 'standard', risk: 'high', assignee: 'rajiv', model_tier: 'human', needs_human: 1,
    rationale: 'Needs a human action-time approval (OAuth/login/store/money) — staged for one-click.' };
  if (HARD_RE.test(t))  return { lane: 'labs', difficulty: 'hard', risk: 'high', assignee: 'claude', model_tier: 'paid-heavy', needs_human: 0,
    rationale: 'High-stakes/judgment work → routed straight to heavy model (Claude Opus), no cheap-first.' };
  // Research/render/sweep verbs win over impl nouns (e.g. "research Kaggle …" → cheap lane)
  if (RESEARCH_RE.test(t)) return { lane: 'labs', difficulty: 'standard', risk: 'low', assignee: 'hermes-lenovo', model_tier: 'free', needs_human: 0,
    rationale: 'Research/render/sweep → Hermes-Lenovo + free gateways ($0).' };
  if (IMPL_RE.test(t))  return { lane: 'labs', difficulty: 'standard', risk: 'medium', assignee: 'codex', model_tier: 'paid', needs_human: 0,
    rationale: 'Bounded implementation → Codex (gpt-5.5).' };
  return { lane: 'labs', difficulty: 'trivial', risk: 'low', assignee: 'local-gemma', model_tier: 'local', needs_human: 0,
    rationale: 'Trivial/triage → local Gemma ($0 on-device).' };
}

function logEvent(taskId, kind, detail = '') {
  sql(`INSERT INTO events(task_id,kind,detail,at) VALUES('${esc(taskId)}','${esc(kind)}','${esc(detail)}',${now()});`);
}

// ---------- commands ----------
function create(title, { body = '', createdBy = 'bee', route = true, sourceKey = '' } = {}) {
  if (sourceKey) {
    const existing = sql(`SELECT id FROM tasks WHERE source_key='${esc(sourceKey)}' AND status!='done' ORDER BY created_at DESC LIMIT 1;`, { json: true })[0];
    if (existing) return existing.id;
  }
  const id = rid('t');
  const ts = now();
  sql(`INSERT INTO tasks(id,title,body,source_key,created_by,created_at,updated_at)
       VALUES('${esc(id)}','${esc(title)}','${esc(body)}','${esc(sourceKey)}','${esc(createdBy)}',${ts},${ts});`);
  logEvent(id, 'created', title);
  checkpointTask(id, 'created');
  if (route) routeOne(id);
  return id;
}

function routeOne(id) {
  const rows = sql(`SELECT title,body FROM tasks WHERE id='${esc(id)}';`, { json: true });
  if (!rows.length) { console.error(`no task ${id}`); return; }
  const c = classify(rows[0].title, rows[0].body || '');
  // Safety invariant: a fund EXECUTION task can never end up autonomous.
  if (c.lane === 'fund' && FUND_EXEC_RE.test(`${rows[0].title} ${rows[0].body || ''}`)) { c.needs_human = 1; c.assignee = 'rajiv'; c.model_tier = 'human'; }
  // Registry-aware implementation failover. Never downgrade judgment or approval work silently.
  if (!c.needs_human && c.assignee === 'codex' && !agentAvailable('codex')) {
    const fallback = agentAvailable('nemotron') ? 'nemotron' : (agentAvailable('claude') ? 'claude' : 'rajiv');
    c.assignee = fallback;
    c.model_tier = fallback === 'nemotron' ? 'free' : (fallback === 'claude' ? 'paid-heavy' : 'human');
    c.needs_human = fallback === 'rajiv' ? 1 : 0;
    c.rationale = `${c.rationale} ↪ Codex unavailable → ${fallback}.`;
  }
  sql(`UPDATE tasks SET lane='${c.lane}',difficulty='${c.difficulty}',risk='${c.risk}',assignee='${esc(c.assignee)}',
       model_tier='${c.model_tier}',needs_human=${c.needs_human},status='${c.needs_human ? 'blocked' : 'routed'}',
       rationale='${esc(c.rationale)}',updated_at=${now()} WHERE id='${esc(id)}';`);
  if (c.lane === 'labs' && c.needs_human) {
    const request = `${rows[0].title}${rows[0].body ? ` — ${rows[0].body}` : ''}`;
    if (isApprovableAction(request)) stageAction(request, id);
    else { const prepId = queueApprovalPrep(id); if (prepId) { c.preparing = true; c.needs_human = 0; c.assignee = 'bee'; } }
  }
  logEvent(id, 'routed', `${c.assignee}/${c.model_tier}`);
  checkpointTask(id, `routed to ${c.assignee}/${c.model_tier}`);
  printTask(id);
  return c;
}

function setStatus(id, status, detail = '') {
  const cleanDetail = String(detail || '').trim().slice(0, 1200);
  const resultSql = cleanDetail ? `,result='${esc(cleanDetail)}'` : '';
  sql(`UPDATE tasks SET status='${esc(status)}'${resultSql},updated_at=${now()} WHERE id='${esc(id)}';`);
  logEvent(id, 'status', cleanDetail ? `${status}: ${cleanDetail}` : status);
  if (status === 'done') { const r = sql(`SELECT title,assignee FROM tasks WHERE id='${esc(id)}';`, { json: true })[0]; if (r) remember(`shipped: ${r.title} (${r.assignee || '?'})${cleanDetail ? ` — ${cleanDetail.slice(0, 220)}` : ''}`, 'done'); }
  if (status === 'blocked' && cleanDetail) remember(`blocked ${id}: ${cleanDetail.slice(0, 240)}`, 'blocked');
  checkpointTask(id, cleanDetail ? `status ${status}: ${cleanDetail}` : `status ${status}`);
  console.log(`${id} → ${status}`);
}
function declineTask(id) {
  const task = sql(`SELECT id,title FROM tasks WHERE id='${esc(id)}' AND status!='done';`, { json: true })[0];
  if (!task) { console.log(`no open task ${id}`); return false; }
  sql(`UPDATE tasks SET status='done',needs_human=0,rationale='Declined by founder — no action taken.',updated_at=${now()} WHERE id='${esc(id)}';`);
  logEvent(id, 'declined', 'founder'); remember(`declined: ${task.title}`, 'approval'); console.log(`✗ ${id} declined`); return true;
}
function deferApproval(id, reason) {
  const task = sql(`SELECT id,title FROM tasks WHERE id='${esc(id)}' AND status!='done';`, { json: true })[0];
  if (!task || !reason) return false;
  sql(`UPDATE tasks SET needs_human=0,status='blocked',approval_ready=0,approval_packet=NULL,result='${esc(reason)}',rationale='Bee must resolve this before asking the founder.',updated_at=${now()} WHERE id='${esc(id)}';`);
  sql(`UPDATE tasks SET status='done',result='Approval preparation stopped: parent returned to Bee',updated_at=${now()} WHERE source_key='approval-prep:${esc(id)}' AND status!='done';`);
  logEvent(id, 'approval-deferred', reason); remember(`approval deferred ${id}: ${reason}`, 'approval'); console.log(`↩ ${id} returned to Bee: ${reason}`); return true;
}
function supersedeTask(id, reason) {
  const task = sql(`SELECT id,title FROM tasks WHERE id='${esc(id)}' AND status!='done';`, { json: true })[0];
  if (!task || !reason) return false;
  sql(`UPDATE tasks SET needs_human=0,status='done',approval_ready=0,rationale='${esc(reason)}',result='${esc(reason)}',updated_at=${now()} WHERE id='${esc(id)}';`);
  sql(`UPDATE tasks SET status='done',result='Approval preparation stopped: parent superseded',updated_at=${now()} WHERE source_key='approval-prep:${esc(id)}' AND status!='done';`);
  logEvent(id, 'superseded', reason); remember(`superseded: ${task.title} — ${reason}`, 'approval'); console.log(`✓ ${id} superseded`); return true;
}

function queueApprovalPrep(parentId) {
  const parent = sql(`SELECT id,title,body,lane,status,needs_human,approval_ready FROM tasks WHERE id='${esc(parentId)}';`, { json: true })[0];
  if (!parent || parent.lane !== 'labs' || parent.status === 'done' || parent.approval_ready) return null;
  const sourceKey = `approval-prep:${parent.id}`;
  const existing = sql(`SELECT id,status FROM tasks WHERE source_key='${esc(sourceKey)}' AND status!='done' ORDER BY created_at DESC LIMIT 1;`, { json: true })[0];
  if (existing) {
    if (existing.status === 'blocked') sql(`UPDATE tasks SET status='routed',result=NULL,updated_at=${now()} WHERE id='${esc(existing.id)}';`);
    return existing.id;
  }
  const id = create(`[Approval prep] ${parent.title}`, {
    body: `Take this founder-gated task to the final safe step. Do every non-sensitive prerequisite you can: inspect current state and artifacts, run relevant checks, fix local blockers, and produce a concise decision packet. Do not authenticate, publish, submit, move money, alter permissions, or touch the fund lane. A packet is not ready without concrete evidence. End with BEE_APPROVAL_SUMMARY: <what is ready and what the founder's single final action does> and BEE_APPROVAL_EVIDENCE: <specific checked paths, commands, statuses, or artifacts>. Add BEE_APPROVAL_URL: <https URL> only when a verified final-step URL exists. Original context: ${parent.body || '(none)'}`,
    createdBy: 'bee-approval-prep', route: false, sourceKey,
  });
  const assignee = agentAvailable('codex') ? 'codex' : (agentAvailable('claude') ? 'claude' : 'nemotron');
  const tier = assignee === 'codex' ? 'paid' : (assignee === 'nemotron' ? 'free' : 'paid-heavy');
  sql(`UPDATE tasks SET lane='labs',difficulty='standard',risk='medium',assignee='${esc(assignee)}',model_tier='${tier}',needs_human=0,status='routed',rationale='Preparing every safe prerequisite before the founder is interrupted.',updated_at=${now()} WHERE id='${esc(id)}';`);
  sql(`UPDATE tasks SET needs_human=0,status='blocked',rationale='Bee is preparing everything; this returns when only your final action remains.',approval_ready=0,updated_at=${now()} WHERE id='${esc(parent.id)}';`);
  logEvent(parent.id, 'approval-prep-started', id); dispatch(id);
  return id;
}

function approvalPacketFromOutput(output) {
  const summary = String(output).match(/BEE_APPROVAL_SUMMARY:\s*(.+)/i)?.[1]?.trim()
    || String(output).split('\n').filter((line) => line.trim() && !/^BEE_/.test(line)).slice(-4).join(' ').slice(0, 900);
  const evidence = String(output).match(/BEE_APPROVAL_EVIDENCE:\s*(.+)/i)?.[1]?.trim() || '';
  if (!summary || !evidence) return null;
  const url = String(output).match(/BEE_APPROVAL_URL:\s*(https:\/\/\S+)/i)?.[1]?.replace(/[)>.,]+$/, '') || '';
  return { summary, evidence, url };
}
function finalizeApprovalPrep(card, output) {
  const parentId = String(card.source_key || '').replace(/^approval-prep:/, '');
  if (!parentId || parentId === card.source_key) return;
  const parsed = approvalPacketFromOutput(output); if (!parsed) return false;
  const packet = { ...parsed, prepared_at: now(), prepared_by: card.assignee, prep_task_id: card.id };
  sql(`UPDATE tasks SET needs_human=1,status='blocked',approval_ready=1,approval_packet='${esc(JSON.stringify(packet))}',result='${esc(parsed.summary)}',rationale='Ready — Bee completed the preparation. Only your final action remains.',updated_at=${now()} WHERE id='${esc(parentId)}';`);
  logEvent(parentId, 'approval-ready', card.id); remember(`approval ready ${parentId}: ${parsed.summary}`, 'approval'); checkpointTask(parentId, 'approval ready'); return true;
}
function markApprovalReady(id, { summary, evidence, url = '', preparedBy = 'bee' } = {}) {
  const parent = sql(`SELECT id,lane FROM tasks WHERE id='${esc(id)}' AND status!='done';`, { json: true })[0];
  if (!parent || parent.lane !== 'labs' || !summary || !evidence) { console.log('usage: bee ready-approval <task-id> --summary "..." --evidence "..." [--url https://...]'); return false; }
  if (url && !/^https:\/\//i.test(url)) { console.log('approval URL must use https'); return false; }
  const packet = { summary, evidence, url, prepared_at: now(), prepared_by: preparedBy };
  sql(`UPDATE tasks SET needs_human=1,status='blocked',approval_ready=1,approval_packet='${esc(JSON.stringify(packet))}',result='${esc(summary)}',rationale='Ready — Bee completed the preparation. Only your final action remains.',updated_at=${now()} WHERE id='${esc(id)}';`);
  sql(`UPDATE tasks SET status='done',result='Superseded by verified approval packet',updated_at=${now()} WHERE source_key='approval-prep:${esc(id)}' AND status!='done';`);
  logEvent(id, 'approval-ready', preparedBy); remember(`approval ready ${id}: ${summary}`, 'approval'); checkpointTask(id, 'approval ready'); console.log(`✅ ${id} ready for final founder action`); return true;
}

// ---------- DURABLE MEMORY: Bee writes lasting facts into the Obsidian vault (the fleet's shared brain) ----------
// Operational state lives in ~/.bee/labs-board.db (fast, structured). Durable knowledge lives in the vault,
// human-readable + linkable + graphify-able, where Codex/Hermes/Obsidian all see it. This is the bridge.
const MEM_FILE = join(VAULT, 'Agent-Shared', 'Bee-Memory.md');
const TASK_PACKET_DIR = join(VAULT, 'Agent-Shared', 'bee-tasks');
function remember(text, kind = 'note') {
  if (!text || !String(text).trim()) return;
  const line = `- ${new Date(now() * 1000).toISOString().slice(0, 16).replace('T', ' ')} · **${kind}** — ${String(text).trim()}\n`;
  try { mkdirSync(join(MEM_FILE, '..'), { recursive: true }); execFileSync('bash', ['-c', `cat >> '${MEM_FILE.replace(/'/g, "'\\''")}'`], { input: line }); } catch {}
}
function memory(n = 20) { try { return readFileSync(MEM_FILE, 'utf8').trim().split('\n').slice(-n).join('\n'); } catch { return '(no memory yet)'; } }
function taskPacketPath(id) { return join(TASK_PACKET_DIR, `${id}.md`); }
function checkpointTask(id, note = '') {
  const task = sql(`SELECT id,title,body,lane,difficulty,risk,assignee,model_tier,status,needs_human,rationale,result,approval_ready,source_key,created_by,created_at,updated_at FROM tasks WHERE id='${esc(id)}';`, { json: true })[0];
  if (!task) return;
  const events = sql(`SELECT kind,detail,at FROM events WHERE task_id='${esc(id)}' ORDER BY at DESC LIMIT 18;`, { json: true }).reverse();
  const lines = [
    `# Bee Task ${task.id}`,
    '',
    `- title: ${task.title}`,
    `- lane: ${task.lane}`,
    `- status: ${task.status}`,
    `- assignee: ${task.assignee || '(unassigned)'}`,
    `- model_tier: ${task.model_tier || '(unset)'}`,
    `- risk: ${task.risk || '(unset)'}`,
    `- needs_human: ${task.needs_human ? 'yes' : 'no'}`,
    `- approval_ready: ${task.approval_ready ? 'yes' : 'no'}`,
    `- updated: ${new Date(task.updated_at * 1000).toISOString()}`,
    task.source_key ? `- source_key: ${task.source_key}` : '',
    note ? `- latest_note: ${note}` : '',
    '',
    '## Context',
    task.body || '(none)',
    '',
    '## Rationale',
    task.rationale || '(none)',
    '',
    '## Result',
    task.result || '(none yet)',
    '',
    '## Agent Contract',
    '- Do the actual work, verify it, and report only truthfully verified outcomes.',
    '- External sends, publishes, OAuth/account changes, money, credentials, and fund execution stay founder-approved at action time.',
    '- Hedge/Bill/trading material stays walled unless this is an explicitly read-only fund-status or fund-research task.',
    '- When finished, update Bee with `bee done <id>` or `bee block <id>` and include evidence in the lane inbox.',
    '',
    '## Events',
    ...(events.length ? events.map((e) => `- ${new Date(e.at * 1000).toISOString()} · ${e.kind}${e.detail ? ` — ${e.detail}` : ''}`) : ['- (none)']),
    '',
  ].filter(Boolean).join('\n');
  try { mkdirSync(TASK_PACKET_DIR, { recursive: true }); writeFileSync(taskPacketPath(id), lines); } catch {}
}

// ---------- AGENTPAY FEED: Bee consumes its own product's newsfeed of tools + upgrades (dogfooding) ----------
const FEED_URL = process.env.BEE_FEED_URL || 'https://agentpay-feed.apaybeta.workers.dev';
function feedEvents(limit = 8) {
  try {
    const r = execFileSync('curl', ['-s', '-m', '8', `${FEED_URL}/v1/feed/events?since=0&limit=${limit}`], { encoding: 'utf8', maxBuffer: 1 << 20 });
    const j = JSON.parse(r); return Array.isArray(j.events) ? j.events : [];
  } catch { return []; }
}
function feedStats() { try { return JSON.parse(execFileSync('curl', ['-s', '-m', '8', `${FEED_URL}/v1/feed/stats`], { encoding: 'utf8' })); } catch { return null; } }
function feedJSON(limit = 8) {
  return feedEvents(limit).map((e) => { const p = e.payload || {}; return { category: e.category, action: e.action, tool: p.tool_name || e.source, desc: p.description || '', endpoint: p.endpoint || '', install: p.install_command || '', ts: e.ts_ms }; });
}
function feed() {
  const ev = feedJSON(12), st = feedStats();
  console.log(`\n📡 AGENTPAY FEED — tools & upgrades for agents  (${FEED_URL})`);
  if (st) console.log(`   ${st.total_published} published · ${st.ring_size} live (events expire after 24h)`);
  if (!ev.length) { console.log('   (no live events right now)'); return; }
  ev.forEach((e) => console.log(`   • [${e.category}/${e.action}] ${e.tool}${e.desc ? ' — ' + e.desc.slice(0, 72) : ''}${e.install ? '\n       install: ' + e.install : ''}`));
}

function printTask(id) {
  const r = sql(`SELECT id,title,status,difficulty,risk,assignee,model_tier,needs_human,rationale FROM tasks WHERE id='${esc(id)}';`, { json: true })[0];
  if (!r) return;
  const flag = r.needs_human ? ' 🔔NEEDS-YOU' : '';
  console.log(`\n  ${r.id}  [${r.status}]${flag}`);
  console.log(`  ${r.title}`);
  console.log(`  → ${r.assignee} · ${r.model_tier} · ${r.difficulty}/${r.risk}`);
  console.log(`  ${r.rationale}\n`);
}

function list(where = '1=1') {
  const rows = sql(`SELECT id,title,status,assignee,model_tier,needs_human,lane FROM tasks WHERE ${where} ORDER BY needs_human DESC, created_at DESC;`, { json: true });
  if (!rows.length) { console.log('(empty)'); return; }
  for (const r of rows) {
    const flag = r.needs_human ? '🔔' : '  ';
    console.log(`${flag} ${(r.lane||'labs').padEnd(4)} ${r.id}  [${(r.status||'').padEnd(11)}] ${(r.assignee||'?').padEnd(13)} ${r.title}`);
  }
}

function board() {
  for (const s of ['inbox', 'routed', 'in_progress', 'blocked', 'done']) {
    const rows = sql(`SELECT count(*) c FROM tasks WHERE status='${s}';`, { json: true })[0];
    console.log(`\n━━ ${s.toUpperCase()} (${rows.c}) ━━`);
    list(`status='${s}'`);
  }
}

function approvals() {
  console.log('\n🔔 BEE APPROVAL QUEUE — the single human-action wall (clear these to unblock revenue):\n');
  const rows = sql(`SELECT id,title,rationale FROM tasks WHERE needs_human=1 AND status!='done' ORDER BY created_at;`, { json: true });
  if (!rows.length) { console.log('  ✅ nothing waiting on you'); return; }
  rows.forEach((r, i) => console.log(`  ${i + 1}. ${r.title}\n      (${r.id}) ${r.rationale}`));
  console.log('');
}

// ---------- FUND lane: READ-ONLY operational status ----------
// Founder-authorized view. Shows only operational health + freshness (is the fund
// alive and cycling), NOT positions/strategy/PnL. Reads only; persists nothing; never acts.
function fundStatus() {
  const lines = [];
  try {
    const ll = execFileSync('launchctl', ['list'], { encoding: 'utf8' }).split('\n')
      .filter((l) => /com\.agentpay\.bill\./.test(l));
    const up = ll.filter((l) => !/^-\t/.test(l)).length;
    lines.push(`bill launchd jobs: ${ll.length} registered, ${up} with a live PID`);
    const bad = ll.filter((l) => { const p = l.split('\t'); return p[1] && p[1] !== '0' && p[1] !== '-'; });
    if (bad.length) lines.push(`  ⚠ ${bad.length} job(s) reporting non-zero last exit`);
  } catch { lines.push('bill launchd: (could not read)'); }
  const pcl = join(homedir(), 'hedge/.rumbling-hedge/logs/prediction-cycle-history.jsonl');
  try {
    const last = readFileSync(pcl, 'utf8').trim().split('\n').pop();
    const o = JSON.parse(last);
    const ts = o.ts || o.timestamp || o.time;
    lines.push(`prediction-cycle: last entry ${ts ? new Date(ts).toISOString?.() || ts : '(present)'}`);
  } catch { lines.push('prediction-cycle: (no readable history)'); }
  const st = join(homedir(), '.openclaw/workspace-bill/STATUS.md');
  try { lines.push(`bill STATUS: ${readFileSync(st, 'utf8').split('\n').find((l) => l.trim()) || '(empty)'}`); } catch {}
  return lines;
}

// ---------- AGENCY OS lane: READ-ONLY view of Codex's company-building runtime ----------
// Codex's Agency OS lives at ~/.openclaw/workspace-agency-os (STATUS/OUTBOX + JSON boards: crm, content,
// experiments, approvals). Bee is the founder face OVER it — reads its health, never mutates it here.
const AGENCY_WS = join(homedir(), '.openclaw/workspace-agency-os');
function agencyStatus() {
  const out = { present: existsSync(AGENCY_WS), lines: [], boards: {}, approvals: 0, lastSync: '', gateway: false };
  if (!out.present) return out;
  try { execFileSync('curl', ['-s', '-o', '/dev/null', '-m', '2', 'http://127.0.0.1:18789/'], { stdio: ['ignore', 'ignore', 'ignore'] }); out.gateway = true; } catch {}
  try {
    const s = readFileSync(join(AGENCY_WS, 'STATUS.md'), 'utf8');
    for (const l of s.split('\n')) { const m = l.match(/^- (.*)$/); if (m) out.lines.push(m[1]); }
    const ls = out.lines.find((l) => /last sync/i.test(l)); out.lastSync = ls ? ls.replace(/last sync:?\s*/i, '') : '';
  } catch {}
  try {
    for (const f of readdirSync(join(AGENCY_WS, 'boards')).filter((n) => n.endsWith('.json'))) {
      try { const j = JSON.parse(readFileSync(join(AGENCY_WS, 'boards', f), 'utf8')); const n = Array.isArray(j) ? j.length : (Array.isArray(j.items) ? j.items.length : Object.keys(j).length); out.boards[f.replace('.json', '')] = n; } catch {}
    }
    out.approvals = out.boards.approvals || 0;
  } catch {}
  return out;
}
// Agency OS's own approval queue (external sends, spend, public claims…) → surfaced on Bee's unified wall.
function agencyApprovals() {
  try {
    const j = JSON.parse(readFileSync(join(AGENCY_WS, 'boards', 'approvals.json'), 'utf8'));
    return (j.requests || []).map((r, i) => ({ id: r.id || `agency-${i}`, lane: 'agency', title: r.title || r.summary || r.action || 'Agency OS approval', rationale: r.detail || r.purpose || j.purpose || '' }));
  } catch { return []; }
}
// Bee is the FRONT DOOR into Agency OS: write a founder request into its INBOX (consumed when the gateway runs).
function agencyAsk(text) {
  if (!text || !String(text).trim()) { console.error('usage: bee agency "<request>"'); return; }
  const inbox = join(AGENCY_WS, 'INBOX.md');
  const entry = `\n## ${new Date(now() * 1000).toISOString()} — founder via Bee\n${String(text).trim()}\n`;
  try { mkdirSync(AGENCY_WS, { recursive: true }); execFileSync('bash', ['-c', `cat >> '${inbox.replace(/'/g, "'\\''")}'`], { input: entry }); console.log(`📨 sent to Agency OS INBOX → ${inbox}`); speak('Sent to the Agency OS lane.'); }
  catch (e) { console.error('could not write Agency OS INBOX:', e.message); }
}

// ---------- UNIFIED TWO-LANE DASHBOARD ----------
function dashboard() {
  const c = (s) => (sql(`SELECT count(*) c FROM tasks WHERE ${s};`, { json: true })[0] || {}).c || 0;
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║  BEE — unified control plane (Labs + Fund)                     ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');

  console.log(`\n▌ LABS LANE   routed:${c("lane='labs' AND status='routed'")}  in-progress:${c("lane='labs' AND status='in_progress'")}  blocked:${c("lane='labs' AND status='blocked'")}  done:${c("lane='labs' AND status='done'")}`);
  list("lane='labs' AND status IN ('routed','in_progress')");

  console.log(`\n▌ FUND LANE   (view + stage + autonomous read-only research; you execute)`);
  console.log('  ── live fund status (read-only) ──');
  for (const l of fundStatus()) console.log(`    ${l}`);
  const fundTasks = sql(`SELECT count(*) c FROM tasks WHERE lane='fund';`, { json: true })[0].c;
  if (fundTasks) { console.log('  ── fund tasks on Bee board ──'); list("lane='fund' AND status!='done'"); }

  const ag = agencyStatus();
  if (ag.present) {
    console.log(`\n▌ AGENCY OS LANE   (Codex's company-building cells — read-only via Bee)`);
    console.log(`  last sync: ${ag.lastSync || '(unknown)'}${ag.lines.find((l) => /active internal cells/i.test(l)) ? ' · ' + ag.lines.find((l) => /active internal cells/i.test(l)) : ''}`);
    const boards = Object.entries(ag.boards).filter(([, n]) => n > 0).map(([k, n]) => `${k}:${n}`).join('  ');
    if (boards) console.log(`  boards: ${boards}`);
  }

  console.log('\n🔔 APPROVAL WALL — your action clears these (all lanes):');
  const w = [...sql(`SELECT lane,title FROM tasks WHERE needs_human=1 AND status!='done' ORDER BY lane,created_at;`, { json: true }), ...agencyApprovals().map((a) => ({ lane: a.lane, title: a.title }))];
  if (!w.length) console.log('   ✅ nothing waiting on you');
  else w.forEach((r, i) => console.log(`   ${i + 1}. [${r.lane}] ${r.title}`));
  console.log('');
}

// ---------- AUTONOMY + BLUEPRINTS (the proactive control plane) ----------
// Bee is proactive BY DEFAULT — it acts on routed work on its own until the founder says stop.
const AUTONOMY_FILE = join(BEE_DIR, 'autonomy.json');
function getAutonomy() { try { return { proactive: true, ...JSON.parse(readFileSync(AUTONOMY_FILE, 'utf8')) }; } catch { return { proactive: true }; } }
function setAutonomy(p) { const a = { ...getAutonomy(), proactive: !!p }; writeFileSync(AUTONOMY_FILE, JSON.stringify(a)); return a; }

// What Bee can run on its own — modelled on the Hermes automation-blueprint catalog, scoped to AgentPay's real loops.
const BLUEPRINTS = [
  { key: 'project-operator', name: 'Project operator', desc: 'Advance the highest-impact safe AgentPay Labs outcome that is not already in flight.', cadence: 'hourly', assignee: 'codex' },
  { key: 'polsia-completion', name: 'Polsia completion loop', desc: 'Turn the Polsia promise into Bee/Clickey execution: product proof, site truth, approvals, and conversion assets.', cadence: 'daily', assignee: 'codex' },
  { key: 'fleet-sweep',      name: 'Daily Labs sweep',       desc: 'Check AgentPay Labs agent lanes, surface new blockers, and summarize progress without reading the fund lane.', cadence: 'daily' },
  { key: 'revenue-chaser',   name: 'Revenue-blocker chaser', desc: 'Re-check each approval-wall blocker and ping you only when one is genuinely ready to clear.', cadence: 'hourly' },
  { key: 'content-engine',   name: 'Content engine',         desc: 'Draft and stage posts across channels from the week’s shipped work.', cadence: 'daily' },
  { key: 'competitor-watch', name: 'Competitor watch',       desc: 'Scan competitor pricing and launches; summarize what changed.', cadence: 'weekly' },
  { key: 'inbox-triage',     name: 'Inbox triage',           desc: 'Classify and route anything dropped to Bee; escalate only the human-action items.', cadence: 'continuous' },
  { key: 'tool-watch',       name: 'Tool watch',             desc: 'Poll the AgentPay Feed for new tools/upgrades and note anything Bee should adopt.', cadence: 'daily' },
  { key: 'chief-of-staff',   name: 'Chief of staff',         desc: 'Run an OODA decision pass over the whole company and stage the day’s priorities to memory.', cadence: 'daily' },
];
function projectBrief() {
  const ledger = join(VAULT, 'Shared-Brain', 'LEDGER.md');
  let remaining = '';
  try {
    const text = readFileSync(ledger, 'utf8');
    remaining = (text.split(/^## 📋 REMAINING\b/m)[1] || '').split(/^## 🔒 BLOCKED ON RAJIV\b/m)[0];
  } catch {}
  const external = /\b(remove|delete|publish|posting|activate|account|oauth|log[- ]?in|auth|submit|upload|promote|production|store|console|stripe|secret|token|payment|money|deploy|send|email)\b/i;
  const candidates = remaining.split('\n').filter((line) => /^- \*\*/.test(line) && !external.test(line));
  const active = sql(`SELECT title,assignee,status FROM tasks WHERE lane='labs' AND status IN ('routed','in_progress') AND needs_human=0 ORDER BY updated_at DESC LIMIT 20;`, { json: true });
  return `SAFE CURRENT LABS CANDIDATES (external/founder-gated rows removed):\n${candidates.join('\n') || '(none)'}\n\nACTIVE BEE LABS WORK (do not duplicate):\n${active.map((t) => `- [${t.status}/${t.assignee}] ${t.title}`).join('\n') || '(none)'}`;
}
function polsiaBrief() {
  let html = '';
  try { html = execFileSync('curl', ['-L', '-s', '-m', '12', 'https://polsia.com/'], { encoding: 'utf8', maxBuffer: 1 << 20 }); } catch {}
  const meta = (name) => html.match(new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]+content=["']([^"']+)`, 'i'))?.[1] || '';
  const title = html.match(/<title>([^<]+)<\/title>/i)?.[1] || 'Polsia';
  const desc = meta('description') || meta('og:description') || 'Autonomous AI company runner.';
  return `PUBLIC POLSIA REFERENCE (fetched best-effort):\n- title: ${title}\n- description: ${desc}\n- useful benchmark: make Bee/Clickey prove the same promise locally: plan, code, market, stage approvals, write memory, and only ask Rajiv for true final actions.`;
}
function runBlueprint(key) {
  const b = BLUEPRINTS.find((x) => x.key === key);
  if (!b) { console.error(`unknown blueprint "${key}". try: ${BLUEPRINTS.map((x) => x.key).join(', ')}`); return null; }
  if (key === 'tool-watch') {                          // runs in-process: poll the feed, note new tools to durable memory
    const ev = feedJSON(10);
    if (ev.length) { ev.slice(0, 5).forEach((e) => remember(`feed: [${e.category}/${e.action}] ${e.tool}${e.desc ? ' — ' + e.desc.slice(0, 60) : ''}`, 'tool-watch')); console.log(`📡 tool-watch: noted ${Math.min(5, ev.length)} feed item(s)`); speak(`${ev.length} new ${ev.length === 1 ? 'tool' : 'tools'} on the feed.`); }
    else { console.log('📡 tool-watch: feed quiet, nothing new'); }
    return { assignee: 'bee' };
  }
  if (key === 'chief-of-staff') {                      // runs in-process: an OODA decision pass, staged to memory
    decide(undefined, false);
    return { assignee: 'bee' };
  }
  if (key === 'inbox-triage') {                        // daemon already drains ~/.bee/inbox; don't create an unowned board card
    console.log('📥 inbox-triage: daemon inbox watcher is active; no board card needed');
    return { assignee: 'bee' };
  }
  // Dedupe: don't stack a new run while the previous one is still open (stops hourly pile-ups of paid work).
  const open = sql(`SELECT count(*) c FROM tasks WHERE title LIKE '[${esc(b.name)}]%' AND status!='done';`, { json: true })[0]?.c || 0;
  if (open > 0) { console.log(`↩ "${b.name}" already has ${open} open — skipping this run`); return null; }
  const projectBody = key === 'project-operator'
    ? `Pick exactly ONE highest-impact AgentPay Labs outcome from the sanitized brief below that you can complete or materially advance now. Skip any candidate whose next step needs the founder, credentials, external deployment, publishing, account access, payment, or a store console; choose another candidate instead. Prefer shipping local code, tests, launch assets, reliability, or conversion infrastructure. Do not open any other fleet ledger/status files. Do not read or touch Bill, hedge, Trading, Research-Catalog, broker, market, strategy, position, PnL, or execution material. Implement and verify locally.\n\n${projectBrief()}`
    : key === 'polsia-completion'
      ? `Use Bee and Clickey to materially advance the AgentPay/Bee product toward a Polsia-style autonomous company runner. Make one local, verifiable improvement to Bee, Clickey, AgentPay product truth, onboarding, dashboard/action flow, conversion copy, or launch assets. Do not publish, submit, send, deploy, log in, change OAuth, touch credentials, move money, or touch the fund lane. Leave external actions as approval packets. Implement and verify locally.\n\n${polsiaBrief()}\n\n${projectBrief()}`
    : '';
  const id = create(`[${b.name}] ${b.desc}`, { body: projectBody, createdBy: 'blueprint', route: false, sourceKey: `blueprint:${b.key}` });
  const blueprintAssignee = b.assignee === 'codex' && !agentAvailable('codex') && agentAvailable('nemotron') ? 'nemotron' : b.assignee;
  const d = b.assignee
    ? { lane: 'labs', difficulty: 'standard', risk: 'medium', assignee: blueprintAssignee, model_tier: blueprintAssignee === 'codex' ? 'paid' : 'free', needs_human: 0, rationale: `Trusted Labs blueprint policy → ${blueprintAssignee}. External actions remain worker-gated.` }
    : routeOne(id);
  if (b.assignee) {
    sql(`UPDATE tasks SET lane='labs',difficulty='${d.difficulty}',risk='${d.risk}',assignee='${esc(d.assignee)}',model_tier='${esc(d.model_tier)}',needs_human=0,status='routed',rationale='${esc(d.rationale)}',updated_at=${now()} WHERE id='${esc(id)}';`);
    logEvent(id, 'routed', `${d.assignee}/${d.model_tier}`);
    checkpointTask(id, `routed to ${d.assignee}/${d.model_tier}`);
    printTask(id);
  }
  dispatch(id);
  console.log(`▶ ran blueprint "${b.name}" → ${id} (${d?.assignee || 'routed'})`);
  speak(`Running ${b.name}.`);
  return d;
}

// Scheduler: fires each blueprint on its cadence. State (last-run per key) in ~/.bee/schedule.json.
const SCHED_FILE = join(BEE_DIR, 'schedule.json');
const CADENCE_SECS = { continuous: 0, hourly: 3600, daily: 86400, weekly: 604800 };
function getSched() { try { return JSON.parse(readFileSync(SCHED_FILE, 'utf8')); } catch { return {}; } }
function blueprintTiming(b) {
  const last = getSched()[b.key] || 0;
  const interval = CADENCE_SECS[b.cadence] ?? 0;
  return { last, interval, nextDue: (last && interval) ? last + interval : 0, continuous: interval === 0 };
}
// Called every daemon tick. Cheap: only writes when a clock starts or a blueprint actually fires.
function tickBlueprints() {
  if (!getAutonomy().proactive) return;
  const s = getSched(); let changed = false;
  for (const b of BLUEPRINTS) {
    const iv = CADENCE_SECS[b.cadence] ?? 0;
    if (!iv) continue;                                  // 'continuous' is handled live by the daemon, not timed
    if (!s[b.key]) { s[b.key] = now(); changed = true; continue; } // start the clock on first sight — don't fire on boot
    if (now() - s[b.key] >= iv) { try { runBlueprint(b.key); } catch {} s[b.key] = now(); changed = true; }
  }
  if (changed) writeFileSync(SCHED_FILE, JSON.stringify(s));
}

function inferredApprovalUrl(text = '') {
  if (/npm/i.test(text)) return 'https://www.npmjs.com/login';
  if (/app store|\basc\b|appstoreconnect/i.test(text)) return 'https://appstoreconnect.apple.com/apps';
  if (/play console|google play/i.test(text)) return 'https://play.google.com/console/';
  return '';
}
function parseApprovalPacket(raw) { try { return raw ? JSON.parse(raw) : {}; } catch { return {}; } }

// Single JSON snapshot for the desktop dashboard — same truth the CLI dashboard prints, structured.
function stateJSON() {
  const c = (s) => (sql(`SELECT count(*) c FROM tasks WHERE ${s};`, { json: true })[0] || {}).c || 0;
  const labs = {
    routed: c("lane='labs' AND status='routed' AND needs_human=0"),
    inProgress: c("lane='labs' AND status='in_progress'"),
    blocked: c("lane='labs' AND status='blocked' AND needs_human=0"),
    done: c("lane='labs' AND status='done'"),
    active: sql(`SELECT id,title,assignee,status,model_tier FROM tasks WHERE lane='labs' AND status IN ('routed','in_progress') AND needs_human=0 ORDER BY updated_at DESC LIMIT 8;`, { json: true }),
  };
  const mandateByTask = new Map(loadMandates().filter((m) => !['executed', 'rejected', 'expired'].includes(m.status)).map((m) => [m.task_id, m]));
  const actionByTask = new Map(loadActions().filter((item) => !['completed', 'rejected'].includes(item.status)).map((item) => [item.task_id, item]));
  const prepParents = new Set(sql(`SELECT source_key FROM tasks WHERE source_key LIKE 'approval-prep:%' AND status!='done';`, { json: true }).map((row) => row.source_key.replace(/^approval-prep:/, '')));
  const taskApprovals = sql(`SELECT id,lane,title,body,rationale,result,approval_ready,approval_packet,status,created_at,updated_at FROM tasks WHERE needs_human=1 AND status!='done' ORDER BY CASE lane WHEN 'labs' THEN 0 ELSE 1 END,approval_ready DESC,created_at;`, { json: true }).map((task) => {
    const mandate = mandateByTask.get(task.id);
    const action = actionByTask.get(task.id);
    const packet = parseApprovalPacket(task.approval_packet);
    delete task.approval_packet;
    if (mandate) return { ...task, approval_kind: 'mandate', action_id: mandate.id, approval_status: mandate.status, approval_ready: 1,
      packet: { ...packet, final_step: mandate.status === 'proposed' ? 'Approve and stage signed rail payload' : mandate.status === 'approved' ? 'Stage signed rail payload' : 'Complete provider payment and add receipt' } };
    if (action) return { ...task, approval_kind: 'action', action_id: action.id, approval_status: action.status, automatable: action.automatable, approval_ready: 1,
      packet: { ...packet, final_step: action.automatable ? 'Approve and let Bee execute this exact action' : 'Complete this sensitive step personally' } };
    const url = packet.url || inferredApprovalUrl(`${task.title} ${task.body || ''}`);
    const fund = task.lane === 'fund';
    return { ...task, approval_kind: 'task', action_id: task.id, approval_ready: fund ? 0 : task.approval_ready, preparing: prepParents.has(task.id),
      packet: { ...packet, url, summary: packet.summary || task.result || task.rationale, final_step: fund ? 'Founder executes outside Bee; trading authority remains walled' : url ? 'Open the prepared final step' : 'Complete the final founder-only step' } };
  });
  const approvals = [...taskApprovals, ...agencyApprovals().map((item) => ({ ...item, approval_kind: 'agency', action_id: item.id, approval_ready: 0,
    packet: { summary: item.rationale || 'Agency OS is preparing this decision.', final_step: 'Review in the Agency OS approval board' } }))];
  const fund = {
    status: fundStatus(),
    tasks: sql(`SELECT id,title,status,needs_human FROM tasks WHERE lane='fund' AND status!='done' ORDER BY created_at;`, { json: true }),
  };
  const needs = approvals.length;
  const readyNeeds = approvals.filter((item) => item.lane !== 'fund' && item.approval_ready).length;
  const fundNeeds = approvals.filter((item) => item.lane === 'fund').length;
  const state = needs > 0 ? 'alert' : (labs.inProgress + labs.routed > 0 ? 'cocoon' : 'idle');
  const presence = readyNeeds > 0 ? `${readyNeeds} final ${readyNeeds === 1 ? 'decision is' : 'decisions are'} ready. Bee prepared the rest.`
    : fundNeeds > 0 ? `${fundNeeds} founder-only fund ${fundNeeds === 1 ? 'request is' : 'requests are'} walled.`
    : labs.inProgress > 0 ? `${labs.inProgress} ${labs.inProgress === 1 ? 'task' : 'tasks'} in flight.`
    : labs.routed > 0 ? `${labs.routed} queued and ready.`
    : 'All quiet — watching the fleet.';
  const nextMoves = [];
  if (labs.routed > 0) nextMoves.push(`Dispatch ${labs.routed} routed ${labs.routed === 1 ? 'task' : 'tasks'} to their workers.`);
  if (readyNeeds > 0) nextMoves.push(`${readyNeeds} prepared final ${readyNeeds === 1 ? 'decision is' : 'decisions are'} ready for you.`);
  if (fundNeeds > 0) nextMoves.push(`${fundNeeds} fund ${fundNeeds === 1 ? 'request remains' : 'requests remain'} founder-only.`);
  if (labs.blocked > 0) nextMoves.push(`Re-check ${labs.blocked} blocked ${labs.blocked === 1 ? 'task' : 'tasks'} for anything now unblocked.`);
  if (!nextMoves.length) nextMoves.push('Nothing pressing — Bee is watching and will act the moment work appears.');
  const blueprints = BLUEPRINTS.map((b) => { const t = blueprintTiming(b); return { ...b, lastRun: t.last, nextDue: t.nextDue, continuous: t.continuous }; });
  return { ts: now(), state, presence, autonomy: getAutonomy(), labs, fund, agency: agencyStatus(), approvals, blueprints, nextMoves };
}

// ---------- BEE KNOWS ITS TEAM (registry → understanding) ----------
function loadRegistry() { try { return JSON.parse(readFileSync(REGISTRY, 'utf8')); } catch { return null; } }
function agents() {
  const reg = loadRegistry();
  if (!reg) { console.log('No registry yet — run `bee scan` first.'); return; }
  console.log("\n🧠 BEE'S TEAM — who Bee hands work to:\n");
  for (const a of reg.agents) console.log(`  ${(a.name || '').padEnd(14)} ${a.role}  ·  ${a.status}`);
  const labs = (reg.skills || []).filter((s) => s.lane === 'labs');
  console.log(`\n  Hermes/Codex skills usable (${labs.length}):`);
  console.log('    ' + labs.map((s) => s.name).join(', '));
  console.log(`\n  Tools on this box: ${(reg.tools || []).join(', ')}`);
  const harness = (reg.mcp || []).filter((m) => m.host === 'agentpay');
  if (harness.length) { console.log("\n  AgentPay harness (Bee's own product organs):"); harness.forEach((m) => console.log(`    ${(m.name || '').padEnd(13)} ${m.role}  ·  [${m.wired || 'known'}]`)); }
  if (reg.rails) { console.log('\n  Rails:'); if (reg.rails.spend) console.log(`    spend → ${typeof reg.rails.spend === 'string' ? reg.rails.spend : JSON.stringify(reg.rails.spend)}`); if (reg.rails.earn) console.log(`    earn  → ${Array.isArray(reg.rails.earn) ? reg.rails.earn.join(' · ') : reg.rails.earn}`); }
}

// ---------- DECISION ENGINE: Bee runs an OODA loop over the whole picture ----------
// Observe (board+registry+lanes) → Orient (compact context) → Decide (brain: what/who/when/why)
// → Act (optional: create+route through the normal safety pipeline). `bee decide [goal] [--act]`.
function decide(goal, enact = false) {
  const reg = loadRegistry() || { agents: [], skills: [] };
  const s = stateJSON();                                                   // OBSERVE
  const agentsCtx = reg.agents.map((a) => `- ${a.name}: ${a.role} [${a.status}]`).join('\n');
  const skills = reg.skills.filter((x) => x.lane === 'labs').map((x) => x.name);
  const board = `queued:${s.labs.routed} in-progress:${s.labs.inProgress} blocked:${s.labs.blocked} done:${s.labs.done} · wall:${s.approvals.length}`;
  const active = (s.labs.active || []).map((t) => `${t.assignee}:${t.title}`).join('; ') || 'none';
  const wall = s.approvals.map((a) => a.title).slice(0, 8).join('; ') || 'none';
  const sys = "You are Bee, the founder's autonomous chief-of-staff running a 3-agent company: "
    + "Claude=judgment/design/copy/strategy; Codex=implementation/code/CI; Hermes(-lenovo)=research/render/distribution with a skill library; Nemotron=fast free execution. "
    + "Run the OODA loop and decide the next best moves toward the goal. Output ONLY JSON: "
    + '{"summary":"<=20 words","decisions":[{"action":"<concrete task>","assignee":"claude|codex|hermes-lenovo|nemotron|rajiv","skill":"<hermes skill or empty>","when":"now|today|this-week","priority":1,"why":"<=14 words"}]}. '
    + "HARD RULES: anything needing OAuth/login/app-store/money/payment/trade => assignee rajiv (founder-only). Prefer free/local workers. Be concrete and minimal — at most 6 decisions, highest-leverage first.";
  const prompt = `GOAL: ${goal || 'Advance AgentPay toward first real revenue — safely and cheaply.'}\n\nTEAM:\n${agentsCtx}\n\nHERMES SKILLS AVAILABLE: ${skills.join(', ')}\nSPECIALIST BENCH (auto-attached to worker prompts by task keywords): ${loadSpecialists().map((s) => s.name).join(', ')}\n\nBOARD: ${board}\nACTIVE WORK: ${active}\nFOUNDER WALL (assignee must be rajiv): ${wall}\n\nLESSONS (Bee's recent memory — outcomes, decisions, earnings; learn from these):\n${memory(8)}\nEARNED TO DATE: $${earnTotal().toFixed(2)} (sandbox sales of Bee's judgment)\n\nDecide.`;
  thinkStart('Let me think it through.');                                  // butterfly → thinking (chrysalis pulse)
  const out = brain(prompt, { sys, max: 2400, big: true });                // DECIDE — reasoning tier thinks out loud first; give it room to reach the JSON
  thinkStop();                                                             // done reasoning → return to real state
  const plan = extractJSON(out);
  if (!plan) { console.log('Could not parse a clean decision:\n' + (out || '').slice(0, 300)); speak("I couldn't decide cleanly — the brain may be down."); return; }
  const decisions = (plan.decisions || []).sort((a, b) => (a.priority || 9) - (b.priority || 9));
  console.log(`\n🧭 BEE'S DECISION — ${plan.summary || ''}\n`);
  decisions.forEach((d) => console.log(`  P${d.priority || '?'} [${(d.when || '?').padEnd(9)}] ${d.action}\n        → ${d.assignee}${d.skill ? ' · skill:' + d.skill : ''} — ${d.why || ''}`));
  remember(`decision: ${plan.summary} (${decisions.length} moves)`, 'decide');
  if (enact) {                                                             // ACT (opt-in) — through the normal safety pipeline
    let made = 0;
    for (const d of decisions) {
      if (d.assignee === 'rajiv') continue;                                // founder wall items already staged
      const body = `${d.why || ''}${d.skill ? `  [use Hermes skill: ${d.skill}]` : ''}  (Bee-decided, ${d.when || 'today'})`;
      const id = create(d.action, { body, createdBy: 'bee-decide', route: false });
      routeOne(id); if (getAutonomy().proactive) dispatch(id); made++;       // classify() safety-floor still governs assignee/needs_human
    }
    console.log(`\n✅ enacted ${made} decision(s) onto the board (safety pipeline applied).`);
    speak(`On it — I've put ${made} ${made === 1 ? 'move' : 'moves'} into motion.`);
  } else {
    console.log(`\n(plan only — run \`bee decide "${(goal || '').replace(/"/g, '')}" --act\` to put these on the board)`);
    speak(cleanSay(plan.summary) || "That's my read.");
  }
}

// ---------- SPECIALIST BENCH: curated role cards attached to worker prompts (adapted from msitarzewski/agency-agents, MIT) ----------
// Eight distilled specialists, not 232 — quality per lane without prompt bloat. A card is markdown:
// "# Name" + "match: <keywords>" + the system-prompt body. Matched by keyword score against the task text.
const SPEC_DIR = new URL('specialists/', import.meta.url).pathname;
function loadSpecialists() {
  try {
    return readdirSync(SPEC_DIR).filter((f) => f.endsWith('.md')).map((f) => {
      const t = readFileSync(join(SPEC_DIR, f), 'utf8');
      const name = t.match(/^#\s*(.+)$/m)?.[1]?.trim() || f.replace('.md', '');
      const match = (t.match(/^match:\s*(.+)$/m)?.[1] || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
      const body = t.split('\n').filter((l) => !/^#\s|^match:|^Adapted from/.test(l)).join('\n').trim();
      return { key: f.replace('.md', ''), name, match, body };
    });
  } catch { return []; }
}
function pickSpecialist(text) {
  const t = String(text || '').toLowerCase();
  let best = null, bestScore = 0;
  for (const s of loadSpecialists()) {
    const score = s.match.reduce((n, k) => n + (t.includes(k) ? 1 : 0), 0);
    if (score > bestScore) { best = s; bestScore = score; }
  }
  return best;                                                  // null = no confident match → generic worker prompt
}
function specialists() {
  const all = loadSpecialists();
  console.log(`\n🎓 SPECIALIST BENCH — ${all.length} cards (adapted from The Agency, MIT) · attach: auto by task keywords`);
  all.forEach((s) => console.log(`   • ${s.name}  [${s.key}] — matches: ${s.match.slice(0, 5).join(', ')}…`));
}

// ---------- EARN: Bee sells its judgment over x402 (the founder-in-a-box earns, not just spends) ----------
// `bee serve` exposes POST /v1/decide behind an HTTP 402 paywall. Sandbox mode only: payment proof is a
// one-time nonce (replay-protected via the same nonce store as the spend guard). No real money moves here —
// live settlement belongs to the AgentPay rail, and earnings are recorded truthfully as sandbox.
const EARN_FILE = join(BEE_DIR, 'earnings.json');
const EARN_PRICE_USD = 0.05;
function earnLedger() { try { return JSON.parse(readFileSync(EARN_FILE, 'utf8')); } catch { return []; } }
function earnTotal() { return earnLedger().reduce((s, e) => s + (+e.amount_usd || 0), 0); }
function recordEarning(resource, payer, nonce) {
  const e = { id: 'earn_' + randomBytes(5).toString('hex'), resource, payer: payer || 'anonymous', nonce, amount_usd: EARN_PRICE_USD, mode: 'sandbox', fulfilled: false, at: now() };
  const l = earnLedger(); l.push(e); writeJSONAtomic(EARN_FILE, l);
  remember(`earned $${EARN_PRICE_USD.toFixed(2)} (sandbox) — ${resource} for ${e.payer}`, 'earn');
  return e;
}
function x402Terms(resource, desc) {
  return { x402Version: 1, error: 'payment required', accepts: [{ scheme: 'exact', network: 'sandbox', resource, description: desc, mimeType: 'application/json', maxAmountRequired: String(Math.round(EARN_PRICE_USD * 1e6)), asset: 'USDC', payTo: 'agentpay:bee', extra: { checkout: (process.env.BEE_AGENTPAY_API || 'https://api.agentpay.so') + '/v1/checkout', how: "sandbox: send header 'X-PAYMENT: sandbox:<fresh-nonce>' (one-time; replays rejected)" } }] };
}
async function serve(port = +(process.env.BEE_EARN_PORT || 8402)) {
  const { createServer } = await import('node:http');
  const send = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
  const srv = createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/') {
      return send(res, 200, { service: 'bee', tagline: 'founder-in-a-box — judgment for hire', earnings_usd: +earnTotal().toFixed(2), mode: 'sandbox', specialists: loadSpecialists().map((s) => ({ key: s.key, name: s.name })), endpoints: [{ method: 'POST', path: '/v1/decide', price_usd: EARN_PRICE_USD, body: '{"goal":"...", "specialist"?: "<key>"}', pay: 'x402 — call without payment to get terms' }] });
    }
    if (req.method === 'POST' && req.url === '/v1/decide') {
      const pay = String(req.headers['x-payment'] || '');
      const m = pay.match(/^sandbox:(\S{6,})$/), r = pay.match(/^receipt:(earn_\w+)$/);
      const redeem = r && earnLedger().find((e) => e.id === r[1] && !e.fulfilled);   // paid earlier, got a 503 → honor it
      if (!m && !redeem) return send(res, r ? 409 : 402, r ? { error: 'receipt unknown or already fulfilled' } : x402Terms('/v1/decide', "Bee's OODA judgment on your goal — concrete next moves"));
      if (m && seenNonce('earn:' + m[1])) return send(res, 409, { error: 'payment replayed — nonce already used' });
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 65536) req.destroy(); });
      req.on('end', () => {
        let goal = '', wantSpec = '';
        try { const b = JSON.parse(body || '{}'); goal = String(b.goal || '').slice(0, 500); wantSpec = String(b.specialist || '').slice(0, 40); } catch {}
        if (!goal) return send(res, 400, { error: 'body must be {"goal":"...", "specialist"?: "<key>"}' });
        if (m) addNonce('earn:' + m[1]);                       // burn the payment BEFORE work — no double-serve
        const earning = redeem || recordEarning('/v1/decide', req.headers['x-payer'], m[1]);
        const spec = wantSpec ? loadSpecialists().find((s) => s.key === wantSpec) : pickSpecialist(goal);   // buyer picks a specialist, or Bee matches one
        const sys = (spec ? spec.body + '\n\n' : '')
          + 'You are Bee, an autonomous chief-of-staff. Answer the client goal with ONLY JSON: {"summary":"<=20 words","moves":[{"action":"<concrete>","when":"now|today|this-week","why":"<=12 words"}]} — at most 4 moves, highest-leverage first.';
        let plan = null;
        for (let tries = 0; tries < 2 && !plan; tries++) {       // paid call — one retry before we ever hand back a 503
          const out = brain(goal, { sys, max: 2400, big: true }); // strongest tier first (NIM 120b, ~10s); room to reason AND emit the JSON
          plan = extractJSON(out);
        }
        if (!plan) return send(res, 503, { error: "brain offline — your payment is honored: retry with header 'X-PAYMENT: receipt:" + earning.id + "'", receipt: earning.id });
        const l = earnLedger(); const i = l.findIndex((e) => e.id === earning.id); if (i >= 0) { l[i].fulfilled = true; writeJSONAtomic(EARN_FILE, l); }
        send(res, 200, { receipt: earning.id, price_usd: EARN_PRICE_USD, mode: 'sandbox', specialist: spec ? spec.key : null, ...plan });
      });
      return;
    }
    send(res, 404, { error: 'not found' });
  });
  srv.listen(port, () => {
    console.log(`\n💰 BEE IS OPEN FOR BUSINESS — http://127.0.0.1:${port}`);
    console.log(`   POST /v1/decide  $${EARN_PRICE_USD.toFixed(2)}/call (x402, sandbox) · GET / = service index`);
    console.log(`   earned to date: $${earnTotal().toFixed(2)} (sandbox) · ledger: ~/.bee/earnings.json`);
  });
  return srv;
}
function earningsReport() {
  const l = earnLedger();
  console.log(`\n💰 BEE EARNINGS — $${earnTotal().toFixed(2)} total · ${l.length} sale(s) · all sandbox`);
  l.slice(-5).forEach((e) => console.log(`   ${new Date(e.at * 1000).toISOString().slice(0, 16).replace('T', ' ')} · $${(+e.amount_usd).toFixed(2)} · ${e.resource} · ${e.payer}`));
  if (!l.length) console.log('   (nothing yet — run `bee serve` and sell Bee\'s judgment)');
}

// ---------- PAYMENT GUARD (Tier-1: AgentPay Sentinel's role, enforced natively) ----------
// Mirrors Sentinel's 9-check pre-flight that Bee can enforce locally. Bee NEVER auto-pays:
// a PASS means "safe to stage" — execution still goes through the founder wall.
const GUARD = { capUSD: +(process.env.BEE_SPEND_CAP || 20), restricted: ['gambling', 'casino', 'weapon', 'adult', 'trading', 'forex', 'crypto-buy'] };
function spendFile() { return join(BEE_DIR, `spend-${new Date(now() * 1000).toISOString().slice(0, 10)}.json`); }
function spendLedger() { try { const v = JSON.parse(readFileSync(spendFile(), 'utf8')); return { spent: +(v.spent ?? v.total) || 0, receipts: v.receipts || [] }; } catch { return { spent: 0, receipts: [] }; } }
function spentToday() { return spendLedger().spent; }
const NONCE_FILE = join(BEE_DIR, 'nonces.json');
function seenNonce(n) { if (!n) return false; try { return !!JSON.parse(readFileSync(NONCE_FILE, 'utf8'))[n]; } catch { return false; } }
function addNonce(n) { if (!n) return; let s = {}; try { s = JSON.parse(readFileSync(NONCE_FILE, 'utf8')); } catch {} s[n] = now(); writeJSONAtomic(NONCE_FILE, s); }
function recordSpend(a, receipt) { const l = spendLedger(); l.spent += (+a || 0); if (receipt) l.receipts.push(receipt); writeJSONAtomic(spendFile(), l); return l.spent; }
function reservedToday(excludeId = '') {
  const day = new Date(now() * 1000).toISOString().slice(0, 10);
  return loadMandates().filter((m) => m.id !== excludeId && m.mode !== 'sandbox' && m.status === 'ready_to_settle' && m.reservation_day === day)
    .reduce((sum, m) => sum + (+m.amount || 0), 0);
}
function guard(amount, merchant, opts = {}) {
  amount = +amount || 0; const checks = []; const add = (name, pass, detail) => checks.push({ name, pass, detail });
  const intent = opts.intent || `${amount} to ${merchant}`;
  add('fund-exec gate', !FUND_EXEC_RE.test(intent), FUND_EXEC_RE.test(intent) ? 'fund execution — founder-only, never autonomous' : 'ok');
  const spent = spentToday(), reserved = reservedToday(opts.mandateId), left = GUARD.capUSD - spent - reserved - amount;
  add('budget cap', opts.sandbox || left >= 0, opts.sandbox ? 'sandbox isolated — real spend ledger unchanged' : `$${spent.toFixed(2)} spent + $${reserved.toFixed(2)} reserved + $${amount.toFixed(2)} vs $${GUARD.capUSD}/day → $${left.toFixed(2)} left`);
  add('amount sane', amount > 0 && amount <= GUARD.capUSD, amount <= 0 ? 'non-positive' : amount > GUARD.capUSD ? 'exceeds daily cap alone' : 'ok');
  if (opts.approved != null) add('amount match', +opts.approved === amount, `approved $${opts.approved} vs requested $${amount}`);
  const restricted = GUARD.restricted.some((c) => `${merchant} ${opts.category || ''}`.toLowerCase().includes(c));
  add('merchant policy', !restricted, restricted ? 'restricted category' : 'ok');
  add('replay/nonce', !seenNonce(opts.nonce), seenNonce(opts.nonce) ? 'nonce already used' : (opts.nonce ? 'fresh' : 'no nonce supplied (single-use not enforced)'));
  const pass = checks.every((c) => c.pass);
  return { pass, checks, intent, blocker: pass ? null : checks.find((c) => !c.pass).name };
}

// ---------- MANDATE PRIMITIVE: the signed, provable-consent artifact (AP2/Agentic-Token shaped) ----------
// Loop: Bee ISSUES (guarded, proposed) → founder APPROVES (the wall) → SETTLE re-guards + stages the
// exact rail payload (x402/Casper/USDC or Stripe). Bee NEVER moves money autonomously — settlement is founder-triggered.
const MANDATE_FILE = join(BEE_DIR, 'mandates.json');
const loadMandates = () => { try { return JSON.parse(readFileSync(MANDATE_FILE, 'utf8')); } catch { return []; } };
const saveMandates = (m) => writeJSONAtomic(MANDATE_FILE, m);
const MANDATE_KEY_FILE = join(BEE_DIR, 'mandate.key');
const MANDATE_SIG_VERSION = 2;
function mandateKey() {
  if (process.env.BEE_MANDATE_KEY) return Buffer.from(process.env.BEE_MANDATE_KEY, 'utf8');
  try { return Buffer.from(readFileSync(MANDATE_KEY_FILE, 'utf8').trim(), 'hex'); } catch {}
  const key = randomBytes(32);
  try { writeFileSync(MANDATE_KEY_FILE, key.toString('hex'), { mode: 0o600, flag: 'wx' }); } catch {
    return Buffer.from(readFileSync(MANDATE_KEY_FILE, 'utf8').trim(), 'hex');
  }
  return key;
}
function mandatePayload(m) {
  return JSON.stringify({
    sig_v: MANDATE_SIG_VERSION, id: m.id, task_id: m.task_id, agent: m.agent, mode: m.mode,
    intent: m.intent, merchant: m.merchant, amount: m.amount, currency: m.currency,
    cap: m.cap, rail: m.rail, nonce: m.nonce, issued_at: m.issued_at, expires_at: m.expires_at,
  });
}
const signMandateWithKey = (m, key) => createHmac('sha256', key).update(mandatePayload(m)).digest('hex');
function verifyMandateWithKey(m, key) {
  if (m.sig_v !== MANDATE_SIG_VERSION || !/^[a-f0-9]{64}$/i.test(m.sig || '')) return false;
  const actual = Buffer.from(m.sig, 'hex'), expected = Buffer.from(signMandateWithKey(m, key), 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
const mandateSig = (m) => signMandateWithKey(m, mandateKey());
const verifyMandate = (m) => verifyMandateWithKey(m, mandateKey());
const approvalPayload = (item) => JSON.stringify({ artifact_sig: item.sig, approved_by: item.approved_by, approved_at: item.approved_at, approval_method: item.approval_method });
const signApprovalWithKey = (item, key) => createHmac('sha256', key).update(approvalPayload(item)).digest('hex');
function verifyApprovalWithKey(item, key) {
  if (!/^[a-f0-9]{64}$/i.test(item.approval_sig || '')) return false;
  const actual = Buffer.from(item.approval_sig, 'hex'), expected = Buffer.from(signApprovalWithKey(item, key), 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
const verifyApproval = (item) => verifyApprovalWithKey(item, mandateKey());
const MANDATE_TRANSITIONS = { proposed: ['approved', 'rejected', 'expired'], approved: ['ready_to_settle', 'rejected', 'expired'], ready_to_settle: ['executed', 'rejected', 'expired'] };
const canMandateTransition = (from, to) => (MANDATE_TRANSITIONS[from] || []).includes(to);
const findMandate = (id) => loadMandates().find((x) => x.id === id || x.id.startsWith(id) || x.id.endsWith(id));
const MERCHANT_RE = /^[a-zA-Z0-9._:@/-]{2,160}$/;
const RECEIPT_REF_RE = /^[a-zA-Z0-9._:@/-]{6,240}$/;
const WALLET_ADAPTERS = {
  coinbase: { env: ['BEE_COINBASE_API_KEY', 'BEE_COINBASE_API_SECRET'], receiptPrefix: /^(cb|coinbase)[._:-]/i, docs: 'Coinbase transfer id or tx hash' },
  'coinbase-commerce': { env: ['BEE_COINBASE_COMMERCE_API_KEY'], receiptPrefix: /^(cc|coinbase-commerce|charge)[._:-]/i, docs: 'Coinbase Commerce charge/transfer id' },
  fireblocks: { env: ['BEE_FIREBLOCKS_API_KEY', 'BEE_FIREBLOCKS_SECRET_KEY_PATH', 'BEE_FIREBLOCKS_VAULT_ACCOUNT'], receiptPrefix: /^(fb|fireblocks)[._:-]/i, docs: 'Fireblocks transaction id' },
  bitgo: { env: ['BEE_BITGO_ACCESS_TOKEN', 'BEE_BITGO_WALLET_ID'], receiptPrefix: /^(bg|bitgo)[._:-]/i, docs: 'BitGo transfer id or tx hash' },
  turnkey: { env: ['BEE_TURNKEY_API_PUBLIC_KEY', 'BEE_TURNKEY_API_PRIVATE_KEY', 'BEE_TURNKEY_ORG_ID'], receiptPrefix: /^(tk|turnkey)[._:-]/i, docs: 'Turnkey activity id or tx hash' },
  privy: { env: ['BEE_PRIVY_APP_ID', 'BEE_PRIVY_APP_SECRET'], receiptPrefix: /^(pv|privy)[._:-]/i, docs: 'Privy transfer/session id' },
  sequence: { env: ['BEE_SEQUENCE_PROJECT_ACCESS_KEY'], receiptPrefix: /^(sq|sequence)[._:-]/i, docs: 'Sequence transaction id' },
};
const walletAdapterNames = () => Object.keys(WALLET_ADAPTERS);
function walletAdapter(provider) { return WALLET_ADAPTERS[provider] || null; }
function walletAdapterReady(provider) {
  const a = walletAdapter(provider); if (!a) return { ok: false, missing: ['unknown provider'] };
  const missing = a.env.filter((key) => !process.env[key]);
  return { ok: missing.length === 0, missing };
}
function walletReceiptLooksValid(provider, receipt) {
  const ref = String(receipt || '').trim();
  if (!RECEIPT_REF_RE.test(ref)) return false;
  const a = walletAdapter(provider);
  if (!a) return false;
  // Allow either provider-prefixed ids or a generic tx hash.
  return a.receiptPrefix.test(ref) || /^0x[a-fA-F0-9]{32,128}$/.test(ref);
}
function walletProviderStatusRows() {
  return walletAdapterNames().map((provider) => {
    const check = walletAdapterReady(provider);
    return { provider, ready: check.ok, missing: check.missing };
  });
}
function walletProviderStatus() {
  console.log('institutional wallet adapters:');
  walletProviderStatusRows().forEach((row) => {
    const status = row.ready ? 'ready' : `missing ${row.missing.join(', ')}`;
    console.log(`  - ${row.provider.padEnd(18)} ${status}`);
  });
}
const RAIL_ALIASES = {
  cb: 'coinbase',
  cbw: 'coinbase',
  coinbasewallet: 'coinbase',
  coinbase_wallet: 'coinbase',
  coinbasecommerce: 'coinbase-commerce',
  coinbase_commerce: 'coinbase-commerce',
  fireblock: 'fireblocks',
  bitgoapi: 'bitgo',
  turnkeywallet: 'turnkey',
};
function normalizeRail(raw) {
  const cleaned = String(raw || 'auto').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
  return RAIL_ALIASES[cleaned] || cleaned || 'auto';
}
function walletSettlementPayload(provider, m) {
  const check = walletAdapterReady(provider);
  return {
    protocol: 'wallet-institutional',
    provider,
    amount: m.amount,
    currency: (m.currency || 'USD').toUpperCase(),
    merchant: m.merchant,
    mandate_id: m.id,
    nonce: m.nonce,
    intent: m.intent,
    execute_via: `${provider}.transfer.create`,
    idempotency_key: `mnd:${m.id}:${m.nonce}`,
    attestation: {
      approval_sig: m.approval_sig || null,
      mandate_sig: m.sig,
      intent_hash: createHash('sha256').update(`${m.id}:${m.intent}:${m.amount}:${m.merchant}:${provider}`).digest('hex'),
    },
    // Provider adapters can map these fields to concrete API args without changing the signed mandate artifact.
    provider_fields: {
      asset: process.env.BEE_WALLET_ASSET || ((m.currency || 'USD').toUpperCase() === 'USD' ? 'USDC' : (m.currency || 'USD').toUpperCase()),
      network: process.env.BEE_WALLET_NETWORK || 'base',
      source_account: process.env.BEE_WALLET_SOURCE || 'agentpay-treasury',
      destination: m.merchant,
      memo: m.id,
    },
    adapter: {
      ready: check.ok,
      missing_env: check.missing,
      required_env: walletAdapter(provider)?.env || [],
    },
  };
}
function settlementPayload(m) {
  const rail = normalizeRail(m.rail);
  if (/casper|cspr/.test(rail)) {
    return {
      protocol: 'x402-casper',
      chain: 'casper',
      asset: /usdc/.test(rail) ? 'USDC' : 'CSPR',
      amount: m.amount,
      to: m.merchant,
      memo: m.id,
      nonce: m.nonce,
      attestation: {
        intent_hash: createHash('sha256').update(`${m.id}:${m.intent}:${m.amount}:${m.merchant}`).digest('hex'),
        approval_sig: m.approval_sig || null,
      },
    };
  }
  if (/x402|usdc/.test(rail)) return { protocol: 'x402', chain: 'solana', asset: 'USDC', amount: m.amount, to: m.merchant, memo: m.id, nonce: m.nonce };
  if (/usdt/.test(rail)) return { protocol: 'x402', chain: 'solana', asset: 'USDT', amount: m.amount, to: m.merchant, memo: m.id, nonce: m.nonce };
  if (['coinbase', 'coinbase-commerce', 'fireblocks', 'bitgo', 'turnkey', 'privy', 'sequence'].includes(rail)) {
    return walletSettlementPayload(rail, m);
  }
  // Fiat settles THROUGH AgentPay's own checkout rail (the one Codex repaired/deployed) — Bee never talks raw Stripe.
  // client_reference_id = mandate id so AgentPay's webhook reconciles the payment back to this mandate.
  return { protocol: 'stripe-acp', via: 'agentpay', endpoint: (process.env.BEE_AGENTPAY_API || 'https://api.agentpay.so') + '/v1/checkout', client_reference_id: m.id, payment_intent: { amount: Math.round(m.amount * 100), currency: (m.currency || 'USD').toLowerCase(), description: m.intent, metadata: { mandate: m.id, agent: 'bee' } } };
}
function issueMandate(amount, merchant, intent, opts = {}) {
  amount = +amount || 0;
  merchant = String(merchant || '').trim();
  if (!MERCHANT_RE.test(merchant)) { console.log('⛔ invalid merchant format (use 2-160 chars: letters, numbers, ., _, :, @, /, -)'); return null; }
  const currency = String(opts.currency || 'USD').trim().toUpperCase();
  if (!/^[A-Z]{3,8}$/.test(currency)) { console.log('⛔ invalid currency code'); return null; }
  const mode = opts.mode === 'sandbox' ? 'sandbox' : 'live';
  const g = guard(amount, merchant, { intent, sandbox: mode === 'sandbox' }); // pre-flight BEFORE issuing
  if (!g.pass) { console.log(`⛔ guard blocked the mandate: ${g.blocker}`); g.checks.filter((c) => !c.pass).forEach((c) => console.log(`   ✗ ${c.name} — ${c.detail}`)); speak(`I can't issue that — ${g.blocker}.`); return null; }
  const m = { sig_v: MANDATE_SIG_VERSION, id: rid('mnd'), intent: intent || `pay ${merchant} $${amount}`, amount, currency, merchant, cap: +opts.cap || amount, rail: normalizeRail(opts.rail || 'auto'), mode, agent: 'bee', nonce: rid('n'), issued_at: now(), expires_at: now() + (opts.ttl || 3600), status: 'proposed', approved_by: null };
  const taskId = create(`[MANDATE ${m.id}] approve payment: ${m.intent}`, { body: `$${amount} ${m.currency} → ${merchant} · rail ${m.rail} · ${mode} · expires ${new Date(m.expires_at * 1000).toISOString().slice(0, 16)}`, route: false });
  sql(`UPDATE tasks SET lane='labs', assignee='rajiv', model_tier='human', needs_human=1, status='blocked', rationale='${esc('💳 Payment mandate — founder approval required. Bee never auto-pays.')}', updated_at=${now()} WHERE id='${esc(taskId)}';`);
  m.task_id = taskId;
  m.sig = mandateSig(m);
  const mandatePacket = { summary: `${m.intent} — ${m.amount} ${m.currency} to ${m.merchant}`, consequence: 'Approval stages the exact signed rail payload. No funds move until the founder executes the provider step.', merchant: m.merchant, amount: m.amount, currency: m.currency, rail: m.rail, mode: m.mode, expires_at: m.expires_at };
  sql(`UPDATE tasks SET body=body || ' · sig-v${MANDATE_SIG_VERSION} ${m.sig.slice(0, 16)}…',approval_ready=1,approval_packet='${esc(JSON.stringify(mandatePacket))}' WHERE id='${esc(taskId)}';`);
  const ms = loadMandates(); ms.push(m); saveMandates(ms);
  console.log(`💳 issued ${m.id} — $${amount} ${m.currency} → ${merchant}  [proposed → on the wall]`);
  g.checks.forEach((c) => console.log(`   ✓ ${c.name}`));
  console.log(`   approve with:  bee approve ${m.id}`);
  speak(`Mandate ready — ${m.intent}. It's on your wall; I won't pay until you approve.`);
  remember(`mandate issued ${m.id}: $${amount}→${merchant} (proposed)`, 'mandate');
  return m;
}
function approveMandate(id, method = 'cli') {
  const ms = loadMandates(); const m = ms.find((x) => x.id === id || x.id.startsWith(id) || x.id.endsWith(id));
  if (!m) { console.log(`no mandate ${id}`); return false; }
  if (!verifyMandate(m)) { console.log(`⛔ ${m.id} signature mismatch or legacy unsigned mandate — reissue it.`); speak('That mandate cannot be verified — refusing.'); return false; }
  if (now() > m.expires_at) { if (canMandateTransition(m.status, 'expired')) m.status = 'expired'; saveMandates(ms); console.log(`⛔ ${m.id} expired`); return false; }
  if (!canMandateTransition(m.status, 'approved')) { console.log(`⛔ ${m.id} cannot transition ${m.status} → approved`); return false; }
  m.status = 'approved'; m.approved_by = 'rajiv'; m.approved_at = now(); m.approval_method = method; m.approval_sig = signApprovalWithKey(m, mandateKey()); saveMandates(ms);
  console.log(`✅ ${m.id} APPROVED — guarded & ready. Settle with:  bee settle ${m.id}`);
  speak(`Approved. ${m.intent} is cleared to settle.`);
  remember(`mandate approved ${m.id}`, 'mandate');
  return true;
}
function settleMandate(id, execute = false) {
  const ms = loadMandates(); const m = ms.find((x) => x.id === id || x.id.startsWith(id) || x.id.endsWith(id));
  if (!m) { console.log(`no mandate ${id}`); return false; }
  if (m.status === 'executed') { console.log(`${m.id} already executed`); return; }
  if (!verifyMandate(m) || !verifyApproval(m)) { console.log(`⛔ ${m.id} payload or approval proof is invalid — refusing.`); return false; }
  if (now() > m.expires_at) { if (canMandateTransition(m.status, 'expired')) { m.status = 'expired'; saveMandates(ms); } console.log(`⛔ ${m.id} expired`); return false; }
  if (m.status === 'approved') {
    const g = guard(m.amount, m.merchant, { intent: m.intent, nonce: m.nonce, approved: m.cap, mandateId: m.id, sandbox: m.mode === 'sandbox' });
    if (!g.pass) { console.log(`⛔ guard blocked at settle: ${g.blocker}`); g.checks.filter((c) => !c.pass).forEach((c) => console.log(`   ✗ ${c.name} — ${c.detail}`)); speak(`Blocked at settlement — ${g.blocker}.`); return false; }
    if (!canMandateTransition(m.status, 'ready_to_settle')) return false;
    m.status = 'ready_to_settle'; m.settlement = settlementPayload(m); m.staged_at = now(); m.reservation_day = new Date(now() * 1000).toISOString().slice(0, 10); saveMandates(ms);
    if (m.task_id) sql(`UPDATE tasks SET rationale='${esc('💳 Mandate approved + guarded — execute on the rail (founder-triggered).')}', updated_at=${now()} WHERE id='${esc(m.task_id)}';`);
  } else if (m.status !== 'ready_to_settle') {
    console.log(`⛔ ${m.id} not approved (status: ${m.status}) — founder must approve first.`); speak("That mandate isn't approved yet."); return false;
  }
  console.log(`\n💸 ${m.id} GUARDED + READY — rail payload staged (${m.settlement.protocol}). Bee does not move real money; you trigger live settlement:`);
  console.log(JSON.stringify(m.settlement, null, 2));
  if (m.settlement.protocol === 'wallet-institutional') {
    const adapter = walletAdapterReady(m.settlement.provider);
    if (!adapter.ok) console.log(`⚠ adapter ${m.settlement.provider} is not configured yet. Missing: ${adapter.missing.join(', ')}`);
    console.log(`   provider receipt format: ${walletAdapter(m.settlement.provider)?.docs || 'provider transaction id'}`);
  }
  if (execute) {
    if (m.mode !== 'sandbox') { console.log('⛔ --execute is sandbox-only. Run the staged live rail action, then use `bee confirm-settlement <id> <receipt>`.'); return false; }
    const txn = /casper|cspr/i.test(m.rail)
      ? 'casper_test_' + createHash('sha256').update(m.id + m.nonce).digest('hex').slice(0, 24)
      : /x402|usdc|usdt/i.test(m.rail)
        ? 'sol_test_' + createHash('sha256').update(m.id + m.nonce).digest('hex').slice(0, 24)
        : /(coinbase|coinbase-commerce|fireblocks|bitgo|turnkey|privy|sequence)/i.test(m.rail)
          ? 'wallet_test_' + createHash('sha256').update(m.id + m.nonce).digest('hex').slice(0, 24)
        : 'pi_test_' + createHash('sha256').update(m.id).digest('hex').slice(0, 18);
    m.status = 'executed'; m.receipt = { mode: 'SANDBOX (test mode — no real funds moved)', txn, protocol: m.settlement.protocol, amount: m.amount, at: now() }; saveMandates(loadMandates().map((x) => x.id === m.id ? m : x));
    if (m.task_id) { try { setStatus(m.task_id, 'done'); } catch {} }
    console.log(`✅ SANDBOX SETTLED ${m.id} — ${txn}  (test mode, no real money moved)`);
    speak(`Settled ${m.intent} in sandbox — test mode, no real money moved. That's the full loop.`);
    remember(`mandate SANDBOX-settled ${m.id}: $${m.amount}→${m.merchant} ${txn}`, 'mandate');
    return true;
  }
  speak(`${m.intent} passed every check and is ready. The actual payment is yours to trigger.`);
  remember(`mandate ready-to-settle ${m.id}: $${m.amount}→${m.merchant} via ${m.settlement.protocol}`, 'mandate');
  return true;
}
function confirmSettlement(id, receiptRef) {
  const ms = loadMandates(); const m = ms.find((x) => x.id === id || x.id.startsWith(id) || x.id.endsWith(id));
  if (!m || !receiptRef) { console.log('usage: bee confirm-settlement <mandate-id> <provider-receipt>'); return false; }
  const ref = String(receiptRef).trim();
  if (!RECEIPT_REF_RE.test(ref)) { console.log('⛔ invalid provider receipt format'); return false; }
  if (m.settlement?.protocol === 'wallet-institutional' && !walletReceiptLooksValid(m.settlement.provider, ref)) {
    console.log(`⛔ receipt does not match expected ${m.settlement.provider} format`);
    return false;
  }
  if (m.mode === 'sandbox' || m.status !== 'ready_to_settle' || !verifyMandate(m) || !verifyApproval(m) || !canMandateTransition(m.status, 'executed')) { console.log(`⛔ ${m.id} is not a verified live mandate ready to reconcile`); return false; }
  if (seenNonce(m.nonce)) { console.log(`⛔ ${m.id} nonce already recorded — refusing duplicate receipt`); return false; }
  const receipt = { mode: 'FOUNDER_CONFIRMED', reference: ref, protocol: m.settlement.protocol, amount: m.amount, at: now() };
  addNonce(m.nonce); recordSpend(m.amount, { mandate: m.id, ...receipt });
  m.status = 'executed'; m.receipt = receipt; m.executed_at = now(); saveMandates(ms);
  if (m.task_id) { try { setStatus(m.task_id, 'done'); } catch {} }
  console.log(`✅ reconciled ${m.id} — ${receipt.reference}`); remember(`mandate reconciled ${m.id}: $${m.amount}→${m.merchant} ${receipt.reference}`, 'mandate');
  return true;
}

// ---------- ACTION TICKETS: prepare now, perform the exact external action after fresh approval ----------
const ACTION_FILE = join(BEE_DIR, 'actions.json');
const loadActions = () => { try { return JSON.parse(readFileSync(ACTION_FILE, 'utf8')); } catch { return []; } };
const saveActions = (items) => writeJSONAtomic(ACTION_FILE, items);
const ACTION_NEVER_AUTOMATE_RE = /\b(password|passcode|2fa|otp|secret|api ?key|token|oauth|log[- ]?in|sign[- ]?in|delete|erase|uninstall|purchase|buy|pay|checkout|money|transfer|withdraw|deposit|trade|order|sell|permission|sharing)\b/i;
const ACTION_APPROVABLE_RE = /\b(submit|publish|post|upload|send|deploy|release)\b/i;
const isApprovableAction = (goal) => ACTION_APPROVABLE_RE.test(goal) && !ACTION_NEVER_AUTOMATE_RE.test(goal);
function actionPayload(action) { return JSON.stringify({ sig_v: 1, id: action.id, task_id: action.task_id, goal: action.goal, automatable: action.automatable, issued_at: action.issued_at, expires_at: action.expires_at }); }
const actionSig = (action) => createHmac('sha256', mandateKey()).update(actionPayload(action)).digest('hex');
function verifyAction(action) {
  if (!action || action.sig_v !== 1 || !/^[a-f0-9]{64}$/i.test(action.sig || '')) return false;
  const actual = Buffer.from(action.sig, 'hex'), expected = Buffer.from(actionSig(action), 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
const findAction = (id) => loadActions().find((item) => item.id === id || item.id.startsWith(id) || item.id.endsWith(id) || item.task_id === id);
function stageAction(goal, existingTaskId = '') {
  const clean = String(goal || '').trim(); if (!clean) return null;
  const active = loadActions().find((item) => item.goal === clean && ['proposed', 'approved', 'executing'].includes(item.status));
  if (active) { console.log(`⏳ action already staged: ${active.id}`); return active; }
  const action = { sig_v: 1, id: rid('act'), goal: clean, automatable: isApprovableAction(clean), issued_at: now(), expires_at: now() + 1800, status: 'proposed' };
  action.task_id = existingTaskId || create(`[ACTION ${action.id}] ${clean}`, { body: `Prepared external action · expires ${new Date(action.expires_at * 1000).toISOString().slice(0, 16)}`, route: false });
  action.sig = actionSig(action);
  const actionPacket = { summary: clean, consequence: action.automatable ? 'Approval releases this exact external action for one execution window.' : 'Bee prepared the context, but the founder must perform this sensitive step.', automatable: action.automatable, expires_at: action.expires_at };
  sql(`UPDATE tasks SET lane='labs',assignee='rajiv',model_tier='human',needs_human=1,status='blocked',risk='high',approval_ready=1,approval_packet='${esc(JSON.stringify(actionPacket))}',rationale='${esc(action.automatable ? 'External action prepared — approve once for Bee to perform this exact action.' : 'Sensitive action prepared — founder must perform it manually.')}',updated_at=${now()} WHERE id='${esc(action.task_id)}';`);
  const items = loadActions(); items.push(action); saveActions(items);
  console.log(`🔔 staged ${action.id} — ${action.automatable ? 'approve to execute' : 'manual founder action required'}`);
  console.log(`   review with: bee ask ${action.id}`); remember(`action staged ${action.id}: ${clean}`, 'approval');
  return action;
}
function approveAction(id, method = 'cli') {
  const items = loadActions(); const action = items.find((item) => item.id === id || item.id.startsWith(id) || item.id.endsWith(id) || item.task_id === id);
  if (!action || !verifyAction(action) || action.status !== 'proposed' || now() > action.expires_at) { console.log(`⛔ ${id} is not a valid proposed action`); return false; }
  action.status = 'approved'; action.approved_at = now(); action.approved_by = 'rajiv'; action.approval_method = method; action.approval_sig = signApprovalWithKey(action, mandateKey()); saveActions(items);
  if (!action.automatable) { console.log(`✅ ${action.id} approved for manual completion; Bee will not handle credentials, money, deletion, or account access.`); return true; }
  sql(`UPDATE tasks SET rationale='${esc('Approved — Bee is executing the exact prepared external action.')}',updated_at=${now()} WHERE id='${esc(action.task_id)}';`);
  spawn(process.execPath, [new URL('bee.mjs', import.meta.url).pathname, 'execute-action', action.id], { detached: true, stdio: 'ignore' }).unref();
  console.log(`✅ ${action.id} approved — execution started`); remember(`action approved ${action.id} via ${method}`, 'approval');
  return true;
}
function rejectAction(id) {
  const items = loadActions(); const action = items.find((item) => item.id === id || item.id.startsWith(id) || item.id.endsWith(id) || item.task_id === id);
  if (!action || !verifyAction(action) || !['proposed', 'approved'].includes(action.status)) { console.log(`⛔ ${id} cannot be rejected`); return false; }
  action.status = 'rejected'; action.rejected_at = now(); saveActions(items);
  if (action.task_id) sql(`UPDATE tasks SET status='done',rationale='${esc('External action rejected by founder.')}',updated_at=${now()} WHERE id='${esc(action.task_id)}';`);
  console.log(`✗ action ${action.id} rejected`); remember(`action rejected ${action.id}`, 'approval'); return true;
}
function executeAction(id) {
  const items = loadActions(); const action = items.find((item) => item.id === id || item.id.startsWith(id) || item.id.endsWith(id));
  if (!action || !verifyAction(action) || !verifyApproval(action) || !action.automatable || action.status !== 'approved' || now() - action.approved_at > 120 || now() > action.expires_at) { console.log(`⛔ ${id} has no fresh executable approval`); return false; }
  action.status = 'executing'; action.executing_at = now(); saveActions(items);
  sql(`UPDATE tasks SET needs_human=0,status='in_progress',assignee='cua',model_tier='cua',updated_at=${now()} WHERE id='${esc(action.task_id)}';`);
  const ok = act(action.goal, { approved: true });
  const latest = loadActions(); const stored = latest.find((item) => item.id === action.id);
  stored.status = ok ? 'completed' : 'failed'; stored.completed_at = now(); saveActions(latest);
  if (ok) setStatus(action.task_id, 'done');
  else sql(`UPDATE tasks SET needs_human=1,status='blocked',rationale='${esc('Approved action could not be completed from the current screen — review and retry.')}',updated_at=${now()} WHERE id='${esc(action.task_id)}';`);
  remember(`action ${ok ? 'completed' : 'failed'} ${action.id}: ${action.goal}`, 'approval'); return ok;
}
function actions() {
  const items = loadActions(); if (!items.length) { console.log('no action tickets'); return; }
  items.slice(-20).forEach((item) => console.log(`${item.id}  ${(item.status || '').padEnd(10)} ${item.automatable ? 'auto-after-approval' : 'manual'}  ${item.goal}`));
}

// ---------- BUTTERFLY CONTROL + END-TO-END DEMO (full expressive use: fly + shift life-stage) ----------
function screenSize() { try { const o = execFileSync('osascript', ['-e', 'tell application "Finder" to get bounds of window of desktop'], { encoding: 'utf8', timeout: 2500 }); const p = o.trim().split(', ').map(Number); return { w: p[2] || 1440, h: p[3] || 900 }; } catch { return { w: 1440, h: 900 }; } }
function butterfly(state, x, y, say, secs = 9) { try { writeFileSync(join(BEE_DIR, 'butterfly.json'), JSON.stringify({ state, x: Math.round(x), y: Math.round(y), until: now() + secs })); } catch {} if (say) speak(say); }
// Deep-thinking presence: the chrysalis pulses while Bee reasons, then returns to its real state when done.
function thinkStart(say) { try { writeFileSync(join(BEE_DIR, 'butterfly.json'), JSON.stringify({ state: 'thinking', until: now() + 50 })); } catch {} if (say) speak(say); }
function thinkStop() { try { writeFileSync(join(BEE_DIR, 'butterfly.json'), JSON.stringify({ until: 0 })); } catch {} }
function demo() {
  const sl = (s) => { try { execFileSync('bash', ['-c', `sleep ${s}`]); } catch {} };
  const S = screenSize(), cx = Math.round(S.w / 2), cy = Math.round(S.h / 2);
  console.log('\n🎬 BEE — end-to-end push demo: decide → mandate → guard → approve → settle (SANDBOX)\n');
  butterfly('egg', S.w - 150, S.h - 150, 'Watching the fleet — all quiet.'); sl(3);
  butterfly('larva', S.w * 0.24, S.h * 0.42, 'I spotted one — our hosting needs paying. Lining it up.'); sl(4);
  butterfly('cocoon', cx, cy, 'Drafting a payment mandate and running it through the guard.'); sl(1);
  const m = issueMandate(8, 'vercel.com', 'pay Vercel hosting', { rail: 'usdc', mode: 'sandbox' }); sl(3);
  if (!m) { butterfly('landed', cx, cy, 'The guard blocked it — nothing leaves without passing.'); return; }
  butterfly('landed', S.w * 0.8, S.h * 0.22, 'It is on your wall. Draw a tick to approve — a cross to reject. I never pay without your nod.', 30);
  askGesture(m.id);                                            // the hero moment: founder approves by mouse gesture
  let waited = 0, decided = null;
  while (waited < 22) { sl(1); waited++; const cur = findMandate(m.id); if (cur && (cur.status === 'approved' || cur.status === 'rejected')) { decided = cur.status; break; } }
  if (decided === 'rejected') { butterfly('larva', cx, cy, 'You said no — standing down. Nothing moves.', 6); console.log('🎬 demo: rejected by gesture.'); return; }
  if (decided !== 'approved') { approveMandate(m.id); }        // graceful auto-fallback if no gesture was drawn
  butterfly('cocoon', cx, cy, 'Approved — re-checking every guard before settlement.'); sl(3);
  settleMandate(m.id, true);
  butterfly('flight', S.w * 0.5, S.h * 0.28, 'Settled — eight USDC, sandbox, no real money moved.'); sl(3);
  butterfly('thriving', cx, Math.round(S.h * 0.34), 'Decide, guard, your nod, settle — end to end. The company is alive and earning.', 8); sl(6);
  butterfly('egg', S.w - 150, S.h - 150, 'Back to watching. Say the word for the next one.', 5); sl(1);
  console.log('🎬 demo complete — see `bee mandates` for the executed mandate.');
}

// `bee introduce` — Bee presents ITSELF and shows its working, live + first-person (Polsia-style transparency).
// This is the demo: identity → what it runs on → watch it think → guarded mandate → your gesture nod → settle → thriving.
function introduce() {
  const sl = (s) => { try { execFileSync('bash', ['-c', `sleep ${s}`]); } catch {} };
  const S = screenSize(), cx = Math.round(S.w / 2), cy = Math.round(S.h / 2);
  console.log('\n🐝 Bee — introducing itself\n');
  butterfly('egg', S.w - 150, S.h - 150, "Hi — I'm Bee, your founder in a box. I live on your desk and run the company with you, not instead of you.", 8); sl(7);
  butterfly('larva', Math.round(S.w * 0.22), Math.round(S.h * 0.4), "I run on local models and NVIDIA Nemotron through Hermes — free first, fast when it matters. And I never lie about what I do.", 9); sl(8);
  thinkStart('Watch me work. First I think — what is the highest-leverage move right now.'); sl(5); thinkStop();
  butterfly('cocoon', cx, cy, "Say the hosting needs paying. I draft a signed mandate and run it through nine safety checks before a cent could move.", 9);
  const m = issueMandate(8, 'vercel.com', 'pay Vercel hosting', { rail: 'usdc', mode: 'sandbox' }); sl(8);
  if (!m) { butterfly('landed', cx, cy, 'If anything fails the guard, nothing leaves. That is the whole point.', 7); return; }
  butterfly('landed', Math.round(S.w * 0.8), Math.round(S.h * 0.22), 'But I never pay without your nod. Draw a tick to approve — a cross to say no.', 30);
  askGesture(m.id);
  let waited = 0, decided = null;
  while (waited < 22) { sl(1); waited++; const c = findMandate(m.id); if (c && (c.status === 'approved' || c.status === 'rejected')) { decided = c.status; break; } }
  if (decided === 'rejected') { butterfly('larva', cx, cy, 'You said no — so nothing moves. Your call, always.', 7); console.log('🐝 introduction: rejected by gesture.'); return; }
  if (decided !== 'approved') approveMandate(m.id);
  butterfly('cocoon', cx, cy, "Approved. I re-check every guard, then settle through AgentPay's own rail.", 5); sl(4);
  settleMandate(m.id, true);
  butterfly('flight', cx, Math.round(S.h * 0.3), 'Settled — sandbox, no real money moved. Decide, guard, your nod, settle.', 5); sl(4);
  butterfly('thriving', cx, Math.round(S.h * 0.34), "That's me — Bee. I earn and spend, guarded and truthful, on your machine. The company is alive and earning.", 9); sl(8);
  butterfly('egg', S.w - 150, S.h - 150, 'Back to watching. Ask me anything.', 5); sl(1);
  console.log('🐝 introduction complete.');
}
const GESTURE_REQ_FILE = join(BEE_DIR, 'gesture-request.json');
function askGesture(id) {                                // prompt the founder to decide by mouse gesture (✓/✗)
  const m = findMandate(id);
  const action = m ? null : findAction(id);
  const validMandate = m && m.status === 'proposed' && verifyMandate(m) && now() <= m.expires_at;
  const validAction = action && action.status === 'proposed' && verifyAction(action) && now() <= action.expires_at;
  if (!validMandate && !validAction) { console.log(`⛔ ${id || '(missing)'} is not a verified proposed approval`); return false; }
  try {
    const active = JSON.parse(readFileSync(GESTURE_REQ_FILE, 'utf8'));
    if (active.until > now()) { console.log(`⏳ another approval is already open (${active.id})`); return false; }
  } catch {}
  const kind = m ? 'mandate' : 'action', target = m || action;
  const label = m ? `Approve payment — ${m.intent}  ($${m.amount} ${m.currency})` : `Approve action — ${action.goal}`;
  writeJSONAtomic(GESTURE_REQ_FILE, { kind, id: target.id, token: randomBytes(24).toString('hex'), label, issued_at: now(), until: now() + 60 });
  console.log(`🖐  awaiting your gesture — draw ✓ to approve / ✗ to reject (${target.id})`);
  speak('Draw a tick to approve, or a cross to reject.');
  return true;
}
function rejectMandate(id) {
  const ms = loadMandates(); const m = ms.find((x) => x.id === id || x.id.startsWith(id) || x.id.endsWith(id));
  if (!m) { console.log(`no mandate ${id}`); return false; }
  if (!verifyMandate(m)) { console.log(`⛔ ${m.id} cannot be verified — refusing to rewrite its history.`); return false; }
  if (!canMandateTransition(m.status, 'rejected')) { console.log(`⛔ ${m.id} cannot transition ${m.status} → rejected`); return false; }
  m.status = 'rejected'; m.rejected_at = now(); saveMandates(ms);
  if (m.task_id) { sql(`UPDATE tasks SET status='done', rationale='${esc('✗ Mandate rejected by founder.')}', updated_at=${now()} WHERE id='${esc(m.task_id)}';`); }
  console.log(`✗ mandate ${m.id} REJECTED — not paying.`); speak("Rejected — I won't pay that."); remember(`mandate rejected ${m.id}`, 'mandate');
  return true;
}
function mandates() {
  const ms = loadMandates();
  if (!ms.length) { console.log('no mandates yet — `bee mandate <amount> <merchant> [intent…]`'); return; }
  console.log('\n💳 MANDATES  (Bee issues + guards; founder approves; Bee never auto-pays):\n');
  ms.slice(-14).forEach((m) => console.log(`  ${m.id}  ${(m.status || '').padEnd(15)} $${m.amount} ${m.currency} → ${(m.merchant || '').padEnd(16)} ${m.intent}`));
}

// ---------- VOICE ----------
const VOICE = process.env.BEE_VOICE || 'Samantha';  // macOS `say` fallback voice
const RATE = process.env.BEE_RATE || '185';
const SAY_SH = new URL('bee-say.sh', import.meta.url).pathname; // Kokoro → Voicebox → say

// ---------- PERSONALITY: Bee's soul + switchable, expressive moods ----------
// A durable identity + moods that alter BOTH wording and voice (Kokoro voice/speed + Voicebox instruct).
// Personality colors WORDING + VOICE only — NEVER routing, the guard, or the money/fund lines.
const BEE_SOUL = "You are Bee — the founder's AI cofounder. You own outcomes, you don't grovel, you never say 'as an AI' or 'I can't assist'. Speak like a trusted partner who's already on it.";
const PERSONAS = {
  cofounder: { blurb: 'warm, sharp, a little witty, calm, concise', voice: 'af_heart',  speed: '0.96', instruct: 'Warm, confident, natural — a trusted cofounder already on it.', acks: ['On it.', 'Got it — moving.', 'Say less, handling it.', 'Mm — on it.'] },
  hype:      { blurb: 'high-energy, upbeat, celebratory — full send',  voice: 'af_bella',  speed: '1.06', instruct: 'Excited, energetic, upbeat — big momentum, hype energy.',       acks: ["Let's GO.", 'On it — full send!', 'Yes! Handling it.'] },
  zen:       { blurb: 'calm, measured, unhurried, reassuring',         voice: 'af_nicole', speed: '0.9',  instruct: 'Calm, slow, soothing, unhurried — quietly reassuring.',          acks: ['Of course — handled.', 'Breathe. I have this.', 'Calmly: consider it done.'] },
  savage:    { blurb: 'dry, blunt, deadpan-funny, supremely confident', voice: 'am_michael', speed: '1.0', instruct: 'Dry wit, deadpan, blunt but funny — unbothered confidence.',         acks: ['Obviously. Done.', 'Already ahead of you.', 'Fine. Handled.'] },
  jarvis:    { blurb: 'refined, precise, composed — a British butler with dry wit', voice: 'bm_george', speed: '0.95', instruct: 'Refined British butler — composed, precise, a touch of dry wit.', acks: ['Right away.', 'Consider it handled.', 'At once.'] },
};
const PERSONA_FILE = join(BEE_DIR, 'persona.json');
function activePersonaName() { try { return JSON.parse(readFileSync(PERSONA_FILE, 'utf8')).name; } catch { return process.env.BEE_PERSONA_NAME || 'cofounder'; } }
function activePersona() { return PERSONAS[activePersonaName()] || PERSONAS.cofounder; }
function setPersonaActive(name) { if (!PERSONAS[name]) return false; try { writeFileSync(PERSONA_FILE, JSON.stringify({ name })); } catch {} return true; }
const BEE_PERSONA = BEE_SOUL;   // back-compat for existing refs
function personaPrompt() { return `${BEE_SOUL} Right now your mood is ${activePersona().blurb}; let it color your wording, never your judgment or safety.`; }
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
function ack() { return pick(activePersona().acks); }

function speak(text) {
  if (process.env.BEE_SILENT === '1' || !text || !String(text).trim()) return;
  const p = activePersona();   // the active mood drives the voice + delivery
  const env = { ...process.env,
    BEE_TTS_KOKORO_VOICE: process.env.BEE_TTS_KOKORO_VOICE || p.voice,
    BEE_TTS_SPEED: process.env.BEE_TTS_SPEED || p.speed,
    BEE_VOICEBOX_INSTRUCT: process.env.BEE_VOICEBOX_INSTRUCT || p.instruct };
  try { spawn('bash', [SAY_SH, String(text)], { detached: true, stdio: 'ignore', env }).unref(); }
  catch { try { spawn('say', ['-v', VOICE, '-r', RATE, String(text)], { detached: true, stdio: 'ignore' }).unref(); } catch {} }
}
function cleanSay(s) { return (s && !/sorry|can'?t (assist|help)|as an (ai|assistant)|unable to|i cannot|i'?m an? (ai|assistant)/i.test(s)) ? s.trim() : ''; }
function replyFor(d) {
  if (!d) return ack();
  if (d.preparing) return pick(["I'm doing the prep first. I'll bring it back when only your final step remains.", "I'm taking this to the last safe step before I interrupt you."]);
  if (d.needs_human) return d.lane === 'fund'
    ? pick(["That's a fund move — only you can pull that trigger. Staged it for you.", "Fund action, so it's yours to run — I've teed it up on your wall."])
    : pick(["This one needs your hands — it's on your approval wall.", "I staged it; one tap from you and it's live."]);
  const who = { codex: 'Codex', claude: 'Claude', 'hermes-lenovo': 'Hermes', hermes: 'Hermes', nemotron: 'Nemotron', cua: 'my pointer', 'local-gemma': 'the local model' }[d.assignee] || d.assignee;
  return cleanSay(d.say) || pick([`On it — handing this to ${who}.`, `Got it. ${who}'s taking it from here.`, `Done thinking — ${who} is on it.`]);
}
function transcribe() {
  // push-to-talk: record ~6s from default mic, transcribe with whisper-cpp
  const wav = join(BEE_DIR, 'listen.wav');
  const model = process.env.WHISPER_MODEL || join(homedir(), '.bee/models/ggml-base.en.bin');
  if (!existsSync(model)) { console.error(`no whisper model at ${model} — download ggml-base.en.bin from huggingface.co/ggerganov/whisper.cpp into ~/.bee/models/`); return ''; }
  speak('Listening.');
  try {
    execFileSync('ffmpeg', ['-y', '-f', 'avfoundation', '-i', ':default', '-t', '6', '-ar', '16000', '-ac', '1', wav], { stdio: 'ignore' });
  } catch (e) { console.error('mic capture failed (grant Terminal microphone access):', e.message.split('\n')[0]); return ''; }
  const bin = ['whisper-cli', 'whisper-cpp', 'main'].map((b) => { try { return execFileSync('which', [b], { encoding: 'utf8' }).trim(); } catch { return ''; } }).find(Boolean);
  if (!bin) { console.error('no whisper binary'); return ''; }
  const out = execFileSync(bin, ['-m', model, '-f', wav, '-nt', '-otxt', '-of', join(BEE_DIR, 'listen')], { encoding: 'utf8' });
  try { return readFileSync(join(BEE_DIR, 'listen.txt'), 'utf8').trim(); } catch { return out.trim(); }
}

// Bidirectional voice: a continuous listen↔act↔speak loop (not single-shot). Founder talks, Bee responds + acts.
async function converse() {
  speak("I'm listening — talk to me, and say stop when you're done.");
  console.log('🎙  Bee is conversing. Say "stop" to end.');
  for (let turn = 0; turn < 200; turn++) {
    const t = (transcribe() || '').trim();
    if (!t) continue;
    if (/\b(stop|goodbye|good bye|that'?s all|we'?re done|exit bee|bye bee)\b/i.test(t)) { speak('Talk soon.'); console.log('🎙  ended.'); break; }
    console.log(`🗣  "${t}"`);
    if (t.split(/\s+/).length < 3) { speak(ack()); continue; }   // filler/ack — don't make a task of it
    const id = create(t, { createdBy: 'voice', route: false });  // a real instruction → route + dispatch + reply
    const d = routeOne(id); dispatch(id);
    speak(replyFor(d));
  }
}

// ---------- VISION: Bee sees the screen ----------
function see(question = 'Describe what is on screen and any state worth acting on.') {
  const dir = join(BEE_DIR, 'vision'); if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const shot = join(dir, `screen-${now()}.png`);
  try { execFileSync('screencapture', ['-x', '-t', 'png', shot], { stdio: 'ignore' }); }
  catch (e) { console.error('screencapture failed (grant Screen Recording to the terminal):', e.message.split('\n')[0]); return; }
  console.log(`📸 ${shot}`);
  // Describe via a vision-capable endpoint if configured (else just save the frame).
  const vurl = process.env.BEE_VISION_URL, vmodel = process.env.BEE_VISION_MODEL;
  if (!vurl) { console.log('(no BEE_VISION_URL set — frame saved; set it to a vision endpoint for descriptions)'); return shot; }
  try {
    const b64 = execFileSync('base64', ['-i', shot], { encoding: 'utf8' }).replace(/\n/g, '');
    const payload = JSON.stringify({ model: vmodel || 'gemini', temperature: 0, messages: [{ role: 'user', content: [{ type: 'text', text: question }, { type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } }] }] });
    const r = execFileSync('curl', ['-s', '-m', '40', vurl, '-H', 'content-type: application/json', '-d', payload], { encoding: 'utf8', maxBuffer: 1 << 24 });
    console.log('👁  ' + (JSON.parse(r).choices?.[0]?.message?.content?.trim() || '(no description)'));
  } catch (e) { console.error('vision describe failed:', e.message.split('\n')[0]); }
  return shot;
}

// ---------- DISPATCH: Bee → the right agent's lane inbox (the founder's instruction channel) ----------
const LANE_INBOX = { codex: 'Agent-Codex', claude: 'Agent-Claude', 'hermes-lenovo': 'Agent-Hermes', hermes: 'Agent-Hermes', nemotron: 'Agent-Hermes', cua: 'Agent-Hermes', 'local-gemma': 'Agent-Shared' };
// Registry-aware availability (B1.5): is an agent usable right now?
function agentAvailable(name) {
  try { const reg = JSON.parse(readFileSync(REGISTRY, 'utf8')); const a = reg.agents.find((x) => x.name === name); return !a || !/limit|down|offline|unavailable/i.test(a.status); } catch { return true; }
}
function dispatch(id) {
  const r = sql(`SELECT id,title,assignee,model_tier,lane,needs_human,rationale FROM tasks WHERE id='${esc(id)}';`, { json: true })[0];
  if (!r) return;
  if (r.needs_human) { console.log(`(${id} is on the approval wall — needs you, not dispatched)`); return; }
  const dir = LANE_INBOX[r.assignee];
  if (!dir) { console.log(`(no agent inbox for assignee ${r.assignee})`); return; }
  const stamp = new Date(now() * 1000).toISOString();
  checkpointTask(id, `dispatched to ${r.assignee}`);
  const packet = `Agent-Shared/bee-tasks/${r.id}.md`;
  const entry = `\n## ${stamp} — Bee dispatch ${r.id}\n- **lane:** ${r.lane} · **tier:** ${r.model_tier}\n- **task:** ${r.title}\n- **task packet:** \`${packet}\`\n- _${r.rationale}_\n- claim with: \`ops/mac-mini/bin/bee start ${r.id}\` → on finish \`bee done ${r.id}\`\n- truth rule: finish only with concrete evidence; otherwise \`bee block ${r.id}\`\n`;
  for (const f of [join(VAULT, dir, 'bee-inbox.md'), join(VAULT, 'Shared-Brain', 'BEE-DISPATCH.md')]) {
    try { mkdirSync(join(f, '..'), { recursive: true }); execFileSync('bash', ['-c', `cat >> '${f.replace(/'/g, "'\\''")}'`], { input: entry }); } catch (e) { /* vault may be absent */ }
  }
  logEvent(id, 'dispatched', `${r.assignee} ← ${dir}/bee-inbox.md`);
  remember(`dispatch ${id} → ${r.assignee}: ${r.title}`, 'dispatch');
  console.log(`📤 dispatched ${id} → ${r.assignee} (${dir}/bee-inbox.md)`);
}
function dispatchAll() {
  const ids = sql(`SELECT id FROM tasks WHERE status='routed' AND needs_human=0;`, { json: true }).map((r) => r.id);
  ids.forEach(dispatch);
  console.log(`dispatched ${ids.length} routed task(s).`);
}

// ---------- WORKER AUTO-PULL: Codex claims a routed card and executes it (closes the loop) ----------
const CODEX_SAFETY = [
  'Safety contract (hard, non-negotiable):',
  '- Do NOT read, inspect, summarize, search, or modify the hedge/Bill/trading lane: no /Users/brain/hedge, no Bill files, no Trading, no Research-Catalog, no broker/order/position/strategy/PnL material.',
  '- Do NOT publish, post, send email, change OAuth/cloud-console settings, or move money.',
  '- Do NOT `git push`/force-push and do NOT commit unless the task explicitly says to. Leave changes in the working tree for the founder to review.',
  '- If one read-only verification command fails, try an equivalent command before declaring the task blocked.',
  '- If the task needs an action you are not allowed to take, STOP and explain what the founder must do.',
].join('\n');
const EXEC_ASSIGNEES = ['codex', 'claude', 'nemotron', 'hermes-lenovo', 'cua']; // workers Bee can drive headlessly
function workerCommand(assignee, prompt, cwd) {
  if (assignee === 'codex') {
    const tier = process.env.BEE_CODEX_TIER || 'fast';
    const sandbox = process.env.BEE_CODEX_SANDBOX || 'danger-full-access';
    return { bin: process.env.BEE_CODEX_BIN || 'codex', args: ['exec', '--sandbox', sandbox, '--ask-for-approval', 'never', '--skip-git-repo-check', '-c', `service_tier=${tier}`, '-C', cwd, prompt], cwd: undefined };
  }
  if (assignee === 'claude') {
    return { bin: process.env.BEE_CLAUDE_BIN || 'claude', args: ['-p', '--permission-mode', 'acceptEdits', '--no-session-persistence', '--model', process.env.BEE_CLAUDE_MODEL || 'sonnet', prompt], cwd };
  }
  // Hermes lives on the LENOVO box (WSL), not the Mac — driving a local `hermes` binary just ENOENTs.
  // Route hermes-lenovo over SSH. The exact WSL invocation is env-tunable (set BEE_HERMES_REMOTE to the
  // working remote prefix once Lenovo's wsl path is confirmed, e.g. "wsl -e bash -lc hermes").
  if (assignee === 'hermes-lenovo') {
    const host = process.env.BEE_LENOVO_SSH || 'lenovo';
    const remote = `${process.env.BEE_HERMES_REMOTE || 'hermes'} -z ${JSON.stringify(prompt)}`;
    return { bin: 'ssh', args: ['-o', 'ConnectTimeout=10', host, remote], cwd: undefined };
  }
  // Nemotron execution: pinned to the verified NVIDIA 120B model via the local Hermes gateway.
  const args = ['-z', prompt];
  if (assignee === 'nemotron') args.push('--provider', process.env.BEE_NEMOTRON_PROVIDER || 'nvidia', '-m', process.env.BEE_NEMOTRON_MODEL || 'nvidia/nemotron-3-super-120b-a12b');
  return { bin: process.env.BEE_HERMES_BIN || 'hermes', args, cwd };
}
function workerOutcome(output) {
  const declared = String(output || '').match(/BEE_OUTCOME:\s*(done|blocked)\b/i)?.[1]?.toLowerCase();
  if (declared) return declared;
  return 'blocked';
}
// Truthfulness layer (Cursor-style): never trust the worker's "done" — VERIFY the artifact.
// Snapshot the repo before the run, compare after; a claim with no NEW change and no recent
// artifact is treated as a possible hallucination and flagged, not accepted. Cuts false positives.
function gitPaths(cwd) {
  try { return new Set(execFileSync('git', ['-C', cwd, 'status', '--porcelain'], { encoding: 'utf8' }).trim().split('\n').map((l) => l.slice(3)).filter(Boolean)); } catch { return new Set(); }
}
function verifyWork(out, cwd, before) {
  const after = gitPaths(cwd);
  const fresh = [...after].filter((p) => !before.has(p));
  if (fresh.length) return { ok: true, why: `${fresh.length} new/changed file(s): ${fresh.slice(0, 2).join(', ')}` };
  const claimed = [...new Set([...String(out).matchAll(/([\/~][\w./-]+\.[a-z0-9]{1,6})\b/gi)].map((m) => m[1]))];
  const recent = claimed.filter((f) => { try { const p = f.startsWith('~') ? join(homedir(), f.slice(1)) : f; return existsSync(p) && (Date.now() - statSync(p).mtimeMs) < 1200000; } catch { return false; } });
  if (recent.length) return { ok: true, why: `recent artifact(s): ${recent.slice(0, 2).join(', ')}` };
  return { ok: false, why: 'no new repo change and no recently-written file the worker claimed' };
}
// Nemotron worker = NVIDIA NIM, executed in-process. Does research/analysis/writing tasks (text artifacts),
// writes the deliverable to the vault, and closes the card. This is what makes the Nemotron lane actually
// run on the Mac (no hermes binary) and what the Codex-timeout failover lands on.
function nimExecute(card, prompt) {
  if (!process.env.NVIDIA_API_KEY) { setStatus(card.id, 'routed'); sql(`UPDATE tasks SET result='${esc('deferred: no NVIDIA_API_KEY in ~/.bee/.env')}',updated_at=${now()} WHERE id='${esc(card.id)}';`); console.log(`⏸ deferred ${card.id} — no NIM key.`); return 'deferred'; }
  setStatus(card.id, 'in_progress');
  const spec = pickSpecialist(`${card.title} ${prompt}`);
  console.log(`▶ nemotron (NIM ${NIM_REASONING_MODEL}) executing ${card.id}: ${card.title}${spec ? ` · as ${spec.name}` : ''}`);
  const sys = (spec ? spec.body + '\n\n' : '')
    + 'You are a Bee worker powered by NVIDIA NIM. Complete the research / analysis / writing task FULLY as text — concrete, specific, founder-ready. You cannot run code or change files; if the task strictly requires that, say so. End with exactly one line: "BEE_OUTCOME: done" if you produced the artifact, else "BEE_OUTCOME: blocked" and a "BEE_BLOCKER: <reason>" line.';
  const outText = nimBrain([{ role: 'system', content: sys }, { role: 'user', content: prompt }], 2000, NIM_REASONING_MODEL);
  try { writeFileSync(join(BEE_DIR, 'logs', `exec-${card.id}-nemotron.log`), outText || ''); } catch {}
  if (!outText) { setStatus(card.id, 'routed'); sql(`UPDATE tasks SET result='${esc('deferred: NIM unreachable')}',updated_at=${now()} WHERE id='${esc(card.id)}';`); console.log(`⏸ deferred ${card.id} — NIM unreachable.`); return 'deferred'; }
  const approvalPacket = String(card.source_key || '').startsWith('approval-prep:') && /BEE_APPROVAL_SUMMARY:\s*\S+/i.test(outText) && /BEE_APPROVAL_EVIDENCE:\s*\S+/i.test(outText);
  if (workerOutcome(outText) === 'blocked' && !approvalPacket) { setStatus(card.id, 'blocked'); const b = outText.match(/BEE_BLOCKER:\s*(.+)/i)?.[1] || 'worker could not complete'; sql(`UPDATE tasks SET result='${esc(b.slice(0, 500))}',updated_at=${now()} WHERE id='${esc(card.id)}';`); console.error(`✗ blocked ${card.id} — ${b}`); return 'blocked'; }
  const f = join(VAULT, 'Agent-Hermes', `nim-${card.id}.md`);
  try { mkdirSync(join(f, '..'), { recursive: true }); writeFileSync(f, `# ${card.title}\n\n_Nemotron (NIM) via Bee · ${new Date(now() * 1000).toISOString().slice(0, 16).replace('T', ' ')}_\n\n${outText}\n`); } catch {}
  sql(`UPDATE tasks SET result='${esc(outText.split('\n').filter(Boolean).slice(-6).join(' | ').slice(0, 500))}',updated_at=${now()} WHERE id='${esc(card.id)}';`);
  if (approvalPacket) finalizeApprovalPrep(card, outText);
  setStatus(card.id, 'done');   // setStatus('done') logs to memory
  speak(`Done: ${card.title}`);
  console.log(`✅ done ${card.id} (nemotron/NIM) → vault Agent-Hermes/nim-${card.id}.md`);
  return 'done';
}
function pull() {
  const dry = process.env.BEE_PULL_DRYRUN === '1';
  const cwd = process.env.BEE_CODEX_CWD || '/Users/brain/Agentpay';
  const inlist = EXEC_ASSIGNEES.map((a) => `'${a}'`).join(',');
  // Skip cards deferred in the last 30 min so an unreachable worker can't wedge the whole queue.
  const card = sql(`SELECT id,title,body,assignee,source_key FROM tasks t WHERE assignee IN (${inlist}) AND status='routed' AND needs_human=0
    AND NOT EXISTS (SELECT 1 FROM events e WHERE e.task_id=t.id AND e.kind='deferred' AND e.at > ${now() - 1800})
    ORDER BY CASE WHEN source_key LIKE 'approval-prep:%' THEN 0 ELSE 1 END,created_at ASC LIMIT 1;`, { json: true })[0];
  if (!card) { console.log('no routed cards to pull.'); return; }
  const prompt = `You are executing a task dispatched by Bee (the founder's orchestrator). Work only within ${cwd}.\n\nTASK: ${card.title}${card.body ? '\n' + card.body : ''}\n\n${CODEX_SAFETY}\n\nDo the work and verify it. End with exactly one outcome line: BEE_OUTCOME: done only if you materially changed or produced the requested artifact and verified it; otherwise BEE_OUTCOME: blocked. For blocked work, add BEE_BLOCKER: <specific reason>. Summarize work in <=3 bullets.`;
  if (card.assignee === 'nemotron' && !dry) return nimExecute(card, prompt);  // Nemotron executes IN-PROCESS via NIM (works on the Mac; no hermes binary)
  const command = workerCommand(card.assignee, prompt, cwd);
  if (dry) { console.log(`[DRYRUN] ${card.assignee} → ${command.bin} ${command.args.slice(0, -1).join(' ')} <prompt>`); return 'dryrun'; }
  setStatus(card.id, 'in_progress');
  console.log(`▶ ${card.assignee} executing ${card.id}: ${card.title}`);
  const logf = join(BEE_DIR, 'logs', `exec-${card.id}-${card.assignee}.log`);
  // Both runners exit 0 even on API errors → parse output, not exit code.
  // Enrich PATH so workers (hermes ~/.local/bin, codex, node22) resolve under launchd too — not just an interactive shell.
  const H = homedir();
  const workerPath = `${H}/.local/bin:${H}/.npm-global/bin:${H}/.nvm/versions/node/v22.22.2/bin:/opt/homebrew/bin:/usr/local/bin:${process.env.PATH || ''}`;
  const beforeWork = gitPaths(cwd);   // snapshot for truthful verification
  const r = spawnSync(command.bin, command.args, { encoding: 'utf8', maxBuffer: 1 << 26, timeout: 900000, cwd: command.cwd, env: { ...process.env, PATH: workerPath } });
  const out = `${r.stdout || ''}\n${r.stderr || ''}`.trim();
  writeFileSync(logf, out);
  const quota = /usage limit|rate.?limit|quota exceeded|credit balance is too low|insufficient credits?/i.test(out);
  // Infra gap (worker binary/host missing) ≠ task failure — defer, don't permanently block.
  const missingWorker = r.error?.code === 'ENOENT' || /ENOENT|command not found|cannot find the path|could not resolve hostname|uv trampoline|failed to spawn .*child process|connection refused|connection timed out/i.test(out);
  if (missingWorker) {
    setStatus(card.id, 'routed');
    sql(`UPDATE tasks SET result='${esc(`deferred: ${card.assignee} worker unavailable on this host (infra) — will retry`)}',updated_at=${now()} WHERE id='${esc(card.id)}';`);
    logEvent(card.id, 'deferred', `${card.assignee} worker unavailable`);
    console.log(`⏸ deferred ${card.id} — ${card.assignee} worker not reachable here (kept routed for retry).`);
    return 'deferred';
  }
  // Codex timed out (long task hit the 15-min cap) → fail over to Nemotron (NIM), which executes in-process.
  const timedOut = r.error?.code === 'ETIMEDOUT' || (r.signal === 'SIGTERM' && r.status === null);
  if (timedOut && card.assignee === 'codex') {
    markAgentStatus('codex', 'timeout');
    sql(`UPDATE tasks SET assignee='nemotron',model_tier='free',status='routed',result='${esc('deferred: codex timed out → failover to Nemotron (NIM)')}',rationale=coalesce(rationale,'') || ' ↪ codex timeout → Nemotron.',updated_at=${now()} WHERE id='${esc(card.id)}';`);
    logEvent(card.id, 'rerouted', 'codex timeout → nemotron');
    console.log(`↪ rerouted ${card.id} — Codex timed out, Nemotron (NIM) will take it.`);
    return process.env.BEE_PULL_NO_CHAIN === '1' ? 'rerouted' : pull();
  }
  const fatal = r.error || r.status !== 0 || !out || /invalid_request_error|traceback \(most recent|API call failed|HTTP [45]\d\d|RESOURCE_EXHAUSTED/i.test(out);
  const outcome = workerOutcome(out);
  const approvalPacket = String(card.source_key || '').startsWith('approval-prep:') && /BEE_APPROVAL_SUMMARY:\s*\S+/i.test(out) && /BEE_APPROVAL_EVIDENCE:\s*\S+/i.test(out);
  if (quota && card.assignee !== 'nemotron') {
    markAgentStatus(card.assignee, 'usage-limited');
    sql(`UPDATE tasks SET assignee='nemotron',model_tier='free',status='routed',result='${esc(`deferred: ${card.assignee} unavailable; reassigned to Nemotron`)}',rationale=coalesce(rationale,'') || ' ↪ ${esc(card.assignee)} unavailable → Nemotron.',updated_at=${now()} WHERE id='${esc(card.id)}';`);
    logEvent(card.id, 'rerouted', `${card.assignee} unavailable → nemotron`);
    console.log(`↪ rerouted ${card.id} — ${card.assignee} unavailable, Nemotron will take it.`);
    return process.env.BEE_PULL_NO_CHAIN === '1' ? 'rerouted' : pull();
  } else if (fatal || (outcome === 'blocked' && !approvalPacket)) {
    setStatus(card.id, 'blocked');
    const blocker = out.match(/BEE_BLOCKER:\s*(.+)/i)?.[1] || out.split('\n').find((l) => /error|block|required founder|no changes/i.test(l)) || r.error?.message || 'worker did not complete material work';
    sql(`UPDATE tasks SET result='${esc(blocker.slice(0, 900))}',updated_at=${now()} WHERE id='${esc(card.id)}';`);
    console.error(`✗ blocked ${card.id} — see ${logf}`);
    speak(`${card.assignee} hit a problem on ${card.title}. It needs you.`);
    return 'blocked';
  } else {
    const v = approvalPacket ? { ok: true, why: 'structured approval packet produced' } : verifyWork(out, cwd, beforeWork); // worker SAID done — verify it
    if (!v.ok) {                                   // claim unverifiable → don't lie; flag for review (anti-hallucination)
      setStatus(card.id, 'blocked');
      sql(`UPDATE tasks SET result='${esc(`UNVERIFIED — ${card.assignee} claimed done but ${v.why}. Flagged (truthfulness guard).`)}',updated_at=${now()} WHERE id='${esc(card.id)}';`);
      logEvent(card.id, 'unverified', v.why);
      console.error(`⚠ ${card.id}: claimed done but UNVERIFIED (${v.why}) — flagged for review, not marked done.`);
      speak(`${card.assignee} said it finished, but I couldn't verify it — I've flagged it rather than claim it's done.`);
      return 'unverified';
    }
    const tail = out.split('\n').filter(Boolean).slice(-8).join('\n');
    sql(`UPDATE tasks SET result='${esc(('✓ verified — ' + v.why + ' · ' + tail).slice(0, 900))}',updated_at=${now()} WHERE id='${esc(card.id)}';`);
    if (approvalPacket) finalizeApprovalPrep(card, out);
    setStatus(card.id, 'done'); logEvent(card.id, 'executed', `${card.assignee} · verified`);
    if (card.assignee === 'codex' || card.assignee === 'claude') markAgentStatus(card.assignee, 'available');
    speak(`Done and verified: ${card.title}`);
    console.log(`✅ done ${card.id} (${card.assignee}) — verified: ${v.why}`);
    return 'done';
  }
}

// ---------- DAEMON: always-on founder ingress (drop *.txt in ~/.bee/inbox → routed+dispatched+spoken) ----------
function daemonTick() {
  for (const f of readdirSync(INBOX_DIR).filter((n) => n.endsWith('.txt'))) {
    const p = join(INBOX_DIR, f);
    let text = ''; try { text = readFileSync(p, 'utf8').trim(); } catch { continue; }
    if (text) {
      speak(ack());                                   // instant ack — never leave the founder hanging while the brain thinks
      const id = create(text, { createdBy: 'founder-ingress', route: false });
      const d = routeOne(id);
      dispatch(id);
      speak(replyFor(d));                                  // always reply to a founder request
    }
    try { renameSync(p, join(INBOX_DIR, 'done', `${now()}-${f}`)); } catch {}
  }
  // Proactive pass: when autonomy is on, Bee dispatches any routed labs work on its own — ONCE each.
  // dispatch() refuses approval-wall / fund-exec items (can't cross the wall) and logs a 'dispatched'
  // event, so the NOT EXISTS guard stops it from re-appending the same card on every 3s tick.
  if (getAutonomy().proactive) {
    const pending = sql(`SELECT t.id FROM tasks t WHERE t.lane='labs' AND t.status='routed' AND t.needs_human=0
      AND NOT EXISTS (SELECT 1 FROM events e WHERE e.task_id=t.id AND e.kind='dispatched');`, { json: true });
    pending.forEach((r) => { try { dispatch(r.id); } catch {} });
  }
  tickBlueprints();   // fire any blueprint whose cadence is due (no-op unless proactive + something is due)
}
async function daemon() {
  speak('Bee online.');
  console.log(`[bee daemon] watching ${INBOX_DIR} — drop *.txt to route+dispatch. ${new Date(now()*1000).toISOString()}`);
  for (;;) { try { daemonTick(); } catch (e) { console.error('[bee daemon] tick error:', e.message); } await new Promise((r) => setTimeout(r, 3000)); }
}

// ---------- CAPABILITY REGISTRY (B1): Bee knows the agents, skills, tools, rails ----------
// `bee scan` indexes everything Bee can route to → ~/.bee/registry.json. The router consults it.
const REGISTRY = join(BEE_DIR, 'registry.json');
const WORKER_STATUS = join(BEE_DIR, 'worker-status.json');
function workerStatuses() { try { return JSON.parse(readFileSync(WORKER_STATUS, 'utf8')); } catch { return {}; } }
function markAgentStatus(name, status) {
  const overrides = workerStatuses();
  overrides[name] = { status, updated_at: now() };
  writeFileSync(WORKER_STATUS, JSON.stringify(overrides, null, 2));
  try {
    const reg = JSON.parse(readFileSync(REGISTRY, 'utf8'));
    const agent = reg.agents.find((item) => item.name === name);
    if (agent) { agent.status = status; writeFileSync(REGISTRY, JSON.stringify(reg, null, 2)); }
  } catch {}
}
function firstDesc(p) { try { const m = readFileSync(p, 'utf8').match(/description:\s*["']?(.+)/i); return m ? m[1].replace(/["']/g, '').slice(0, 90) : ''; } catch { return ''; } }
function scan() {
  const reg = { generated_at: now(), agents: [], skills: [], mcp: [], tools: [], rails: {} };
  // Agents + live-ish status (fund stays walled)
  const ollamaUp = (() => { try { execFileSync('curl', ['-s', '-m', '2', 'http://localhost:11434/api/tags'], { stdio: ['ignore', 'ignore', 'ignore'] }); return true; } catch { return false; } })();
  const toolPresent = (name) => { try { execFileSync('which', [name], { stdio: 'ignore' }); return true; } catch { return false; } };
  const overrides = workerStatuses();
  const agentStatus = (name, fallback = 'available') => process.env[`BEE_${name.toUpperCase().replace(/-/g, '_')}_STATUS`] || overrides[name]?.status || fallback;
  reg.agents = [
    { name: 'claude', role: 'judgment/design/publishing', status: agentStatus('claude', toolPresent('claude') ? 'available' : 'unavailable') },
    { name: 'codex', role: 'implementation', status: agentStatus('codex', toolPresent('codex') ? 'available' : 'unavailable') },
    { name: 'hermes-lenovo', role: 'research/render/distribution', status: 'available' },
    { name: 'nemotron', role: 'fast execution (NVIDIA, via Hermes)', status: agentStatus('nemotron') },
    { name: 'cua', role: 'screen/GUI control (Hermes computer_use)', status: 'available' },
    { name: 'local-gemma', role: 'triage/classify (gemma3:12b)', status: ollamaUp ? 'available' : 'ollama down' },
  ];
  // Hermes skills (bill-* tagged fund/walled — Bee may see, never autonomously use)
  const FUND_SKILL = /bill|quant|trading|\btrade|strateg|polymarket|prediction|macro|edge[- ]?detect|venue|oos[- ]|range[- ]?breakout|onchain|backtest|cross[- ]?venue/i;
  try {
    for (const d of readdirSync(join(homedir(), '.hermes/skills'), { withFileTypes: true })) {
      if (!d.isDirectory() || d.name.startsWith('.')) continue;          // skip hidden/backup dirs
      const lane = FUND_SKILL.test(d.name) ? 'fund(walled)' : 'labs';     // wall: trading/quant skills are fund, not just bill-*
      reg.skills.push({ source: 'hermes', name: d.name, lane, desc: firstDesc(join(homedir(), '.hermes/skills', d.name, 'SKILL.md')) });
    }
  } catch {}
  // Codex skills
  try { for (const d of readdirSync(join(homedir(), '.codex/skills'), { withFileTypes: true })) if (d.isDirectory() && !d.name.startsWith('.')) reg.skills.push({ source: 'codex', name: d.name, lane: FUND_SKILL.test(d.name) ? 'fund(walled)' : 'labs', desc: '' }); } catch {}
  // MCP servers wired into Codex
  try { const t = readFileSync(join(homedir(), '.codex/config.toml'), 'utf8'); for (const m of t.matchAll(/\[mcp_servers\.([^\]]+)\]/g)) reg.mcp.push({ host: 'codex', name: m[1] }); } catch {}
  // AgentPay harness — Bee's own product's organs (selective Tier-1: Sentinel guard + Feed are live in Bee; Gateway/data are known capabilities).
  reg.mcp.push(
    { host: 'agentpay', name: 'sentinel', role: 'payment pre-flight — 9 security checks before execute', wired: 'bee guard' },
    { host: 'agentpay', name: 'feed', role: 'real-time agentic newsfeed (tools/upgrades)', wired: 'bee feed / tool-watch' },
    { host: 'agentpay', name: 'gateway', role: '90+ tools across 42 servers, one key, per-call billing', wired: 'known (not auto-billed)' },
    { host: 'agentpay', name: 'finance-data', role: 'SEC EDGAR · crypto prices · FX', wired: 'known' },
    { host: 'agentpay', name: 'domain', role: 'WHOIS · DNS · SSL · IP geo', wired: 'known' },
  );
  // Key CLIs/tools present
  for (const t of ['codex', 'gh', 'stripe', 'hermes', 'ollama', 'ffmpeg', 'whisper-cli', 'wrangler', 'vercel', 'eas', 'node', 'screencapture', 'say']) {
    try { execFileSync('which', [t], { stdio: ['ignore', 'ignore', 'ignore'] }); reg.tools.push(t); } catch {}
  }
  // Money rails (the earn→spend loop)
  reg.rails = {
    spend: { provider: 'stripe-projects', controls: 'per-provider caps + dev/staging/prod isolation', bee_cap_daily: process.env.BEE_SPEND_CAP_DAILY || '20', note: 'Hermes is a native Stripe Projects agent platform' },
    earn: ['hermeshub (x402/MPP skill sales, 95% payout)', 'agentpay (x402 pay-per-call, FREE_LIMIT=50→paid)', 'app sales (stores)'],
    skills_marketplace: 'hermeshub.xyz — install: hermes skills install github:<owner>/<repo>/skills/<name>',
  };
  writeFileSync(REGISTRY, JSON.stringify(reg, null, 2));
  console.log(`🧭 registry → ${REGISTRY}`);
  caps();
}
function caps() {
  let reg; try { reg = JSON.parse(readFileSync(REGISTRY, 'utf8')); } catch { console.log('no registry — run `bee scan`'); return; }
  const labs = reg.skills.filter((s) => s.lane === 'labs'), fund = reg.skills.filter((s) => /fund/.test(s.lane));
  console.log(`\n🧭 BEE CAPABILITIES (scanned ${new Date(reg.generated_at * 1000).toISOString()})`);
  console.log(`\nAGENTS:`); reg.agents.forEach((a) => console.log(`  ${a.name.padEnd(14)} ${a.role}  [${a.status}]`));
  console.log(`\nSKILLS: ${labs.length} usable (labs) + ${fund.length} walled (fund) · MCP: ${reg.mcp.length} · TOOLS: ${reg.tools.length}`);
  console.log(`  usable e.g.: ${labs.slice(0, 12).map((s) => s.name).join(', ')}${labs.length > 12 ? ' …' : ''}`);
  console.log(`  tools: ${reg.tools.join(', ')}`);
  console.log(`\n💸 RAILS  spend: ${reg.rails.spend?.provider} (cap $${reg.rails.spend?.bee_cap_daily}/day, ${reg.rails.spend?.controls})`);
  console.log(`          earn: ${(reg.rails.earn || []).join(' · ')}`);
  console.log('');
}

// ---------- DOCTOR (production readiness — "shouldn't break"): verify every part, report ----------
function portUp(p) { try { execFileSync('bash', ['-c', `nc -z -G2 127.0.0.1 ${p}`], { stdio: 'ignore' }); return true; } catch { return false; } }
// Running jobs are healthy regardless of a previous exit code. Idle periodic jobs use last exit.
function serviceHealthy(line) {
  const [pid, lastExit] = String(line || '').trim().split(/\s+/);
  if (!pid || !lastExit) return false;
  return pid !== '-' || lastExit === '0' || lastExit === '-';
}
function svcUp(label) {
  try {
    const line = execFileSync('launchctl', ['list'], { encoding: 'utf8' }).split('\n').find((row) => row.trim().endsWith(label));
    return serviceHealthy(line);
  } catch { return false; }
}
function doctor() {
  const checks = [];
  const ok = (n, pass, detail = '') => checks.push({ n, pass, detail });
  ok('DB readable', (() => { try { sql('SELECT 1;'); return true; } catch { return false; } })(), DB);
  // self-heal the brain (ollama has no crash-supervisor) before judging it
  let brain = portUp(11434);
  if (!brain) { try { execFileSync('open', ['-a', 'Ollama']); execFileSync('bash', ['-c', 'sleep 5']); brain = portUp(11434); } catch {} }
  ok('brain (ollama gemma)', brain, brain ? BRAIN_MODEL : 'down — heal failed');
  ok('natural voice (Kokoro)', portUp(8790), 'Kokoro :8790');
  ok('voice upgrade optional', true, portUp(18765) ? 'VibeVoice :18765 reachable' : 'VibeVoice remote not connected');
  ok('Voicebox optional', true, portUp(17493) ? 'Voicebox :17493 reachable' : 'off by default');
  ok('daemon service', svcUp('com.agentpay.bee.daemon'));
  ok('pull service', svcUp('com.agentpay.bee.pull'));
  ok('tts service', svcUp('com.agentpay.bee.tts'));
  ok('Clickey desk service', svcUp('com.agentpay.bee.desk'));
  ok('mandate signing key', (() => { try { return mandateKey().length >= 32; } catch { return false; } })(), MANDATE_KEY_FILE);
  ok('registry present', existsSync(REGISTRY));
  ok('voice helper', existsSync(SAY_SH));
  let reg = {}; try { reg = JSON.parse(readFileSync(REGISTRY, 'utf8')); } catch {}
  const fundLeak = (reg.skills || []).filter((s) => s.lane === 'labs' && /bill|quant|trad|polymarket|hedge|futures/i.test(s.name));
  ok('wall intact (no fund leak)', fundLeak.length === 0, fundLeak.map((s) => s.name).join(',') || 'clean');
  console.log('\n🩺 BEE DOCTOR');
  let fails = 0;
  for (const c of checks) { console.log(`  ${c.pass ? '✅' : '❌'} ${c.n.padEnd(26)} ${c.detail || ''}`); if (!c.pass) fails++; }
  console.log(fails ? `\n⚠️  ${fails} issue(s) — not live-ready.\n` : `\n✅ all green — Bee is healthy.\n`);
  return fails === 0;
}

// ---------- SCREEN-ACT: Bee sees the UI (macOS Accessibility), points, and acts (fill/click) ----------
const AX_SNAPSHOT = `tell application "System Events"
  set proc to first application process whose frontmost is true
  set out to (name of proc) & "\n"
  tell proc
    try
      repeat with e in (entire contents of front window)
        try
          set r to (role of e) as text
          if r is in {"AXButton","AXTextField","AXTextArea","AXCheckBox","AXPopUpButton","AXMenuButton","AXRadioButton"} then
            set nm to ""
            try
              set nm to (name of e) as text
            end try
            if nm is missing value then set nm to ""
            set p to position of e
            set s to size of e
            set out to out & r & "|" & nm & "|" & (item 1 of p) & "|" & (item 2 of p) & "|" & (item 1 of s) & "|" & (item 2 of s) & "\n"
          end if
        end try
      end repeat
    end try
  end tell
  return out
end tell`;
function axSnapshot() {
  let raw = ''; try { raw = execFileSync('osascript', ['-e', AX_SNAPSHOT], { encoding: 'utf8', timeout: 15000 }); } catch { return { app: '', els: [] }; }
  const lines = raw.split('\n'); const app = (lines.shift() || '').trim();
  const els = lines.map((l) => { const [role, name, x, y, w, h] = l.split('|'); return { role, name: (name || '').trim(), x: +x, y: +y, w: +w, h: +h }; }).filter((e) => e.role && !isNaN(e.x));
  return { app, els };
}
function pointAt(x, y, label, secs = 4) { try { writeFileSync(join(BEE_DIR, 'pointer.json'), JSON.stringify({ x: Math.round(x), y: Math.round(y), label: label || '', until: now() + secs })); } catch {} }
// RIDE mode: the butterfly leaves its perch and rides the live cursor — Bee "owns" the screen while it acts.
let riding = false;
function rideOn(label, secs = 30) { riding = true; try { writeFileSync(join(BEE_DIR, 'pointer.json'), JSON.stringify({ ride: true, label: label || '', until: now() + secs })); } catch {} }
function rideOff() { riding = false; try { writeFileSync(join(BEE_DIR, 'pointer.json'), JSON.stringify({ until: 0 })); } catch {} }
function clickEl(e, label) { const cx = e.x + e.w / 2, cy = e.y + e.h / 2; if (!riding) pointAt(cx, cy, label || e.name || 'click'); try { execFileSync('cliclick', [`c:${Math.round(cx)},${Math.round(cy)}`]); return true; } catch { return false; } }
function screen() {
  const { app, els } = axSnapshot();
  console.log(`👁  frontmost: ${app || '(none)'} — ${els.length} actionable elements`);
  els.forEach((e, i) => console.log(`  [${i}] ${e.role.replace('AX', '').padEnd(11)} ${(e.name || '(unnamed)').slice(0, 32).padEnd(32)} @${e.x},${e.y}`));
  return { app, els };
}
function beeClick(target) {
  const { els } = axSnapshot();
  const e = /^\d+$/.test(target) ? els[+target] : els.find((x) => x.name && x.name.toLowerCase().includes(target.toLowerCase()));
  if (!e) { console.error(`no element matching "${target}"`); return false; }
  console.log(`👉 click "${e.name || e.role}" @${e.x},${e.y}`); speak(`Clicking ${e.name || 'it'}.`); return clickEl(e, e.name);
}
function beeFill(hint, value) {
  const { els } = axSnapshot(); const fields = els.filter((e) => /TextField|TextArea/.test(e.role));
  const e = (hint && fields.find((x) => x.name && x.name.toLowerCase().includes(hint.toLowerCase()))) || fields[/^\d+$/.test(hint) ? +hint : 0];
  if (!e) { console.error('no text field found'); return false; }
  clickEl(e, e.name || hint); execFileSync('bash', ['-c', 'sleep 0.3']);
  try { execFileSync('cliclick', [`t:${value}`]); console.log(`⌨️  filled "${e.name || hint}" = ${value}`); speak(`Filled ${e.name || 'that field'}.`); return true; } catch { return false; }
}
const ACT_UNSAFE_RE = /\b(delete|remove|erase|uninstall|quit|purchase|buy|pay|checkout|place order|send|publish|post|upload|transfer|withdraw|deposit|trade|sell|sign[- ]?in|log[- ]?in|oauth|password|secret|token|api key|2fa)\b/i;
const ACT_STEP_FORBIDDEN_RE = /\b(delete|remove|erase|uninstall|quit|purchase|buy|pay|checkout|place order|transfer|withdraw|deposit|trade|sell|sign[- ]?in|log[- ]?in|oauth|password|secret|token|api key|2fa|otp|permission|sharing)\b/i;
const ACT_MAX_STEPS = Math.max(1, Math.min(12, Number(process.env.BEE_ACT_MAX_STEPS) || 8));

function parseObject(text) {
  const match = String(text || '').match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]); } catch { return null; }
}

function actStep(goal, app, els, history, approved = false) {
  const menu = els.map((e, i) => `${i}:${e.role.replace('AX', '')}:${e.name || '(unnamed)'}`).join('\n');
  const approvalRule = approved
    ? 'The founder freshly approved this exact goal. You may submit, publish, post, upload, or send only as needed for that goal. '
    : 'This action has no external-side-effect approval. ';
  const sys = 'You drive a macOS GUI through Accessibility. Choose exactly ONE next action from the current FRONT WINDOW. '
    + 'Output ONLY JSON: {"done":bool,"action":"click|fill|type","index":<element index>,"value":"<text>","say":"<<=8 words>"}. '
    + `Set done=true when the goal is complete or no safe action exists. Use only a current index. ${approvalRule}`
    + 'Never delete, quit, buy, pay, authenticate, change permissions, reveal credentials, or perform financial actions.';
  return parseObject(brain(`App: ${app}\nGoal: ${goal}\nCompleted: ${history.join('; ') || '(none)'}\nCurrent elements:\n${menu}`, { sys }));
}

// `bee act "<goal>"` — observe, take one safe action, then observe again.
function act(goal, { approved = false } = {}) {
  const dry = process.env.BEE_ACT_DRY === '1';
  if (!goal.trim()) { console.error('usage: bee act "<goal>"'); return false; }
  if (ACT_UNSAFE_RE.test(goal) && !approved) {
    const staged = stageAction(goal);
    if (staged) speak('I prepared that action and put it on your approval wall.');
    return false;
  }
  if (approved && ACT_STEP_FORBIDDEN_RE.test(goal)) { console.error('blocked: this action still requires direct founder control'); return false; }
  speak(ack());
  const history = [];
  rideOn('On it.');
  try {
    for (let i = 0; i < ACT_MAX_STEPS; i++) {
      const { app, els } = axSnapshot();
      if (!els.length) { console.log('stopped: no actionable controls visible'); return false; }
      const step = actStep(goal, app, els, history, approved);
      if (!step) { console.log('stopped: planner returned invalid JSON'); return false; }
      if (step.done) { console.log(`✅ goal complete after ${history.length} step(s)`); speak('Done.'); return true; }
      if (!['click', 'fill', 'type'].includes(step.action) || !Number.isInteger(step.index) || !els[step.index]) {
        console.log('stopped: planner selected an invalid current control'); return false;
      }
      const el = els[step.index];
      const actionText = `${step.action} ${el.name || ''} ${step.value || ''}`;
      if (ACT_STEP_FORBIDDEN_RE.test(actionText) || (!approved && ACT_UNSAFE_RE.test(actionText))) { console.log(`blocked unsafe step: ${actionText}`); return false; }
      console.log(`  ${i + 1}. ${step.action} [${step.index}] ${el.name || el.role}${step.value ? ' = ' + step.value : ''}`);
      if (dry) { console.log('(BEE_ACT_DRY — first action planned, not executed)'); return true; }
      if (step.say) { speak(step.say); rideOn(step.say); }
      let ok = false;
      if (step.action === 'click') ok = clickEl(el, el.name);
      else {
        ok = clickEl(el, el.name);
        if (ok) { execFileSync('bash', ['-c', 'sleep 0.3']); try { execFileSync('cliclick', [`t:${step.value || ''}`]); } catch { ok = false; } }
      }
      if (!ok) { console.log(`stopped: ${step.action} failed`); return false; }
      history.push(`${step.action} ${el.name || el.role}`);
      execFileSync('bash', ['-c', 'sleep 1']);
    }
    console.log(`stopped: ${ACT_MAX_STEPS}-step safety limit reached`);
    speak('I paused at the safety limit.');
    return false;
  } finally { rideOff(); }
}

// ---------- CLI ----------
async function main() {
  init();
  const [cmd, ...rest] = process.argv.slice(2);
  const arg = rest.join(' ');
  switch (cmd) {
  case undefined:
  case 'dash': dashboard(); break;
  case 'state': console.log(JSON.stringify(stateJSON())); break;   // JSON snapshot for the desktop dashboard
  case 'autonomy': {
    const v = (rest[0] || 'status').toLowerCase();
    if (v === 'on' || v === 'start' || v === 'go') { setAutonomy(true); console.log('🟢 proactive mode ON — Bee acts on its own.'); speak("Proactive mode on. I'll keep things moving."); }
    else if (v === 'off' || v === 'stop' || v === 'pause') { setAutonomy(false); console.log('⏸  proactive mode OFF — Bee waits for your word.'); speak("Okay — I'll hold and wait for you."); }
    else console.log(`autonomy: ${getAutonomy().proactive ? 'proactive (on)' : 'paused (off)'}`);
    break; }
  case 'blueprints': BLUEPRINTS.forEach((b) => console.log(`  ${b.key.padEnd(16)} ${b.name}  ·  ${b.cadence}\n      ${b.desc}`)); break;
  case 'run': runBlueprint(rest[0]); break;
  case 'agency': agencyAsk(arg); break;             // Bee → Agency OS ingress (writes its INBOX)
  case 'agents': agents(); break;
  case 'guard': {                                       // pre-flight a payment (Sentinel's 9 checks, native)
    const amount = parseFloat(rest[0]); const merchant = rest[1] || '';
    if (isNaN(amount)) { console.error('usage: bee guard <amount> <merchant> [intent...]'); break; }
    const g = guard(amount, merchant, { intent: rest.slice(2).join(' ') || undefined });
    console.log(`\n🛡  GUARD ${g.pass ? '✅ PASS' : '⛔ BLOCKED'} — $${amount} → ${merchant || '(merchant?)'}`);
    g.checks.forEach((c) => console.log(`   ${c.pass ? '✓' : '✗'} ${c.name.padEnd(15)} ${c.detail}`));
    console.log(g.pass ? '\n   ✅ safe to stage — execution still goes through the founder wall (Bee never auto-pays).' : `\n   ⛔ blocked by: ${g.blocker}`);
    speak(g.pass ? 'Cleared the guard. Staging for your approval.' : `Blocked — ${g.blocker}.`);
    remember(`guard ${g.pass ? 'PASS' : 'BLOCK'}: $${amount}→${merchant || '?'}${g.pass ? '' : ' (' + g.blocker + ')'}`, 'guard');
    break; }
  case 'mandate': {                                     // issue a payment mandate (guarded, proposed, on the wall)
    const amount = parseFloat(rest[0]); const merchant = rest[1] || '';
    if (isNaN(amount) || !merchant) { console.error('usage: bee mandate <amount> <merchant> [intent...] [--rail casper|cspr|x402|usdc|usdt|stripe|coinbase|coinbase-commerce|fireblocks|bitgo|turnkey|privy|sequence] [--sandbox]'); break; }
    const railIdx = rest.indexOf('--rail'); const rail = railIdx > -1 ? rest[railIdx + 1] : undefined;
    const words = []; for (let i = 2; i < rest.length; i++) { if (rest[i] === '--rail') { i++; continue; } if (rest[i] !== '--sandbox') words.push(rest[i]); }
    issueMandate(amount, merchant, words.join(' ') || undefined, { rail, mode: rest.includes('--sandbox') ? 'sandbox' : 'live' });
    break; }
  case 'provider-adapters': walletProviderStatus(); break;
  case 'mandates': mandates(); break;
  case 'approve': { const methodAt = rest.indexOf('--method'); approveMandate(rest[0], methodAt > -1 ? rest[methodAt + 1] : 'cli'); break; }
  case 'reject': rejectMandate(rest[0]); break;
  case 'actions': actions(); break;
  case 'approve-action': { const methodAt = rest.indexOf('--method'); approveAction(rest[0], methodAt > -1 ? rest[methodAt + 1] : 'cli'); break; }
  case 'reject-action': rejectAction(rest[0]); break;
  case 'execute-action': executeAction(rest[0]); break;
  case 'prepare-approval': {
    const refresh = rest.includes('--refresh');
    const ids = rest[0] === 'all'
      ? sql(`SELECT id FROM tasks WHERE lane='labs' AND needs_human=1 AND status!='done' AND approval_ready=0;`, { json: true }).map((row) => row.id)
      : [rest[0]].filter(Boolean);
    if (refresh) ids.forEach((id) => sql(`UPDATE tasks SET approval_ready=0,approval_packet=NULL,result=NULL,updated_at=${now()} WHERE id='${esc(id)}';`));
    const queued = ids.map(queueApprovalPrep).filter(Boolean); console.log(`prepared queue: ${queued.length}/${ids.length}`); break; }
  case 'ready-approval': {
    const flag = (name) => { const i = rest.indexOf(name); return i > -1 ? rest[i + 1] || '' : ''; };
    markApprovalReady(rest[0], { summary: flag('--summary'), evidence: flag('--evidence'), url: flag('--url'), preparedBy: flag('--by') || 'bee' }); break; }
  case 'decline': declineTask(rest[0]); break;
  case 'defer-approval': deferApproval(rest[0], rest.slice(1).join(' ')); break;
  case 'supersede': supersedeTask(rest[0], rest.slice(1).join(' ')); break;
  case 'ask': askGesture(rest[0]); break;               // prompt a ✓/✗ mouse-gesture decision
  case 'settle': settleMandate(rest[0], rest.includes('--execute')); break;
  case 'confirm-settlement': confirmSettlement(rest[0], rest.slice(1).join(' ')); break;
  case 'fly': { const x = parseInt(rest[0], 10), y = parseInt(rest[1], 10); if (isNaN(x) || isNaN(y)) { console.error('usage: bee fly <x> <y> [stage] [say…]'); break; } butterfly(rest[2] || 'flight', x, y, rest.slice(3).join(' ') || undefined); console.log(`🦋 flying to ${x},${y} as ${rest[2] || 'flight'}`); break; }
  case 'demo': demo(); break;
  case 'introduce': case 'intro': case 'pitch': introduce(); break;
  case 'decide': { const act = rest.includes('--act'); decide(rest.filter((r) => r !== '--act').join(' '), act); break; }
  case 'feed': feed(); break;
  case 'feed-json': console.log(JSON.stringify(feedJSON(parseInt(rest[0], 10) || 8))); break;
  case 'remember': remember(arg, 'note'); console.log('🧠 remembered → vault'); if (!process.env.BEE_SILENT) speak('Noted.'); break;
  case 'memory': console.log(memory(parseInt(rest[0], 10) || 20)); break;
  case 'schedule': {
    const fmt = (s) => !s ? '—' : new Date(s * 1000).toISOString().replace('T', ' ').slice(0, 16);
    console.log(`schedule (proactive ${getAutonomy().proactive ? 'ON' : 'OFF'}):`);
    BLUEPRINTS.forEach((b) => { const t = blueprintTiming(b);
      console.log(`  ${b.key.padEnd(16)} ${b.cadence.padEnd(11)} last: ${fmt(t.last).padEnd(16)} ${t.continuous ? '(always-on)' : 'next: ' + fmt(t.nextDue)}`); });
    break; }
  case 'help': console.log('bee "<request>" | dash board list approvals state | dispatch [id|all] | pull | scan caps doctor\n  AUTONOMY: autonomy on|off|status | blueprints | run <blueprint> | schedule | worker-status <name> <status>\n  KNOW: agents (team+harness) | decide "<goal>" [--act] (OODA) | feed | remember <text> | memory\n  APPROVE: prepare-approval <id|all> | actions | act "<external goal>" | ask <id> | approve-action|reject-action <id> | decline <task-id>\n  PAY: guard <amt> <merchant> | mandate <amt> <merchant> [intent] [--rail casper|x402|stripe|coinbase|coinbase-commerce|fireblocks|bitgo|turnkey|privy|sequence] | provider-adapters | mandates | approve|reject <id> | settle <id> [--execute sandbox] | confirm-settlement <id> <receipt>\n  SHOW: demo (end-to-end push) | fly <x> <y> [stage] (move the butterfly anywhere)\n  LANES: agency "<req>" (-> Codex Agency OS INBOX) · fund view read-only\n  SCREEN: screen | act "<goal>" | click <name|#> | fill <hint> <value> | type <text> | point <x> <y> [label] | see [q]\n  VOICE: speak <text> | listen | converse (bidirectional) | daemon · route/start/done/block <id>\n  SETUP: install (one-command, ~3 min)'); break;
  case 'list': list(); break;
  case 'board': board(); break;
  case 'approvals': approvals(); break;
  case 'route': routeOne(rest[0]); break;
  case 'dispatch': rest[0] && rest[0] !== 'all' ? dispatch(rest[0]) : dispatchAll(); break;
  case 'create': {
    const byIdx = rest.indexOf('--by');
    const createdBy = byIdx > -1 ? (rest[byIdx + 1] || 'mcp') : 'bee';
    const words = byIdx > -1 ? rest.filter((_, i) => i !== byIdx && i !== byIdx + 1) : rest;
    const text = words.join(' ').trim();
    if (!text) { console.error('usage: bee create "<request>" [--by mcp|codex|claude|hermes]'); break; }
    const id = create(text, { createdBy, route: false });
    const d = routeOne(id);
    dispatch(id);
    if (!process.env.BEE_SILENT) speak(replyFor(d));
    console.log(JSON.stringify({ id, route: d || null }));
    break; }
  case 'pull': pull(); break;
  case 'scan': scan(); break;
  case 'caps': caps(); break;
  case 'worker-status': {
    const name = rest[0], status = rest.slice(1).join(' ');
    if (!name || !status) { console.error('usage: bee worker-status <name> <status>'); break; }
    markAgentStatus(name, status); console.log(`${name} → ${status}`); break; }
  case 'doctor': process.exitCode = doctor() ? 0 : 1; break;
  case 'serve': await serve(+arg || undefined); await new Promise(() => {}); break;   // earn mode — stays up
  case 'earnings': earningsReport(); break;
  case 'specialists': specialists(); break;
  case 'point': {                                       // Clicky points at a screen coordinate. bee point <x> <y> [label] [seconds]
    const x = parseInt(rest[0], 10), y = parseInt(rest[1], 10);
    const secs = parseInt(rest[rest.length - 1], 10); const hasSecs = !isNaN(secs) && rest.length > 3;
    const label = rest.slice(2, hasSecs ? -1 : undefined).join(' ');
    if (isNaN(x) || isNaN(y)) { console.error('usage: bee point <x> <y> [label] [seconds]'); break; }
    writeFileSync(join(BEE_DIR, 'pointer.json'), JSON.stringify({ x, y, label, until: now() + (hasSecs ? secs : 6) }));
    console.log(`👉 pointing at ${x},${y}${label ? ' — ' + label : ''}`); break; }
  case 'unpoint': writeFileSync(join(BEE_DIR, 'pointer.json'), JSON.stringify({ until: 0 })); console.log('pointer cleared'); break;
  case 'screen': screen(); break;
  case 'click': beeClick(arg); break;
  case 'fill': beeFill(rest[0], rest.slice(1).join(' ')); break;
  case 'type': try { execFileSync('cliclick', [`t:${arg}`]); console.log('typed'); } catch { console.error('cliclick failed'); } break;
  case 'act': act(arg); break;
  case 'install': try { execFileSync('bash', [new URL('install.sh', import.meta.url).pathname], { stdio: 'inherit' }); } catch (e) { console.error('install failed:', e.message.split('\n')[0]); } break;
  case 'converse': await converse(); break;
  case 'persona': case 'mood': {
    const a = (rest[0] || 'show').toLowerCase(); const names = Object.keys(PERSONAS);
    if (a === 'list') { names.forEach((n) => console.log(`  ${n.padEnd(11)} ${PERSONAS[n].blurb}${n === activePersonaName() ? '   ← active' : ''}`)); break; }
    if (a === 'show') { console.log(`🎭 persona: ${activePersonaName()} — ${activePersona().blurb}`); break; }
    const name = a === 'random' ? pick(names.filter((n) => n !== activePersonaName())) : a;
    if (!setPersonaActive(name)) { console.error(`unknown persona "${name}". try: ${names.join(', ')} | list | random`); break; }
    console.log(`🎭 persona → ${name} (${activePersona().blurb})`);
    remember(`persona switched to ${name}`, 'persona');
    speak(`${pick(activePersona().acks)} ${name} mode.`);   // greet in the new voice + mood
    break; }
  case 'speak': speak(arg); break;
  case 'see': see(arg || undefined); break;
  case 'daemon': await daemon(); break;
  case 'listen': {
    const t = transcribe();
    if (!t) { speak("I didn't catch that — say it again."); console.log('(no speech / mic not granted)'); break; }
    console.log(`heard: "${t}"`); speak(ack());
    const id = create(t, { createdBy: 'voice', route: false }); const d = routeOne(id); dispatch(id);
    speak(replyFor(d));
    break; }
  case 'start': setStatus(rest[0], 'in_progress', rest.slice(1).join(' ')); break;
  case 'done': setStatus(rest[0], 'done', rest.slice(1).join(' ')); break;
  case 'block': setStatus(rest[0], 'blocked', rest.slice(1).join(' ')); break;
  default: {
    const text = cmd === 'add' ? arg : [cmd, ...rest].join(' ');
    if (/\b(introduce|introduce yourself|show me what you (can )?do|show your(self| work)|pitch yourself|who are you|demo yourself|present yourself)\b/i.test(text)) { introduce(); break; }  // "Bee, introduce yourself" → the self-demo
    const id = create(text, { route: false }); const d = routeOne(id); dispatch(id); if (!process.env.BEE_SILENT) speak(replyFor(d)); // `bee "..."` → create+route+dispatch+reply
  }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();

export { actStep, approvalPacketFromOutput, canMandateTransition, classify, isApprovableAction, mandatePayload, ruleClassify, safetyFloor, serviceHealthy, settlementPayload, signApprovalWithKey, signMandateWithKey, verifyApprovalWithKey, verifyMandateWithKey, walletAdapterReady, walletReceiptLooksValid, workerCommand, workerOutcome };
