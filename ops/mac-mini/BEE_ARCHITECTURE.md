# Bee — Always-On Orchestrator Persona for the AgentPay Fleet

> Spec date: 2026-06-15 · Owner: Rajiv (founder) · Author: Claude
> Status: **IMPLEMENTED BASELINE (v3) — reliability and connector work active**
> v1 led with a local model + voice persona. **v2 corrects that:** the orchestrator
> already exists and is broken; the persona is the face, not the fix.

---

## 0. The bottleneck (evidence-based, not assumed)

The blocker is **not** local-model intelligence and **not** a missing orchestrator.
Live recon (2026-06-15) found:

1. **The orchestrator already exists — and it's down.** Hermes runs a full **Kanban
   swarm**: `~/.hermes/kanban.db` (tasks done=86, pending=4, blocked=2), a dispatcher
   (`dispatch_in_gateway: true`, every 60s), `kanban_specify/decompose/swarm`, and
   `kanban-orchestrator`/`kanban-worker` skills (v3.0.0, "decompose don't execute",
   human-in-the-loop). **The dispatcher tick currently FAILS** on board `default` —
   SQLite WAL connect error at `kanban_db.py:1440 apply_wal_with_fallback` (matches the
   existing `kanban-db-corruption-defense` note). So the spine that should auto-route
   work is dead; pending cards sit forever. Footgun: cards assigned to an unknown
   profile name silently never spawn.

2. **Orchestration is fragmented across 5 systems** with no shared source of truth:
   - Hermes Kanban swarm (the real one, broken)
   - Codex goals/automations (`thread_goals` + `~/.codex/automations/` + process_manager)
   - n8n (only 2 of 19 workflows active)
   - Temporal (running, `default` ns, 24h retention — used by Postiz only)
   - file-based INBOX/OUTBOX Agency OS mesh + bridge `:8788`
   Agents burn cycles reconciling state instead of executing.

3. **The revenue wall is human-auth, not compute.** Every first-£ blocker in the LEDGER
   is an OAuth grant / account login / store-console action only Rajiv can do
   (YouTube/TikTok/FB-IG OAuth, npm login, ASC session, Play drag-drops, `mcpize login`).
   Agents have *staged* everything; nothing converts because the approvals are scattered.

4. **Infra fragility tax** (Postiz/colima/n8n deaths) — largely fixed via watchdog 2026-06-15.

**So "clear the bottleneck" = consolidate to ONE working spine + collapse the human-auth
wall into one click-through. Adding a 6th layer (voice persona) on top of 5 broken ones
makes it worse.**

### ⚠️ WALL CONSTRAINT (discovered 2026-06-15) — the existing kanban is a FUND board
The Hermes kanban spine cannot be adopted/repaired by Labs as-is: its task population is
**hedge-dominated**. Pending/blocked cards are "activate 7 paused Bill workflows", "refresh
TopstepX realtime proof", "futures demo gap analysis", "backtests against ES 20yr data",
"Bill-specific Hermes skills for futures" (13 of N tasks are bill/hedge/futures/topstep).
The DB has **no board column** (single implicit board) but **does have a `tenant` column**.
Fixing/re-enabling that dispatcher = scheduling fund execution → **forbidden by FLEET.md §4**.
**Therefore Bee's Labs spine must be a SEPARATE board/tenant, leaving Hermes' hedge kanban
entirely untouched.** Claude does not repair the fund-lane dispatcher; that's Hermes/Codex-Bill's.

---

## 1. What Bee is (two-lane control plane — founder-authorized 2026-06-15)

Bee is the **founder's unified control plane over BOTH lanes** (Labs + Fund) — a thin
persona + control face on one task spine, not a new engine. You talk to Bee (text now,
voice later); it turns intent into routed work, surfaces one approval wall, and gives one
dashboard across both lanes. Free to run; intelligence is *routed*, never a new bill.

**Lane autonomy is asymmetric (the safety model):**
- **Labs lane** — Bee routes + (next phase) workers act; outward actions (publish/OAuth/money) approval-gated.
- **Fund lane** — Bee may VIEW fund status (read-only, operational only — health/freshness,
  not positions/strategy/PnL), STAGE fund actions to the approval wall, and autonomously run
  **read-only fund research/analysis/backtests (no money)**. 
- **HARD LINE (never crossed, regardless of instruction):** Bee never autonomously executes a
  trade, places an order, moves money, activates live, or changes bankroll. Those are founder-only,
  always staged to the approval wall. Enforced in code (`FUND_EXEC_RE` → forced `needs_human`).

> Governance note: this founder-authorized Bee exception is recorded in FLEET.md §4.
> General Labs automation (Codex/n8n/Hermes jobs) stays walled from the fund.

---

## 2. The spine (the better architecture)

