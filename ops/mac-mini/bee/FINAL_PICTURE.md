# Bee — The Final Picture (founder-in-a-box) + this iteration

> 2026-06-15 · Author: Claude (cofounder mode) · Inspiration: HeyClicky (heyclicky.com, YC)
> North star for [HACKATHON_PLAN.md](HACKATHON_PLAN.md). Repo: github.com/Rumblingb/Agentpay

## 1. The final picture
**Bee = a founder-in-a-box that lives on your desktop.** A charming always-on mascot (a butterfly)
sits on your Mac *and* Windows, listens by voice, sees your screen, and — unlike a toy assistant —
**runs a real company underneath**: it earns, spends, ships products, posts, and orchestrates the
whole AI fleet, growing with you over time.

The split that makes it special:
- **Surface (like HeyClicky):** desktop-resident, screen-aware, voice, spawns/points, delightful.
- **Depth (unlike HeyClicky):** a persistent operator stack — the fleet (Hermes/Nemotron/Claude/Codex),
  the kanban spine + cost-router, the approval wall, persistent memory (the vault), and the
  **earn→spend→operate** loop on real money rails (AgentPay + Stripe Skills).

> HeyClicky helps you click around your screen. **Bee runs your company.**

## 2. The mascot — a butterfly that shows the work
The butterfly's life-cycle *is* the fleet's state — so you can feel the system working at a glance:
- **Caterpillar / idle** — Bee online, watching, nothing queued.
- **Cocoon (pulsing)** — work in flight: tasks routed/in-progress, loops running, background agents busy.
- **Butterfly (emerges, flies)** — a task/goal completed; the "ideal" reached.
- **Lands on you (gentle alert)** — something needs you (the approval wall): a spend over cap, an OAuth, a decision.
- Hover/click → the two-lane dashboard (Labs + Fund) + the approval wall. Voice anytime ("Hey Bee").
The metaphor sells the loop: *cocoon → butterfly* = caterpillar idea → shipped outcome, on repeat.

## 3. How this kills our actual bottlenecks
| Bottleneck (found in recon) | How the final picture fixes it |
|---|---|
| Orchestration fragmented across 5 systems | ONE delightful surface over the single Bee spine |
| "Is it even working?" / no feedback | the butterfly *shows* loops + background work, live |
| Ingress friction (how do I tell it things) | voice + screen-aware, anytime, from the desktop |
| Human-auth/approval wall scattered | the butterfly lands on you with the one thing to approve |
| Context re-explaining each session | persistent memory (vault) → it "grows with you" |
| Execution stalls (Codex quota) | Nemotron-via-Hermes background agents do the work |
| Revenue stuck at £0 | the earn→spend loop is the product's beating heart |

## 4. This iteration (hackathon slice, 3-7 days)
Don't build the whole cross-platform app now. Build the **demo-able vertical slice** on the backend
that already exists (spine, router/Gemma, dispatch, voice, daemon, auto-pull, two-lane dashboard):

1. **The butterfly overlay** — a small always-on-top window (desktop shell) showing the 4 mascot
   states, driven by the live Bee board state (poll `~/.bee/labs-board.db`). Mac first (demo machine).
2. **The voice loop, polished** — "Hey Bee" → instant ack → it acts → speaks back (already wired; tighten).
3. **Earn→spend→operate** — Stripe Skills (capped $20/day) + Nemotron worker + a real example on camera.
4. **Screen-aware moment** — `bee see` → vision → acts (one shot in the demo).
5. **Record 90s** → writeup ("an AI cofounder that funds its own operations") → submit.

Windows (Lenovo) parity = fast-follow after the hackathon (the shell choice below keeps it cross-platform).

## 5. Desktop shell — the one real tech decision
Needs: cross-platform (Mac + Windows), transparent always-on-top overlay for the butterfly, system
tray, easy animated graphics (SVG/Lottie), talks to the local Bee backend.
- **Electron** — fastest to build with web/Node (the fleet is Node-heavy), great for animated overlays + tray, cross-platform. Heavier RAM. ← recommended for a 3-7d demo.
- **Tauri** (Rust+webview) — lighter, nicer, cross-platform; more setup/Rust.
- **Mac-native (SwiftUI)** — best Mac feel (HeyClicky's path) but NOT cross-platform → two codebases. Rejected (you want Windows too).

## 6. Differentiators to put in the writeup/demo
- Real money rails (live Stripe + AgentPay) — not a toy.
- A persistent fleet that *grows* — memory + the vault, across sessions and machines.
- Safety: NemoClaw + the fund wall + approval wall + capped spend.
- A reusable framework: "drop Bee on your fleet → founder-in-a-box."

## 7. Decisions (LOCKED 2026-06-15)
- **Shell:** ✅ **Electron** — cross-platform, Node-native, fast for an animated overlay + tray.
- **Iteration scope:** ✅ **Mac demo slice first** — butterfly + voice + earn→spend on the Mac for the 90s video; Windows fast-follow.
- App lives in `ops/mac-mini/bee/desk/` (Electron). Reads live state from `~/.bee/labs-board.db`; talks to the Bee backend via the daemon/CLI.
