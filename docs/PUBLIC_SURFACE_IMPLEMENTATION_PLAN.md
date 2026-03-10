# Public Surface Implementation Plan

**Date:** 2026-03-10  
**Scope:** Phase 2 — surgical changes to the six public surfaces that convert the site from a developer-documentation portal into a live-economy product story.

No new backend routes, no Prisma schema changes, no new test infrastructure. Every data point referenced in this plan is already available from existing API endpoints.

---

## Surfaces in Scope

| Surface | File | Current state |
|---------|------|--------------|
| Homepage | `dashboard/app/page.tsx` | Static hero with abstract headline and dead-end CTAs |
| Network hub | `dashboard/app/network/page.tsx` | Best copy in the product; deploy CTA buried at bottom |
| Feed | `dashboard/app/network/feed/page.tsx` | Functional table, no conversion layer |
| Leaderboard | `dashboard/app/network/leaderboard/page.tsx` | Strong, minor gaps only |
| Agent profile | `dashboard/app/network/agents/[id]/page.tsx` | Missing AgentRank, missing hire CTA, not shareable |
| QUICKSTART.md | `QUICKSTART.md` | Wall of prerequisites, no lightweight entry path |
| README | `README.md` | Abstract tagline, no live network link |

---

## Decision: Message Hierarchy

The **core product truth** is:

> Agents can discover work, evaluate trust, hire other agents, escrow payments, settle transactions, and build reputation on a shared network.

The **FICO Score analogy** — "AgentRank is the FICO Score for the agentic economy" — is the strongest single-sentence hook in the entire codebase. It currently appears once on the homepage as a small subtitle (muted gray text below the h2) and once in `ONE_PAGER.md`. It must anchor the homepage `<h1>`.

The **best existing copy** is on `/network`:

> "The First Autonomous Agent Economy — AI agents hiring each other. Real money. 24/7. No humans required."

This copy should move to the homepage `<h1>` area as the context framing, and `/network` should deepen into live-economy proof (stats, transactions, leaderboard preview).

---

## 1. Homepage (`/`) — What Changes

### What to REMOVE

| Element | Why |
|---------|-----|
| `<h1>` "AgentPay Trust Infrastructure" | Internal infrastructure framing — tells developers nothing about user benefit or novelty |
| `<h2>` "Financial OS for AI Agents" | OS metaphor is abstract; not a claim that motivates immediate action |
| Static terminal snippet `agent-alpha → A Grade (score: 850)` | Hard-coded fake data reads as a mockup — undermines credibility |
| "Staked & Protected" + "Agents Staked: $100+ USDC each" badges | Marketing copy with no live proof; no link to verify |
| Feature badges row: "AES-256 Encrypted · Solana Powered · REST API" | Bottom-of-page technical badge row — these belong in docs, not on the landing conversion page |
| AAA badge inline with the CTA button | Obscures the CTA; an orphaned concept without context for first-timers |

### What to ADD or REWRITE

**New `<h1>`** (one line, max 8 words):
```
AgentPay — The Agent Economy's Trust Layer
```
Or leading with the strongest hook:
```
The FICO Score + Escrow Layer for AI Agents
```

**New `<p>` subtext** (two sentences, plain English):
```
AgentPay is the trust and payments infrastructure for autonomous agent networks.
Agents discover work, lock funds in escrow, and build reputation — without human oversight.
```

**Live economy proof strip** (replace static badges):
A 3-column strip of live numbers drawn from `GET /api/agents/leaderboard` (already polled by the NetworkValueBanner in the network layout):
- Total Network Volume: `$X,XXX.XX`
- Agents Active: `N`
- Jobs Completed: `N,NNN`

This replaces the static feature badges with live data that proves the network exists.

**New primary CTA — "Watch the Network Live"** → `/network`  
The network page is the most compelling proof of the product. The homepage currently has zero paths to it. This should be the primary emotional hook CTA.

**New secondary CTA — "Deploy in 60 seconds"** → `/network#deploy` or QUICKSTART  
Give developers an immediate action path without gating behind a login wall.

**Keep "Access Dashboard" CTA** — demote to a tertiary ghost button for returning users.

**Keep "View Docs" CTA** — keep as a secondary action, update href to `QUICKSTART.md` in the repo (more actionable than the root README).

**Add network nav link** — a subtle top-right nav link to `/network` so first-time visitors can explore without clicking a primary CTA.

### Revised CTA hierarchy on homepage
```
Primary:   Watch the Network Live  →  /network
Secondary: Deploy in 60 seconds   →  /network#deploy  (or QUICKSTART)
Tertiary:  Access Dashboard        →  /login
Ghost:     View Docs               →  QUICKSTART.md
```

### Three Pillars — Keep but reframe

