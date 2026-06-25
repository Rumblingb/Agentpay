# Bee — unified two-lane control plane (Labs + Fund)

The founder's single control surface over **both** AgentPay Labs and the Fund — separate
from Hermes' own kanban. Spec: [../BEE_ARCHITECTURE.md](../BEE_ARCHITECTURE.md).

## Use

```bash
ops/mac-mini/bin/bee                                        # the unified two-lane DASHBOARD
ops/mac-mini/bin/bee "design the dashboard pricing page"   # create → route → dispatch to the agent
ops/mac-mini/bin/bee dash | board | approvals               # dashboard / board / human-action wall
ops/mac-mini/bin/bee dispatch [<id>|all]                    # push routed cards to agent inboxes
ops/mac-mini/bin/bee speak "..."                            # Bee talks (Voicebox, Kokoro fallback)
ops/mac-mini/bin/bee listen                                 # push-to-talk: speak → whisper → route
ops/mac-mini/bin/bee route|start|done|block <id>            # lifecycle
```

## Always-on (the cofounder you talk to)

`com.agentpay.bee.daemon` (launchd, KeepAlive) runs `bee daemon` 24/7. `com.agentpay.bee.desk`
keeps Clickey's butterfly, dashboard, and approval overlay alive after login. The daemon watches
`~/.bee/inbox/*.txt` — drop a request from anywhere (voice, Discord bridge, a script) and Bee
**routes + dispatches + speaks** the confirmation, then files the request under `inbox/done/`.

- **Speak to Bee:** `bee listen` (push-to-talk). Needs one-time Microphone grant for the terminal/node
  in System Settings → Privacy → Microphone. STT = `whisper-cli` + `~/.bee/models/ggml-base.en.bin`.
- **Bee speaks back:** **Voicebox + Qwen CustomVoice 0.6B** through MLX on `:17493`, with a dedicated `Bee` profile and natural delivery instructions. Warm Kokoro on `:8790`, then macOS `say`, remain automatic fallbacks. Override the profile, engine, size, or delivery with `BEE_VOICEBOX_PROFILE`, `BEE_VOICEBOX_ENGINE`, `BEE_VOICEBOX_MODEL_SIZE`, and `BEE_VOICEBOX_INSTRUCT`.

## Project operator and worker auto-pull

The hourly `project-operator` blueprint reads a sanitized Labs-only candidate brief and advances exactly
one project outcome at a time. Founder-gated/external rows and current in-flight work are excluded before
the worker sees the brief. Run it manually with `bee run project-operator`.

`com.agentpay.bee.pull` (launchd, every 10 min) drains routed Codex, Claude, Nemotron, Hermes, and CUA
cards. It claims the oldest → runs a headless worker with a hard safety contract (no reading or editing
hedge/Bill, no publishing/auth/money, no git push/commit) → requires an explicit worker outcome and then:
- **quota/credits** → reroutes Codex or Claude work to Nemotron instead of stalling.
- **no material change / founder blocker** → marks `blocked`, never falsely `done`.
- other error → `blocked` with the error; full transcript in `~/.bee/logs/exec-<id>-<worker>.log`.

`bee pull` runs one card manually; `BEE_PULL_DRYRUN=1 bee pull` shows the command+prompt without executing.

**Env gotchas (already handled in the launchd plist):** codex isn't on launchd's PATH → `BEE_CODEX_BIN`
points at the abs path; `config.toml` ships an invalid `service_tier="default"` for this CLI → overridden
to `fast` per-invocation. Run `bee scan` after switching accounts or workers. Agent status can be
overridden without editing code via `BEE_CODEX_STATUS`, `BEE_CLAUDE_STATUS`, or
`BEE_NEMOTRON_STATUS`; unavailable Codex work fails over to Nemotron, then Claude, and finally the
founder rather than disappearing.

Hermes/Nemotron uses true `-z` one-shot mode; the Nemotron lane is pinned to NVIDIA
`nvidia/nemotron-3-super-120b-a12b` rather than Hermes' light default. Claude uses non-interactive print
mode. Per-attempt transcripts are retained under `~/.bee/logs/exec-<id>-<worker>.log`.

## Dispatch — Bee is the founder's instruction channel to the fleet

When a card routes to an agent, Bee appends it to that agent's lane inbox in the vault and to the
shared dispatch log, so the fleet (which already reads the vault) picks it up:

| assignee | inbox written |
|---|---|
| claude | `memorybrain/Agent-Claude/bee-inbox.md` |
| codex | `memorybrain/Agent-Codex/bee-inbox.md` |
| hermes-lenovo | `memorybrain/Agent-Hermes/bee-inbox.md` (synced to Lenovo hourly) |
| local-gemma | `memorybrain/Agent-Shared/bee-inbox.md` |
| (all) | `memorybrain/Shared-Brain/BEE-DISPATCH.md` |

Agents claim with `bee start <id>` and close with `bee done <id>`.

## Two lanes, asymmetric autonomy

- **Labs** — routes and executes internal work; outward actions are prepared, then approval-gated.
- **Fund** — VIEW (read-only operational status), STAGE actions, and autonomously run read-only
  research/backtests (no money). **Never autonomous execution** — trade/order/money/live/bankroll
  are founder-only, forced to the approval wall by `FUND_EXEC_RE`. Founder-authorized 2026-06-15.

## Intelligence & senses