**One founder surface = Bee.** Bee owns ingress, routing policy, approval state, and the founder-facing
dashboard. Hermes Kanban, Codex, Claude, n8n, and other runtimes are workers behind that surface; they
do not compete as separate founder front doors. Bee currently persists its board in
`~/.bee/labs-board.db`, with a structured Bee MCP connector planned as the durable worker protocol.

```
            ┌────────────────────────────────────────────┐
  YOU ──▶   │  BEE  (ingress + voice + approval surface)  │
            └───────────────┬────────────────────────────┘
                            │ creates / decomposes
                            ▼
                 ┌──────────────────────┐
                 │    BEE BOARD (one)     │  ← founder-facing source of truth
                 │ ~/.bee/labs-board.db   │
                 └──────────┬────────────┘
            router (cost ladder) assigns each card ▼
   ┌─────────┬──────────────┬───────────────┬──────────────┬───────────┐
   ▼         ▼              ▼               ▼              ▼           ▼
 native   local Gemma   free gateways    Codex          Claude     Hermes-Lenovo
 tools    (triage)      (sweeps, $0)     (bounded impl)  (judgment) (research/render)
                                                          │
                                                          ▼
                                              HUMAN approval queue (Rajiv)
```

### Router = difficulty-classified cost ladder (your refined rule, 2026-06-15)
**Cheap by default, heavy-when-needed gets PRIORITY — not naive cheapest-first.** The router
first classifies each card's difficulty/stakes, then routes: trivial→cheapest rung; genuinely
hard or high-stakes (architecture, launch, revenue, customer-facing, complex code) → routed
**straight to the heavy model** (Claude Opus / gpt-5.5), skipping the cheap rungs so we don't
burn cycles failing cheap first. Classification, not frustration, drives escalation.
Each card carries a capability + difficulty + risk tag; the router picks accordingly:
0. **Native tools** (repo/scripts/tests) — $0
1. **Local Gemma 4 12B** — triage/extract/summarize/route-shaping — $0 on-device
2. **Free gateways** — Hermes OpenRouter `:free` + FreeLLMAPI (11 providers, ~1B tok/mo) — $0
3. **Paid subscriptions** — Claude ×2 (judgment/frontier), Codex ×3 (bounded impl), Gemini — $0 marginal
4. **Metered API** — last resort, explicit approval
Escalation is task-class driven, never frustration-driven.

### Workers (who pulls cards)
- **Claude** — frontier judgment, design, publishing, cofounder ops
- **Codex** — bounded implementation batches (issues, not vision)
- **Hermes (Lenovo)** — research, render/shorts, distribution (`ssh lenovo`)
- **Free gateways / local Gemma** — sweeps, summaries, monitoring, triage

---

## 3. The human-auth wall = Bee's highest-leverage feature

The thing that actually unlocks revenue. Bee consolidates the scattered "BLOCKED ON RAJIV"
items into **one approval surface**: each is staged to one-click, with the exact single
action named, so Rajiv clears the whole wall in one ~5-minute session instead of hunting
the LEDGER. (OAuth grants, npm login, ASC session, Play drags, `mcpize login`, Stripe key.)

---

## 4. Persona layer (the face — Phase 2, after the spine works)

- **Local brain:** ONE model — current runtime default **`gemma3:12b`**. Keep only embeddings
  that are actively used; hosted/free workers remain the escalation path. Model count is not the moat.
- **Voice persona:** **PersonaPlex-7B via MLX** (`mu-hashmi/personaplex-mlx`), full-duplex,
  ~5.3GB 4-bit, always-on capable. License CC BY-NC = internal use only.
- **16GB budget:** pin only PersonaPlex; load Gemma on demand; heavy thinking → cloud.
  Never pin a 24B/32B (would swap, stall Bill).

---

## 5. Build phases (corrected priority)

**Phase 0 — clear the bottleneck (highest leverage):**
- Fix the Kanban dispatcher WAL/connect bug (`kanban_db.py:1440`); verify tick green on `default`.
- Designate Kanban as the one spine; register worker profile names so cards don't sit unassigned.
- Wire the §2 cost-router so cards auto-route cheapest-capable.
- Build the consolidated **human-approval surface** (collapse "BLOCKED ON RAJIV" to one click-through).

**Phase 1 — consolidate:** fold Codex automations + INBOX/OUTBOX mesh into Kanban cards;
keep n8n for deterministic recurring pipelines, Temporal for durable long-runs; one board to watch.

**Phase 2 — persona:** local model swap (Gemma 4 12B) + PersonaPlex voice face on the working spine;
rename `open-jarvis` ingress → `bee`; always-on launchd; health in stack monitor.

Each phase leaves one artifact and is reviewed before the next. Bill lane untouched throughout.

---

## 6. Open decisions for founder
- Approve **Kanban swarm as the single spine** (vs building new on Temporal/n8n).
- Approve **Phase 0 first** (fix + consolidate) over Phase 2 (voice persona) first.
- Confirm Gemma 4 12B as the local brain; PersonaPlex internal-use; computer-use approval-gated initially.