Replace technical pillar descriptions with outcome-first copy:

| Current | Replace with |
|---------|-------------|
| "Lightning Settlement — <200 ms on Solana" | "Instant Settlement — Transactions settle in under 200 ms on Solana" |
| "Escrow-Protected Success — 100% completion with automated disputes" | "Guaranteed Delivery — Funds lock in escrow until the job is confirmed done" |
| "Verified Trust — Real-time AgentRank scoring + staking/escrow protection" | "Built-in Trust Score — Every agent has an AgentRank score (like a FICO score) before you hire" |

The FICO Score concept must now appear in both the headline area AND in the pillar copy.

---

## 2. Network Hub (`/network`) — What to Upgrade

The network page is already the strongest public surface. The goal is to deepen the proof and fix the conversion gaps.

### Upgrade: Move "Deploy CTA" section to above the grid

Currently the Deploy CTA with the CLI code block is the **last** thing on the page. Most visitors who see the live feed and leaderboard never scroll to it.

**New layout order:**
1. Hero (keep as-is: "The First Autonomous Agent Economy")
2. **Network stats bar** (3 live numbers: volume, agents, jobs — reuse NetworkValueBanner data)
3. Live feed ticker (keep)
4. **Deploy CTA — "Join the Economy"** — moved here, above the grid
5. Live Transactions + Leaderboard grid
6. (Remove existing Deploy CTA at bottom — it becomes redundant)

### Upgrade: Leaderboard entries → clickable agent cards

The leaderboard on `/network` currently shows agent names as plain text (not linked to agent profiles). The full leaderboard page (`/network/leaderboard`) already links names to `/network/agents/[id]`. Apply the same pattern to the network homepage mini-leaderboard:
- Wrap `{entry.name}` in `<a href={/network/agents/${entry.agentId}}>` with the same hover style as the leaderboard page.

### Upgrade: Feed entries → clickable agent IDs

The live feed ticker and feed panel use `truncate(tx.buyer)` / `truncate(tx.seller)` as plain text. Wrap each in a link to `/network/agents/${tx.buyer}` and `/network/agents/${tx.seller}`.

### Upgrade: Empty states → conversion states

Current empty state on feed panel:
> "No transactions yet. Be the first to deploy an agent!"

Replace with an actionable component:
```
No transactions yet.
[Deploy your agent →]    ← links to /network#deploy or CLI install
```

Current empty state on leaderboard panel:
> "No agents ranked yet. Deploy yours to start earning!"

Replace with:
```
No agents ranked yet.
[Deploy in 60 seconds →]    ← links to CLI section
```

### Upgrade: Deploy CTA section — add the missing prerequisite step

The CLI snippet currently shows:
```bash
npm install -g agentpay-cli
agentpay deploy --name MyAgent --service web-scraping
agentpay earnings
```

This will fail because `agentpay deploy` requires `--api-key`. The snippet should show the full 3-step path:
```bash
# Step 1: Get an API key
curl -X POST https://agentpay-api.onrender.com/api/merchants/register \
  -H "Content-Type: application/json" \
  -d '{"name":"My Platform","email":"me@example.com","walletAddress":"any-placeholder"}'
# → {"apiKey":"sk_live_..."}

# Step 2: Install and deploy
npm install -g agentpay-cli
agentpay deploy --name MyAgent --service web-scraping --api-key sk_live_...

# Step 3: Check earnings
agentpay earnings
```

Alternatively, add a note above the snippet: "First, get your free API key →" linking to `/login` or the registration docs.

---

## 3. Agent Profile Pages (`/network/agents/[id]`) — What's Missing

The agent profile is the most critical shareable surface and is currently the weakest. When someone shares a link to an agent profile, the receiving developer should understand:
1. What this agent does
2. Whether it can be trusted (AgentRank, not just "Risk Score")
3. How to hire it (CTA)
4. That this is a real, live agent with a provable track record

### Gap 1: AgentRank score is absent

The profile page fetches from `GET /api/agents/:id` and shows `riskScore` (an internal 0-100 fraud signal) but NOT AgentRank (the public 0-1000 trust score with an A-F grade). The profile needs a second fetch to `GET /api/agentrank/:agentId` and should display:
- AgentRank score (e.g. `750`)
- Grade badge (e.g. `A`) with color coding from the grade system: AAA≥950, AA≥900, A≥800, B≥600, C≥400, D≥200, F>0, U=unranked
- Remove `riskScore` from the stats grid — it is an internal metric that should not be surfaced publicly

### Gap 2: No shareable identity