- **Brain (intelligent routing):** Bee classifies each request with local `gemma3:12b`
  via Ollama `/v1` ($0) — `🧠` in the rationale means the brain decided. A **rule-based safety floor**
  runs first and is never delegated to the LLM: fund execution (`FUND_EXEC_RE`) and money/login actions
  are forced to the approval wall regardless of what the model says. If the brain is unreachable, Bee
  falls back to deterministic keyword rules. Override with `BEE_BRAIN_URL` / `BEE_BRAIN_MODEL`.
- **NIM tiers:** routine cloud fallback uses `nvidia/nemotron-3-nano-30b-a3b`; founder planning and
  Nemotron deliverables use `nvidia/nemotron-3-super-120b-a12b`. Override with
  `BEE_NIM_FAST_MODEL` and `BEE_NIM_REASONING_MODEL`.
- **Eyes (`bee see [question]`):** `screencapture` a frame → describe via a vision endpoint
  (`BEE_VISION_URL` / `BEE_VISION_MODEL`, e.g. the Hermes gemini-vision gateway). Needs a one-time
  **Screen Recording** grant for the terminal/node.
- **Hands (CUA):** tasks needing GUI control route to the **`cua`** worker → dispatched to Hermes'
  background `computer_use` driver (`Agent-Hermes`, doesn't steal cursor/focus). Fund + screen control
  is forced to the founder (broker/exec risk), never autonomous.
- **Hands (`bee act`):** direct foreground actions use an observe → one safe action → observe loop.
  Bee re-reads the Accessibility tree after every step and stops after eight actions by default.
  Submissions, uploads, publishing, and sends become signed one-time action tickets; a fresh Clickey
  or CLI approval releases only that exact action for two minutes. Authentication, credentials,
  deletion, permissions, payments, and trading remain founder-controlled.

## Approvals and payment mandates

```bash
bee act "submit the prepared App Store listing"  # creates an action ticket
bee actions                                      # inspect prepared actions
bee ask <act-id>                                 # Clickey tick/cross approval

bee mandate 8 vercel.com "pay hosting" --rail stripe
bee ask <mandate-id>                             # founder approval
bee settle <mandate-id>                          # stage exact signed rail payload
bee confirm-settlement <mandate-id> <receipt>    # reconcile a founder-completed live payment
```

Mandates use a local HMAC key at `~/.bee/mandate.key` and bind the task, intent, merchant, amount,
currency, cap, rail, nonce, mode, issue time, and expiry. Sandbox demos have isolated accounting and
cannot alter the live spend or replay ledgers. Clickey approval uses a dedicated preload, validates
the sending renderer and request token, and rejects ambiguous gestures.

The dashboard's **Founder queue** only interrupts when an approval packet is ready. Human-gated Labs
work first creates an internal preparation card; Bee checks artifacts, fixes safe prerequisites, and
requires a concrete `BEE_APPROVAL_EVIDENCE` receipt before the parent returns to the queue. Selecting a
queue row opens its final-decision pane with the exact destination, authority, prepared evidence, and
the remaining approve/reject/open-final-step action. Tasks still missing internal prerequisites stay
with Bee rather than appearing as premature founder blockers.

## How it routes (difficulty-classified cost ladder)

Cheap by default; **hard/high-stakes goes straight to the heavy model** (no cheap-first-fail):

| Signal in task | → Worker | Model tier | Cost |
|---|---|---|---|
| OAuth / login / store / Stripe / account / publish | **rajiv** (approval wall 🔔) | human | — |
| architecture / design / strategy / launch / revenue / copy / review | **claude** | paid-heavy (Opus) | $0 marginal |
| implement / build / code / endpoint / test / deploy / Kaggle / GitHub | **codex** | paid (gpt-5.5) | $0 marginal |
| research / render / shorts / summarize / monitor / sweep | **hermes-lenovo** | free gateways | $0 |
| everything else (triage) | **local-gemma** | local | $0 |
| **fund** research/backtest (read-only, no money) | **hermes-lenovo** | free | $0 |
| **fund** execute/order/money/live/bankroll | **rajiv** 🔒 (approval wall) | human | — |

## Fund safety gate (replaces the old Labs-only wall)

Fund tasks (`FUND_RE`) route into the **fund lane**: read-only research/analysis → autonomous
on cheap workers; anything matching `FUND_EXEC_RE` (execute/order/buy/sell/position/go-live/
bankroll/money/transfer…) is **forced** to `needs_human` and parked on the approval wall.
There is no code path by which Bee autonomously executes a fund money action.

## Storage

`~/.bee/labs-board.db` (SQLite, via the `sqlite3` CLI — no native deps). Override with `BEE_DB`.

## Current next phases

- Bee MCP connector so Claude, Codex, and Hermes claim/update cards through structured tools.
- Auto-pull for Claude/Hermes and outcome telemetry (route, cost, latency, result, correction).
- Full-duplex interruption and turn-taking on top of the new natural Voicebox output.
- Provider adapters that can consume the already-staged Stripe/x402 payload after action-time approval.

## Verification

```bash
node --test ops/mac-mini/bee/bee.test.mjs
BEE_ACT_DRY=1 ops/mac-mini/bin/bee act "open the settings panel"
ops/mac-mini/bin/bee scan && ops/mac-mini/bin/bee doctor
```


## Stripe Integration (added 2026-06-25)

Bee can dispatch Stripe-aware tasks. The Stripe MCP server is configured in Hermes.

**Read ops** (autonomous): balance check, payment listing, subscription status, product lookup
**Write ops** (Clickey-gated): refunds, subscription changes, product edits

Full ref: `Shared-Brain/STRIPE-REFERENCE.md`
