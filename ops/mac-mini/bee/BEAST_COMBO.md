# Bee × Clicky — the beast combo (orchestrator founder-in-a-box with money)

> 2026-06-15 · Author: Claude (cofounder mode) · Pairs with [FINAL_PICTURE.md](FINAL_PICTURE.md) + [HACKATHON_PLAN.md](HACKATHON_PLAN.md)
> Research base: HeyClicky (heyclicky.com, YC, ~4wks old) — consumer desktop buddy: voice + screen-vision,
> spawns *ephemeral* agents, Notion/Gmail/Calendar, Mac-only. **No memory, no money, no fleet, no walls.**

## 1. The combo (why it's a beast)
Two halves most products never combine:
- **Clicky-half = the SURFACE** — desktop-resident butterfly, voice ("Hey Bee"), sees your screen, points/acts, delightful, zero-friction.
- **Bee-half = the DEPTH (orchestrator)** — a persistent multi-agent company underneath: the fleet (Claude/Codex/Hermes/Nemotron), a capability registry of every skill+tool, a cost-router, the kanban spine, memory that learns, and **real money rails (earn + spend)** — all behind safety walls.

> Clicky helps you click. **Bee runs — and funds — your company.** Same charm, 100× the depth.

## 2. How Bee SURPASSES Clicky
| Dimension | HeyClicky | Bee (beast combo) |
|---|---|---|
| Memory | none (ephemeral) | persistent vault + learns, **grows with you** |
| Agents | spawns generic one-offs | a real **fleet** (Claude×2, Codex×3, Hermes×2, Nemotron, free gateways) |
| Capability awareness | built-in only | **scans + indexes** every Hermes/Codex/Claude skill, MCP server, Mac app/CLI |
| Money | none | **earns** (AgentPay/Stripe) + **spends** (Stripe Skills) — a self-funding loop |
| Scope | personal desktop help | runs a **company** (ships apps, posts, ops at scale) |
| Safety | consumer free-for-all | **walls**: fund lane, approval wall, capped spend, NemoClaw |
| Platform | Mac only | Mac **+ Windows** (fleet spans both) |
| Routing | one model | **cost-router**: cheapest capable worker per task |

## 3. "See the agents, know the skills/tools, learn, everything on the Mac"
Four awareness systems Bee needs (the heart of this iteration):
1. **Agent awareness** — Bee knows each agent's state/availability/quota (e.g. Codex limited till Jul 8 → route to Nemotron). Probed via status + the Bee MCP connector each agent plugs into.
2. **Capability registry** *(new component)* — Bee scans and indexes every capability into one map it routes against:
   - Hermes skills (~40+: agentpay, browser-use, github, mcp, stripe-skills, creative…)
   - Codex skills + Claude skills + the MCP servers connected
   - Mac apps + CLIs + the running services (Postiz/n8n/Stripe/AgentPay)
   → stored as `~/.bee/registry.json`, refreshed on a loop. Routing becomes "which skill+worker fits" not just "which model".
3. **Mac awareness** — screen vision (`bee see` + vision model), filesystem, running processes, computer-use (Hermes background `computer_use`).
4. **Learning loop** *(new component)* — every task logs outcome (worker, cost, latency, success/fail, founder feedback) → Bee updates routing weights + memory. Over time it learns what to route where and what you like. Bad routes get downranked; founder corrections stick.

## 4. The walls (the enterprise-grade moat vs Clicky)
- **Fund lane walled** (FLEET.md §4) — Bee views fund read-only, never autonomously executes trades/money.
- **Approval wall** — anything needing the founder (OAuth, over-cap spend, publishing to new channels) → the butterfly lands on you.
- **Capped spend** — Stripe Skills bounded to `$BEE_SPEND_CAP_DAILY` ($20/day); above → approval.
- **NemoClaw sandbox** — autonomous actions run sandboxed (the NVIDIA safety story).
- **Proven-channels posting** — autonomous posts only to already-connected channels.

## 5. The earn→spend loop — perfected (highest risk = highest reward)
The single thing that wins the hackathon. Make it real, small, and legible on camera.
- **EARN** (Bee drives revenue): AgentPay MCP marketplace (FREE_LIMIT=50 → paid conversions), Stripe charges, app sales. Bee monitors revenue and acts to grow it (optimize listings, publish, run fleet campaigns).
- **SPEND** (Bee provisions itself): **Stripe Skills for Hermes** → buy SaaS, pay for an API/service it needs, within the cap.
- **THE LOOP**: earnings fund spend → spend buys capability → capability earns more. **Self-sustaining = the wow.**
- **Demo safely with real money**: one real (small) Stripe charge in (earn) + one real (small, capped, NemoClaw-sandboxed) provision/payment out (spend), narrated by voice, the butterfly going cocoon→butterfly as it ships. ~30s of the 90s video.
- **Dependency**: the actual **Stripe Skills package** must come from the hackathon (Nous/Stripe) — not on the machine yet. *Blocker to source.*

## 6. Build plan to get these perfect
- **Done:** butterfly overlay (live board state), voice loop, Gemma brain, kanban spine, router, dispatch, approval wall, auto-pull, two-lane dashboard, fund wall, §4 amended.
- **B1 — Capability registry + agent awareness:** `bee scan` → `~/.bee/registry.json`; router consults it; butterfly/dashboard show "what Bee can do" + agent health.
- **B2 — Bee MCP connector:** `bee-mcp.mjs` → Claude Desktop + Codex + Hermes plug in (bidirectional: they pull cards, report done, read registry).
- **B3 — Earn→spend loop:** install Stripe Skills; wire capped spend lane; Nemotron-via-Hermes execution worker; AgentPay revenue monitor; close the loop with one real example.
- **B4 — Learning loop:** outcome logging → routing weights + memory updates; founder feedback sticks.
- **C — Demo:** 90s — voice command → butterfly works (cocoon) → real money moves (earn+spend) → ships (butterfly) → reports back. Writeup: "an AI cofounder that funds its own operations." Submit.

## 7. My take (cofounder)
- The moat is **memory + money + fleet** — none of which Clicky has. Lead the story there.
- **Capability registry** is the unlock for "knows the skills and tools" — it's what makes Bee an orchestrator, not a chatbot. Build it early (B1); it makes every later route smarter.
- Keep the demo ruthlessly about the **earn→spend loop**. The butterfly is the hook; the self-funding loop is the knockout.
- Cross-platform/Windows, full learning depth = post-hackathon. Don't let scope eat the 90 seconds that win.