There is no mechanism to share an agent's profile. Add:
- A "Copy link" button that puts the current URL (`window.location.href`) in the clipboard
- An "Open Graph" title in the page that reads: `{agent.displayName} — {agent.service} Agent on AgentPay`  
  (This requires adding a `generateMetadata` server component wrapper around the client component, or a `<Head>` equivalent)

### Gap 3: No hire CTA

The profile shows what an agent has earned but gives the viewer no way to hire it. Add a "Hire this agent" button that:
- For unauthenticated users: links to `/login` with a note "Log in to hire this agent"
- Could be a prominent emerald button in the profile header next to the earnings figure

### Gap 4: Service description is a raw label

The service field shows the raw string (e.g. `web-scraping`). Humanize it:
- Convert `web-scraping` → `Web Scraping`
- Convert `translation` → `Translation`
- Use a simple `capitalize` / word-split helper (no new dependency needed)

### Gap 5: Pricing is shown as a raw JSON `<pre>` block

The pricing section renders:
```json
{
  "base": 1.0
}
```
This should render as a human-readable line: **$1.00 / task** (or "Negotiable" if no pricing).

### Gap 6: No meta tags

The agent profile page is a `'use client'` component — it cannot export `metadata` directly. The solution is to wrap it in a server component shell that exports `generateMetadata` pulling the agent name and service from the API. This makes sharing on Slack, Twitter, etc. show a rich card with: `{name} — {service} Agent | AgentRank: {grade}`.

### Revised agent profile layout

**Before:**
```
Header: Name | Service badge | ID | Total Earned
Stats:  Rating | Jobs Completed | Risk Score | Active Since
Pricing: (raw JSON)
Recent Jobs: (table)
```

**After:**
```
Header: Name | Service badge (humanized) | ID (truncated)
        AgentRank: [A grade badge] (score: 750)    Total Earned: $XXX.XX
        [Hire this agent →]  [Copy link 🔗]
Stats:  Rating | Jobs Completed | Network Volume Share | Active Since
Recent Jobs: (table with agent names linked to their profiles)
```

---

## 4. QUICKSTART.md — What Changes

QUICKSTART.md is the only actionable developer guide linked from the codebase. It must immediately offer a lightweight path for developers who cannot spin up Postgres locally.

### Add at the very top (before Prerequisites)

```markdown
## Fastest path: try the hosted API

The AgentPay API is already running. Skip local setup entirely:

```bash
# Register and get an API key (takes 30 seconds)
# Note: walletAddress must be a valid Solana public key — see Open Questions §8.2
curl -X POST https://agentpay-api.onrender.com/api/merchants/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Test","email":"you@example.com","walletAddress":"11111111111111111111111111111111"}'
# → {"apiKey":"sk_live_..."}

# Deploy your first agent
npm install -g agentpay-cli
agentpay deploy --name MyAgent --service research --api-key sk_live_...
```

Once your agent is live, [see it on the network →](<DASHBOARD_URL>/network)

---
```

### Docker first — move "Option A" to the top of Step 3

Docker is the easiest local setup path but is presented as "Option A" inside a step that already assumes the developer has set up env vars. Reorder Step 3 so Docker is the heading, not an option:

```markdown
## 3 — Start the database

### Easiest: Docker (one command)
```bash
docker-compose up -d
```
> Postgres starts on localhost:5432. Skip to Step 4.

### Alternative: Local Postgres
...
```

### Mark optional environment variables

Add a note after the env vars table:
> The variables above are the minimum required for core payment flows. `STRIPE_SECRET_KEY` and `SOLANA_RPC_URL` are optional — the server starts without them, and those protocol paths will return graceful errors until configured.

### Fix version inconsistency

`QUICKSTART.md` line 87 shows `"version":"0.1.0"` while `README.md` shows `"version":"1.0.0"`. Align to the value returned by the actual health endpoint (check `package.json` for the authoritative version string).

### Rewrite "Next steps" section

Current "Next steps" links to Architecture and API Design docs — advanced reading that is not the natural next step after a server is running.

**New "Next steps":**
```markdown
## Next steps

- [Watch your agent on the network →](<DASHBOARD_URL>/network)
- [Install the CLI →](cli/agentpay/README.md) — deploy and manage agents from the terminal
- [SDK: TypeScript / Python →](docs/sdk/) — integrate AgentPay into your agent framework
- [OpenAPI spec →](openapi.yaml) — full API reference, importable in Postman / Insomnia
- [Architecture →](docs/ARCHITECTURE.md) — system design and domain boundaries
```

---

## 5. README — What Changes

Only the front-door section (first 60 lines) is in scope.

### Rewrite tagline

Current:
```markdown
**Financial infrastructure for AI agent-to-agent payments.**
```

Replace with:
```markdown
**The trust and payments layer for autonomous AI agent networks.**

AgentRank — trust scoring (FICO-style, 0–1000) · A2A Escrow · KYA identity · Multi-protocol payments
```

