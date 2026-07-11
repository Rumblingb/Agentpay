# GOAL — Bee × Clicky (the product's own north star)

> SEPARATE goal thread. Do NOT merge with `Shared-Brain/GOAL.md` (the AgentPay-Labs estate north star).
> This file governs the **Bee product** only. Owner: Rajiv + Claude (cofounder).
> Plans: [HACKATHON_PLAN.md](HACKATHON_PLAN.md) · [FINAL_PICTURE.md](FINAL_PICTURE.md) · [BEAST_COMBO.md](BEAST_COMBO.md)
> Last set: 2026-06-17

## North star
**A founder-in-a-box that is actually a PAIR working as one** — our own Clicky + Bee — funded by AgentPay:
- **Clicky (our own)** = the system-resident companion: the butterfly that lives in the system, has real
  **system controls** (screen vision, computer-use, keyboard/app control), and **sees the user's apps & tools
  and uses them** — connecting them so the bottleneck disappears. This is the body/hands and the delightful face.
- **Bee** = the orchestrator brain underneath: routes work across the fleet, runs loops/goals, learns, remembers.
- **AgentPay** = the governed money/authority layer (capability vault, scoped tokens, human approval, audit) —
  how the pair **spends and earns safely** (the repo: github.com/Rumblingb/Agentpay).

Win the Hermes Agent Accelerated Business Hackathon (NVIDIA × Stripe × Nous), then ship it.

> HeyClicky helps you click. **Our pair runs — and funds — your company.**

## Ready-to-live gate (it shouldn't break)
Bee is "live-ready" only when ALL hold (run `bee doctor` — must be all-green):
- `bee doctor` green: DB, brain, TTS server, daemon/pull/tts services, registry, voice helper, **wall intact (no fund leak)**.
- Every service is launchd-supervised (KeepAlive/StartInterval) → self-heals on crash/reboot.
- Every external call has a graceful fallback (voice→`say`, Codex→Nemotron, brain→keyword rules).
- No path autonomously moves money/trades or posts to unproven channels.
Today: **`bee doctor` = all green.**

## The bar = "top-notch" (the standard we hold every part to)
A part is DONE only when it clears all four:
1. **Reliable** — works every time, degrades gracefully, never silently fails.
2. **Polished** — looks/sounds like a finished product (the voice is natural, the butterfly is beautiful, the copy is sharp).
3. **Real** — does the actual thing (ships work, moves real money), not a mock.
4. **Safe** — respects the walls (fund lane, approval wall, capped spend), no surprises.
If it "feels unfinished," it isn't done. Quality is the feature.

## What winning looks like
- A 90-second video where you **talk to Bee**, the butterfly works (cocoon→butterfly), **real money moves both ways** (earn via HermesHub/AgentPay x402, spend via Stripe Projects, capped), and it **ships a task** — all on the NVIDIA/Hermes/Stripe stack.
- Judges remember the creature; they award the **self-funding earn→spend loop**.

## Honest state (2026-06-17) — tested
**Working:** kanban spine · Gemma3:12b brain (sharp routing) · cost-router + **Codex→Nemotron failover** (verified) · dispatch→agent inboxes · approval wall · **capability registry** (`bee scan`, wall-clean) · two-lane dashboard · always-on daemon + pull · **butterfly Electron app** (live board state) · worker-agnostic pull (Codex via `codex exec`, Nemotron/Hermes via `hermes -z --yolo`, verified).
**Rough / not top-notch yet (the gap that "feels unfinished"):**
- ✅ **Voice — FIXED (2026-06-17).** Neural **Kokoro** via mlx-audio, always-on server `com.agentpay.bee.tts` :8790 (load-once, warm ~0.3s), `bee-say.sh` (Kokoro→`say` graceful fallback), pluggable via `BEE_TTS_*`. Natural, local, free, instant. **Higgs Audio v3** = premium/demo voice later on NVIDIA (Lenovo GPU/hosted; non-commercial license; not Mac-real-time). Voice venv: `~/.bee/voice-venv` (py3.11, mlx-audio+misaki[en]+uvicorn).
- 🟡 **Butterfly polish** — functional but the SVG + states need art-direction to feel premium.
- 🟡 **Earn→spend loop** — rails identified (Stripe Projects + HermesHub x402), not yet wired end-to-end (B3).
- 🟡 **MCP connector** — server implemented and registered in Claude Desktop, Codex, and Hermes; still needs client restart/reload + tool-discovery verification (B2 deploy/config).
- 🟡 **Voice-in** — `bee listen` needs the one-time Mic grant; not yet wake-word ("Hey Bee").

## Path to perfect (prioritized — quality first)
1. **Voice → top-notch** (Kokoro local now; Higgs-on-NVIDIA for the signature/demo voice). *In progress.*
2. **Butterfly art pass** — premium mascot + state transitions that read instantly on camera.
3. **B3 earn→spend** — wire HermesHub x402 (earn) + Stripe Projects capped spend (spend); one real on-camera example.
4. **B2 Bee MCP connector deploy/config** — restart/reload Claude Desktop, Codex, and Hermes, then verify Bee tools are discovered.
5. **Wake-word + screen-aware moment** — "Hey Bee", and a `see`→act beat for the demo.
6. **Record 90s + writeup → submit.**

## Non-negotiables (carry from the estate, do not cross)
- Fund/hedge lane stays WALLED (FLEET.md §4); Bee views read-only, never autonomously executes money/trades.
- Spend capped ($20/day default) → above-cap to approval wall. Posting only to proven channels.
- Bee is free-to-run by default; route to cheapest capable worker; escalate to paid only when the task earns it.
