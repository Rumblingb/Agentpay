# Bee → Hermes Agent Accelerated Business Hackathon (NVIDIA × Stripe × Nous)

> Plan date: 2026-06-15 · Author: Claude (cofounder mode) · Status: ACTIVE BUILD
> Entry: **Bee** — an always-on AI cofounder that runs AgentPay Labs as a fully automated company.
> Repo: github.com/Rumblingb/Agentpay · Spec: [BEE_ARCHITECTURE.md](../BEE_ARCHITECTURE.md)

## 1. The thesis (what Bee IS, for the judges)
A **fully automated company in a box**: Bee is the always-on persona you talk to (the "Claude-pet"
charm) sitting on top of a real operator stack that **earns, spends, and runs operations at scale**.
- **Earn** — AgentPay (live Stripe, MCP marketplace, apps on both stores) → Bee drives conversions/sales.
- **Spend** — the new **Stripe Skills for Hermes** → Bee buys what it needs, provisions its own SaaS, pays for services.
- **Operate** — Bee orchestrates a real fleet (2 Claude, 3 Codex, Hermes×2, free gateways) via a kanban
  spine, cost-router, dispatch, approval wall, and autonomous worker pull — already built (Phases 0-3).
This is exactly the brief: "a fully automated company" / "framework to accelerate enterprise functions."

## 2. Why this wins (judging fit, honest)
| Judge wants | Bee already has | Gap to close |
|---|---|---|
| Run on Hermes | Hermes control plane + 11 gateways live | — |
| Nemotron 3 Ultra (fast) | `nemotron-fast` + `nous-nemotron` profiles routing today | make Nemotron Bee's primary *execution* brain |
| NemoClaw (safe) | — | wrap autonomous actions in NemoClaw sandbox = safety story |
| Stripe Skills (spend) | AgentPay has live Stripe (earn side) | **install Stripe Skills for Hermes (spend side)** |
| Earn + spend + operate | real revenue rails + real fleet + real ops | wire the **earn→spend→operate loop** end-to-end |
Edge: most entries will be toys. **Bee runs a real company with real money rails.** That's the moat.

## 3. The winning demo (1-3 min, the earn→spend→operate loop)
One legible voice-driven loop, shown live:
1. **Talk to Bee** (voice): "Bee, we need analytics — sort it." (the cofounder/pet moment)
2. **Bee spends** — uses Stripe Skills to provision a SaaS / pay for a tool autonomously (within a capped budget).
3. **Bee operates** — dispatches the integration to a worker (Nemotron via Hermes / NemoClaw), ships it.
4. **Bee earns** — show the live AgentPay dashboard + a real Stripe charge / conversion.
5. **Bee reports back** (voice) + the two-lane dashboard updates.
Tagline: *"An AI cofounder that funds its own operations."*

## 4. Challenges → how we overcome
1. **Stripe Skills not installed** → install the hackathon's Stripe Skills for Hermes; wire Bee's spend lane behind a **capped autonomous budget** (e.g. $X/day) + approval wall above the cap. (Reuses the fund-exec safety pattern.)
2. **Codex quota wall (until Jul 8) + Codex isn't their stack** → **pivot execution to Nemotron-via-Hermes** (free, fast, on-brand). Codex becomes optional. This is strictly better for judging.
3. **NemoClaw safe execution** → run autonomous actions through NemoClaw → the safety narrative judges love.
4. **Account control / autonomous posting** → OAuth grants are still the wall. Demo posts to *proven* channels (X/LinkedIn live); everything else stays on the approval wall. Don't fake it.
5. **Full fleet control = "connectors"** → ship a **Bee MCP server** that Claude Desktop, Codex, and Hermes all plug into → one shared work surface (pull cards, report done, read fund status, spend, see screen). This is "use Claude+Codex to the max, all loops/skills/tools."
6. **Best orchestration brain** → today: Gemma 3 12B local (routing) + Nemotron (execution) + Claude/Codex (heavy). When **Fable 5** returns → promote it to Bee's orchestration brain.
7. **Submission mechanics** → 1-3 min demo video tagging @NousResearch + writeup → Discord submissions + typeform. **Need: the deadline** (not stated) to backplan.

## 5. Build sequence to a submittable entry
- **A — Foundation (DONE):** kanban spine, Gemma router, dispatch, approval wall, voice, auto-pull, two-lane dashboard, fund safety, §4 amended.
- **B — Hackathon-critical (next):**
  1. Install **Stripe Skills for Hermes**; wire Bee's spend lane + capped budget.
  2. Make **Nemotron-via-Hermes** Bee's primary execution worker (replace quota'd Codex in the loop).
  3. **NemoClaw** safety wrapper for autonomous actions.
  4. **Bee MCP server** (the connector) → register in Claude Desktop, Codex (`config.toml`), Hermes.
  5. Close the **earn→spend→operate** loop end-to-end with one real example.
- **C — Demo + submit:** script the 1-3 min loop, record, writeup ("AI cofounder that funds itself"), submit.

## 6. Value beyond the prize
- **Reusable framework:** "drop Bee on your fleet → it runs your company." That's the enterprise-function angle.
- **The moat is the loop:** an agent that *earns to fund its own spend* is self-sustaining — the thing everyone wants and few will actually demo with real money rails.

## 7. Decisions (LOCKED 2026-06-15)
- **Spend authority:** ✅ **capped daily budget** — Bee spends autonomously up to a cap (default $20/day), above-cap → approval wall. (Reuses fund-exec safety pattern; cap enforced in code.)
- **Posting authority:** ✅ **proven channels only** — autonomous to already-connected channels (X/LinkedIn); new OAuth / other channels → approval wall.
- **Deadline:** ✅ **3-7 days** → build full Phase B (Stripe Skills + Nemotron + NemoClaw + Bee MCP connector + earn→spend→operate loop), then demo.

## 8. Phase B build order (locked, deadline 3-7d)
1. **Stripe Skills for Hermes** + Bee spend lane w/ `$BEE_SPEND_CAP_DAILY` (default 20) → above-cap to approval wall. *(linchpin)*
2. **Nemotron-via-Hermes** = Bee's primary execution worker (new `nemotron` assignee; pull bridge calls Hermes gateway, not Codex).
3. **NemoClaw** safety wrapper for autonomous actions.
4. **Bee MCP server** (`bee-mcp.mjs`) → register as connector in Claude Desktop (`claude_desktop_config.json`), Codex (`config.toml [mcp_servers]`), Hermes (mcp config). Tools: inbox/claim/done/block/create/board/approvals/fund_status/spend/see.
5. **Close the loop** end-to-end with one real earn→spend→operate example.
6. **Demo + submit:** 90s video (the voice loop), writeup ("an AI cofounder that funds its own operations"), Discord + typeform.