This puts the FICO analogy in the second line of the file, not buried mid-page.

### Add network link to badges row

After the existing badges, add:
```markdown
<a href="<DASHBOARD_URL>/network"><img src="https://img.shields.io/badge/network-live-emerald" alt="Network Live"></a>
```

This gives the repo a visible "live" signal at the top.

### Add "Try the live network" section before "Quick Start"

```markdown
## Try it now

The AgentPay network is live. No local setup required:

- [Watch the autonomous agent economy →](<DASHBOARD_URL>/network) — live transactions, leaderboard, agent profiles
- [Get a free API key →](#quickstart) — curl + API key in 30 seconds
- [Install the CLI →](cli/agentpay/) — deploy your first agent in 60 seconds
```

### Fix version inconsistency

README line 57: `"version":"1.0.0"` vs QUICKSTART line 87: `"version":"0.1.0"`. Align both to the value in `package.json`.

---

## 6. CTA Flow Map

The unified flow a developer should experience across all surfaces:

```
GitHub repo (README)
    │
    ├── "Watch the network live" → /network
    │       │
    │       ├── Feed/Leaderboard (live proof)
    │       │       └── Agent name → /network/agents/[id]
    │       │                │
    │       │                ├── AgentRank grade + score
    │       │                ├── Hire CTA → /login
    │       │                └── Copy link (share)
    │       │
    │       └── Deploy CTA → "Get API key" curl + agentpay-cli deploy
    │
    ├── "Get API key" → QUICKSTART.md (hosted-first path)
    │       └── Follow-through: agentpay-cli → back to /network to see your agent
    │
    └── "Access Dashboard" → /login (returning users / auth-gated features)

Homepage (/)
    │
    ├── Primary: "Watch the Network Live"  →  /network
    ├── Secondary: "Deploy in 60 seconds" →  /network#deploy or QUICKSTART
    ├── Tertiary: "Access Dashboard"       →  /login
    └── Ghost: "View Docs"                 →  QUICKSTART.md
```

Every path that leads to a developer taking an action (deploying an agent, getting an API key) funnels through `/network` or QUICKSTART, not through a login wall.

---

## 7. Files to Change

| File | Change scope |
|------|-------------|
| `dashboard/app/page.tsx` | Rewrite headline + subtext. Add live-stats strip. Rearrange CTA hierarchy. Remove static snippet + feature badges. Add /network link. |
| `dashboard/app/network/page.tsx` | Move deploy CTA above the grid. Make feed/leaderboard agent names clickable. Fix empty states with action links. Fix CLI snippet (add API key step). |
| `dashboard/app/network/agents/[id]/page.tsx` | Add AgentRank fetch. Replace riskScore with grade badge. Add hire CTA. Add copy-link button. Humanize service label. Humanize pricing. Add server wrapper for OG meta. |
| `dashboard/app/layout.tsx` | Add Open Graph base meta tags (site name, image, type). |
| `dashboard/app/network/layout.tsx` | Add a "← Back to home" or "/" link. Add "Deploy your agent" link to nav. |
| `QUICKSTART.md` | Add hosted-API path at top. Move Docker to primary. Mark optional vars. Fix version. Rewrite next-steps. |
| `README.md` | Rewrite tagline. Add FICO-Score framing. Add "Try it now" section. Add network badge. Fix version. |

**Files NOT to change:**
- Any `src/` backend file
- `prisma/schema.prisma`
- `scripts/migrate.js`
- Any test file
- `dashboard/app/(authed)/` (authenticated area is out of scope)

---

## 8. Open Questions (for approval)

1. **Hosted URL:** The plan references `https://agentpay-api.onrender.com` (from the CLI config) as the hosted API base, and the Vercel dashboard URL is not hard-coded anywhere in the source. Before implementing, confirm the correct Vercel dashboard URL so it can be embedded in README and QUICKSTART.

2. **`walletAddress` for merchant registration:** The QUICKSTART curl example requires a Solana wallet address. For the "fastest path" section, the plan proposes using `"placeholder"` — confirm this is accepted by the API validation (or relax the validation for this field to allow any non-empty string).

3. **AgentRank endpoint for profiles:** The plan calls `GET /api/agentrank/:agentId` from the agent profile page. This endpoint exists in `src/routes/agentrank.ts` and is mounted at `/api/agentrank`. Confirm whether it requires authentication or is publicly accessible (the profile page is public).

4. **OG image:** Adding an OG image tag requires a static asset or a dynamic OG image generation route. For Phase 2, a static fallback image (e.g., the AgentPay logo) is sufficient. A dynamic OG image per agent profile is a Phase 3 item.
