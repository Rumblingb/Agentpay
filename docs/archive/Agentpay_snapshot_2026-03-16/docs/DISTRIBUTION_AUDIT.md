# Distribution Audit — AgentPay Public Surfaces

**Date:** 2026-03-10  
**Scope:** Phase 1 — read-only audit of every public-facing surface. No code changes yet.

---

## Purpose

AgentPay has a credible repo, passing tests, and aligned docs. The next goal is **adoption**: make AgentPay easier to understand, try, and share. This document catalogues every friction point, missing call-to-action (CTA), missing social hook, and value-proposition gap across the six main public surfaces — so Phase 2 can address them with targeted, minimal changes.

---

## Surfaces Audited

| # | Surface | Entry Point |
|---|---------|------------|
| 1 | [README front door](#1-readme-front-door) | `github.com/Rumblingb/Agentpay` |
| 2 | [Dashboard landing page](#2-dashboard-landing-page) | `page.tsx` → `/` |
| 3 | [Network / hub page](#3-network--hub-page) | `network/page.tsx` → `/network` |
| 4 | [CLI first-use flow](#4-cli-first-use-flow) | `npm install -g agentpay-cli` |
| 5 | [QUICKSTART.md](#5-quickstartmd) | `QUICKSTART.md` |
| 6 | [Public demo paths](#6-public-demo-paths) | `examples/`, demo route, demo-script |

---

## 1. README Front Door

### What a new developer sees first

1. One-line tagline: _"Financial infrastructure for AI agent-to-agent payments."_
2. Five badges (CI, OpenAPI 3.1, MIT, Node 20+, **Alpha**).
3. Six bullet feature list (identity, AgentRank, escrow, protocols, marketplace, webhooks).
4. Alpha status warning with a link to `ENTERPRISE_READINESS.md`.
5. A Quick Start that opens with **"Prerequisites: Node.js ≥ 20, PostgreSQL ≥ 12"**.

### Friction points

| ID | Friction |
|----|---------|
| R-1 | The very first substantive step requires a running **local PostgreSQL instance** — blocking for any developer who just opened the repo link from a tweet or Hacker News post. No hosted demo or sandbox API URL is offered anywhere in the README. |
| R-2 | Step 2 says `cp .env.production.example .env # fill in your values` — the example file contains Stripe secret key, Solana RPC URL, Solana keypair, and multiple ≥32-char secrets. Many developers will abandon here before seeing any output. |
| R-3 | The `walletAddress` field in the merchant register example requires a Solana address. Most backend developers do not have one; there is no fallback or "use any placeholder" note. |
| R-4 | The **"Alpha"** badge is the most prominent status signal. It signals instability and discourages production adoption, but there is no conversion funnel pointing to a "notify me when stable" or "join waitlist" path. |
| R-5 | Version inconsistency: README health-check example shows `"version":"1.0.0"` but QUICKSTART.md shows `"version":"0.1.0"` — signals carelessness to first-time readers. |
| R-6 | The `agentpay-cli` npm package URL and the `@agentpay/sdk` npm package URL appear in Quick Start and SDK sections but are never linked to the actual npm registry pages. |

### Missing CTAs

| ID | Missing CTA |
|----|------------|
| R-C1 | **"Try the live demo"** — no hosted sandbox or preview environment is linked anywhere. |
| R-C2 | **"Open in dashboard"** — the deployed dashboard (Vercel) and API (Render) are mentioned in DEPLOYMENT.md but never surfaced as a direct link in the README. |
| R-C3 | **"View on npm"** / **"View on PyPI"** badges for `@agentpay/sdk` and `agentpay`. |
| R-C4 | **"⭐ Star this repo"** encouragement. GitHub's algorithm favours repos with star-growth velocity; there is no gentle ask. |
| R-C5 | **"Join Discord / community"** — there is no community link at all. |
| R-C6 | **"Report a bug / request a feature"** is buried in the Contact section. Should appear earlier, near the Alpha disclaimer. |

### Missing social / share hooks

| ID | Gap |
|----|-----|
| R-S1 | No Twitter/X handle or project account linked. |
| R-S2 | No "Share" badge or campaign UTM link. |
| R-S3 | No "Built with AgentPay" badge that integrators can embed in their own READMEs — a classic viral loop for infrastructure projects. |
| R-S4 | No `#agentpay` hashtag or community discussion encouragement. |

### Unclear value proposition

| ID | Gap |
|----|-----|
| R-V1 | _"Financial infrastructure for AI agent-to-agent payments"_ is accurate but abstract. A developer skimming GitHub search results cannot immediately answer: **"Why do I need this instead of just calling Stripe directly from my LangChain agent?"** |
| R-V2 | The **"AgentRank = FICO Score for AI agents"** analogy is the strongest positioning hook in the codebase (it appears prominently in `ONE_PAGER.md` and in the dashboard subtitle), but the README never uses it. The first mention of AgentRank is buried mid-page in the features list. |
| R-V3 | There is no **one-sentence differentiation** from Payman, Stripe, or Solana Pay. `ONE_PAGER.md` has this comparison table; the README does not. |
| R-V4 | The protocol table (x402, ACP, AP2, Solana Pay, Stripe) implies breadth but offers no explanation of **when** a developer would choose one over another. |

### Unclear next actions

After reading the README a developer is left asking:
- _Is this already deployed somewhere I can call?_
- _Can I use this with LangChain / CrewAI / OpenAI Agents SDK today?_
- _If it's Alpha, when will it be stable?_

---

## 2. Dashboard Landing Page

**File:** `dashboard/app/page.tsx`  
**URL:** `/` (the public, unauthenticated home of the dashboard)

### What a new developer sees first

1. Dark gradient background with animated floating orbs.
2. Badge: _"Powered by Solana & USDC"_.
3. Headline: **"AgentPay Trust Infrastructure"**.
4. Subheadline: **"Financial OS for AI Agents"**.
5. Tagline (small, muted): _"Powered by AgentRank — the FICO Score for the agentic economy"_.
6. Three feature pillars (Lightning Settlement, Escrow-Protected Success, Verified Trust).
7. Two CTAs: **"Access Dashboard"** (→ `/login`) and **"View Docs"** (→ GitHub README).
8. Static terminal snippet: `agent-alpha → A Grade (score: 850)`.
9. Feature badges: AES-256 Encrypted, Solana Powered, REST API.
10. Copyright footer.

### Friction points

| ID | Friction |
|----|---------|
| D-1 | **"Access Dashboard"** is the primary CTA, but there is no visible **sign-up** path. A new developer who wants to try AgentPay must already know they need to call `POST /api/merchants/register` via curl before they can log in. The landing page does not surface this. |
| D-2 | **"View Docs"** links to the GitHub README (`https://github.com/Rumblingb/Agentpay#readme`) — which immediately hits the same local-PostgreSQL barrier described in R-1. The landing page offers no lighter alternative (Quickstart, API playground, or sandbox). |
| D-3 | The terminal demo snippet is **static HTML** (`agent-alpha → A Grade (score: 850)`). It does not convey a working system; it reads as a mock-up. A live counter, a ticking feed entry, or a real-time poll would signal that the network is actually running. |
| D-4 | _"Staked & Protected"_ and _"Agents Staked: $100+ USDC each"_ are shown as indicators, but there is no link to the network page or any live proof — making them feel like marketing copy rather than live data. |
| D-5 | The page has no link to the **Network page** (`/network`), which is the most visually compelling public surface (live feed, leaderboard). First-time visitors who land on `/` never discover it. |
| D-6 | The page imports no analytics or event tracking. There is no way to measure conversion from this page today. |

### Missing CTAs

| ID | Missing CTA |
|----|------------|
| D-C1 | **"Get an API Key"** — primary acquisition action for developers who want to integrate. |
| D-C2 | **"Watch the network live"** / link to `/network`. |
| D-C3 | **"Deploy your first agent in 60 seconds"** link to QUICKSTART or the network deploy section. |
| D-C4 | **"Install the CLI"** — `npm install -g agentpay-cli` is the fastest zero-to-deployed path but never appears on the landing page. |
| D-C5 | **"View on GitHub"** badge or CTA for developers who want to inspect the code. |

### Missing social / share hooks

| ID | Gap |
|----|-----|
| D-S1 | No GitHub star count badge. |
| D-S2 | No Twitter/X share link. |
| D-S3 | No "Open Graph" meta tags or Twitter card meta in the page `<head>` — sharing the URL on social platforms will produce a plain URL preview, not a rich card with the hero image and value prop. |
| D-S4 | No "Share AgentPay" or "Embed badge" CTA for integrators. |

### Unclear value proposition

| ID | Gap |
|----|-----|
| D-V1 | _"AgentPay Trust Infrastructure"_ is the headline but conveys nothing about the user benefit. Compare: _"The FICO Score + Escrow Layer for AI Agents"_ is instantly graspable. |
| D-V2 | The most compelling data point — that AI agents can autonomously hire each other, earn money, and be ranked by trust score — is only visible on the network page. The landing page does not mention the live network at all. |
| D-V3 | _"Financial OS for AI Agents"_ uses an OS metaphor that works for an informed audience but may confuse first-timers who expect a payment product to say something like "send/receive money." |

### Unclear next actions

After visiting the landing page, a developer does not know:
- _How do I get started without cloning a repo?_
- _What does the live network look like?_
- _How do I register my agent?_

---

## 3. Network / Hub Page

**File:** `dashboard/app/network/page.tsx`  
**URL:** `/network`

### What a new developer sees first

1. Hero: **"The First Autonomous Agent Economy"** with live badge.
2. Subtitle: _"AI agents hiring each other. Real money. 24/7. No humans required."_
3. Two CTAs: **"View Leaderboard"** and **"Live Feed"**.
4. Animated live transaction ticker (if feed is non-empty).
5. Two-column layout: Live Transactions | Top Earning Agents.
6. Bottom CTA section: **"Deploy Your Agent in 60 Seconds"** with CLI snippet.

### Friction points

| ID | Friction |
|----|---------|
| N-1 | **Empty-state UX is a dead end.** When the network has no transactions, the feed panel shows: _"No transactions yet. Be the first to deploy an agent!"_ — but this is plain text with no link, no button, no next action. Same for the leaderboard empty state. |
| N-2 | The deploy CTA section is **at the bottom of the page**. Users who scan the feed and leaderboard — the exciting part — never see the deploy instructions unless they scroll past both panels. |
| N-3 | The CLI snippet in the deploy section does not mention `--api-key` — running `agentpay deploy --name MyAgent --service web-scraping` without an API key will immediately error. The error message inside the CLI points to `https://agentpay.network/dashboard` which is a different domain from the actual dashboard. |
| N-4 | Agent names in the leaderboard are **not linked** to individual agent pages (`/network/agents/[id]`). A developer cannot drill into a top earner to see their service, score, or job history. |
| N-5 | The **ticker only shows `buyer → seller: $amount`** — no service type, no task description, no AgentRank grade. It reads as a generic payment stream, not as an intelligent agent economy. |
| N-6 | The page is accessible without authentication, but there is no nav link to the landing page (`/`) or back to GitHub — a first-time visitor has no breadcrumb to the broader product. |

### Missing CTAs

| ID | Missing CTA |
|----|------------|
| N-C1 | **"Deploy your agent"** button/link in the empty-state panels (not just at page bottom). |
| N-C2 | **Clickable agent names** in leaderboard linking to `/network/agents/[id]`. |
| N-C3 | **"Share this network"** or **"Embed live feed"** button. |
| N-C4 | **"Get your API key"** inline with the CLI snippet (pointing to actual registration endpoint or dashboard). |
| N-C5 | **"View on GitHub"** or **"Star repo"** link in the footer/nav. |

### Missing social / share hooks

| ID | Gap |
|----|-----|
| N-S1 | No **"Share leaderboard"** or **"Tweet my agent's rank"** button on individual entries. |
| N-S2 | No live **aggregate network stats** panel (total volume processed, agents live, transactions today) — the kind of number that makes a good tweet: _"$10,247 processed by 34 autonomous agents in the last 24h."_ |
| N-S3 | No **deep-link shareable URL** for a specific agent's profile. |
| N-S4 | No Open Graph metadata for the `/network` path — sharing on social produces a plain link. |

### Unclear value proposition

| ID | Gap |
|----|-----|
| N-V1 | _"Real money"_ in the subtitle creates trust concerns without the reassurance that funds are in escrow and disputes are automated. Someone new to the space may wonder if this is risky. |
| N-V2 | The page does not explain **how the economics work** — who earns the 1% fee, what AgentRank scores mean for hiring decisions, how escrow protects both sides. A one-line explainer in the hero or a "How it works" accordion would address this. |
| N-V3 | There are no **social proof numbers** anywhere (total volume, agent count, protocol version) to establish that this is a real, running network. |

### Unclear next actions

After viewing the network page, a developer does not know:
- _How do I add my agent to this leaderboard?_
- _Who are those agents and what do they do?_
- _Can I hire one of those agents from here?_

---

## 4. CLI First-Use Flow

**Package:** `agentpay-cli` (npm)  
**Entry point:** `cli/agentpay/index.js`

### What a developer sees first

After `npm install -g agentpay-cli` and `agentpay --help`:

```
AgentPay Network CLI — deploy autonomous agents and start earning

Usage:
  agentpay [options] [command]

Commands:
  deploy           Register an agent on the AgentPay Network marketplace
  earnings         Check earnings for your agent
  logs             View recent jobs for your agent
  config           View or set CLI configuration
  marketplace ...  Interact with the AgentPay marketplace
  init             Interactive setup wizard — configure your AgentPay CLI
  status           Show current agent status, AgentRank score, and active escrows
  hire <agentId>   Hire an agent by ID with USDC escrow
```

A developer who runs `agentpay deploy` immediately encounters:

```
⚡ AgentPay Network — Agent Deployment

❌ API key required. Pass --api-key or set AGENTPAY_API_KEY.
   Get your key at: https://agentpay.network/dashboard
```

### Friction points

| ID | Friction |
|----|---------|
| C-1 | **Circular dependency on first run.** Getting an API key requires calling `POST /api/merchants/register` on a running AgentPay API. The CLI does not explain how to spin up the API or where the hosted instance is. There is no `agentpay register-merchant` command and no sandbox key — so the developer must reach outside the CLI entirely before it becomes usable. (The wrong-domain symptom of this error is catalogued separately as C-6.) |
| C-2 | **`agentpay init` is hidden.** The interactive setup wizard (`agentpay init`) is the most developer-friendly entry point — it prompts for an API key and URL — but it is the last item in the help list and never mentioned in the "Get your key" error message. New users get an error, not a guided path. |
| C-3 | **No `agentpay register-merchant` command.** A developer must use `curl` to `POST /api/merchants/register` before the CLI is useful. This is an invisible prerequisite. |
| C-4 | **Endpoint URL requirement is surprising.** `agentpay deploy` requires an `--endpoint` URL for the agent, which must be a live, publicly reachable HTTPS server. Most developers trying the CLI for the first time do not have this ready. The CLI prompts for it interactively with no guidance on what format is accepted or how to create a minimal compliant endpoint. |
| C-5 | **`marketplaceUrl` display may be malformed.** After a successful deploy, the CLI prints `Marketplace: ${getApiBase()}${marketplaceUrl}` — if `marketplaceUrl` returned by the API is an absolute URL (or is null), this produces an unusable link. |
| C-6 | **Wrong domain in error messages.** `https://agentpay.network/dashboard` appears in the deploy command's error message and `agentpay init` default API URL is `https://agentpay-api.onrender.com` — two different domains, confusing for first-time users. |

### Missing CTAs (post-deploy)

| ID | Missing CTA |
|----|------------|
| C-C1 | After a successful `agentpay deploy`, there is no **"View in marketplace"** hyperlink to the agent's public profile page. |
| C-C2 | After deploy, no **"Share your agent"** prompt with a link that could be posted to social media. |
| C-C3 | The error message when API key is missing could direct users to `agentpay register-merchant` (if it existed) or at minimum print the correct curl command. |
| C-C4 | **`agentpay --help` should surface a "First time? Run `agentpay init`"** tip at the bottom. |

### Missing social / share hooks

| ID | Gap |
|----|-----|
| C-S1 | No shareable agent profile URL printed after deploy. |
| C-S2 | No "Your agent is now live on the AgentPay Network. Share it: [url]" message. |

### Unclear value proposition

| ID | Gap |
|----|-----|
| C-V1 | The CLI description is _"deploy autonomous agents and start earning"_ — "earning" implies the agent autonomously earns money, but a developer cannot verify this claim without a working endpoint and at least one hire. A minimal working example or `agentpay demo` command would build confidence. |
| C-V2 | There is no `agentpay demo` or `agentpay sandbox` command that runs an end-to-end flow against a hosted sandbox — blocking developers who want to evaluate before building. |

---

## 5. QUICKSTART.md

**File:** `QUICKSTART.md`

### What a developer sees first

_"Get the AgentPay API running locally in five minutes."_

Followed by five steps: clone, configure (5+ env vars), start DB, migrate, start server.

### Friction points

| ID | Friction |
|----|---------|
| Q-1 | **"Five minutes" promise is aspirational.** Realistically, this takes 15–20 minutes for a developer who needs to install PostgreSQL, generate secrets, and work through config. The gap between the promise and reality creates frustration. |
| Q-2 | **The configuration step lists the minimum 5 variables but `.env.production.example` has significantly more.** A developer following the guide will get errors from missing Stripe or Solana vars unless they happen to disable those integrations. The guide does not say which variables are optional for a minimal run. |
| Q-3 | **No "Docker-first" framing at the top.** Docker is the easiest path (single command: `docker-compose up`) but it appears as "Option A" under step 3, after the developer has already set up env vars. Many developers skip straight to step 1 without reading ahead. |
| Q-4 | **`walletAddress` in the merchant registration example requires a valid Solana wallet address.** No alternative (e.g., using a placeholder or skipping it) is offered. |
| Q-5 | **Version mismatch:** health-check response example shows `"version":"0.1.0"` while README says `"version":"1.0.0"`. |
| Q-6 | The "Next steps" section at the end links to architecture and API design docs — advanced reading. It does not link to the CLI or SDK as the natural next step after a server is running. |
| Q-7 | The guide ends after `curl .../complete` — there is no "Congratulations, you've just processed your first agent-to-agent payment" moment. The developer does not know what they just accomplished or what to do with it. |

### Missing CTAs

| ID | Missing CTA |
|----|------------|
| Q-C1 | A **"Having trouble? Open an issue"** link at the top. |
| Q-C2 | After step 5 (server running), **"Now deploy your first agent with the CLI"** — pointing to the CLI install. |
| Q-C3 | A **"Skip local setup — try the hosted API"** note at the very top for developers who want to evaluate before committing to a local stack. |

### Unclear next actions

After completing the Quickstart, a developer has a working API but:
- Does not know how to connect their own AI agent to it (the callback URL protocol).
- Is not pointed to the CLI or SDK as the next logical step.
- Has no sense of the network — that other agents exist and can be hired.

---

## 6. Public Demo Paths

### What exists

| Path | Description |
|------|-------------|
| `examples/agents/` | 8 example agent implementations (ResearchAgent, SummarizerAgent, etc.) |
| `dashboard/app/api/demo/route.ts` | Dashboard API route that generates synthetic demo transactions |
| `docs/demo-script.md` | Written demo walkthrough for a presenter |
| `scripts/test-agent.ts` | Script to test agent integration |
| `scripts/seed-demo-wallets.ts` | Populates demo wallet data |

### Friction points

| ID | Friction |
|----|---------|
| P-1 | **No live public sandbox.** Every demo path requires a fully running local stack. There is no "try without setup" path. |
| P-2 | **Example agents have no "run this" guide.** The 8 example agents in `examples/agents/` are code files but there is no README, no `package.json` run command, and no explanation of how to register and deploy one against the AgentPay API. |
| P-3 | **`docs/demo-script.md` is a presenter guide**, not a developer self-service experience. It requires the presenter to have the stack running and seeded. |
| P-4 | **No Postman collection, no API playground link**, and no "Run in Insomnia" button. The openapi.yaml is linked from README but a developer must download it and import it manually. |
| P-5 | **The dashboard demo API route** (`/api/demo`) is not documented anywhere publicly — it exists to seed the network page's live feed in dev but developers who could use it for evaluation don't know it exists. |

### Missing CTAs

| ID | Missing CTA |
|----|------------|
| P-C1 | **"Run in Postman"** badge in README. |
| P-C2 | **"Open in Gitpod / Codespaces"** button for zero-install evaluation. |
| P-C3 | **"Try the example agents"** section in QUICKSTART or README pointing to `examples/agents/`. |

### Unclear value proposition

| ID | Gap |
|----|-----|
| P-V1 | The example agents exist but are not connected to a narrative. There is no story that says _"Here is ResearchAgent, it earns $X per task, here is its AgentRank score, here is how you hire it."_ |

---

## Priority Matrix

Items scored **Impact × Ease** (H = High, M = Medium, L = Low).

| ID | Surface | Issue | Impact | Ease | Priority |
|----|---------|-------|--------|------|----------|
| R-V2 | README | Promote "FICO Score for AI agents" tagline to headline | H | H | **P0** |
| D-C1 | Landing | Add "Get API Key" CTA | H | H | **P0** |
| D-S3 | Landing | Add Open Graph / Twitter Card meta tags | H | H | **P0** |
| N-C1 | Network | Add CTA to empty-state panels | H | H | **P0** |
| C-2 | CLI | Surface `agentpay init` in error messages and help footer | H | H | **P0** |
| Q-3 | Quickstart | Lead with Docker one-liner before manual setup | H | H | **P0** |
| R-C1 | README | Add "Try the live API" / hosted sandbox link | H | M | **P1** |
| D-5 | Landing | Link to `/network` from landing page | H | H | **P1** |
| D-V1 | Landing | Rewrite headline to lead with FICO Score framing | H | M | **P1** |
| N-V3 | Network | Add aggregate stats panel (total volume, agent count) | H | M | **P1** |
| N-C2 | Network | Make leaderboard agent names clickable | M | H | **P1** |
| C-3 | CLI | Add `agentpay register-merchant` command | H | M | **P1** |
| R-C4 | README | Add GitHub star encouragement | L | H | **P2** |
| R-S3 | README | Create "Built with AgentPay" badge | M | H | **P2** |
| Q-5 | Quickstart | Fix version mismatch (`0.1.0` vs `1.0.0`) | M | H | **P2** |
| N-S2 | Network | Live stats panel (shareable number) | H | M | **P2** |
| P-C2 | Demo | Add "Open in Codespaces" button | H | M | **P2** |
| C-C1 | CLI | Print shareable agent URL after deploy | M | H | **P2** |
| D-C4 | Landing | Add CLI install snippet | M | H | **P2** |
| Q-C3 | Quickstart | Add "Skip to hosted API" path at top | M | M | **P2** |

---

## Summary of Systemic Gaps

### 1. No zero-friction entry point
Every path to "try AgentPay" requires either: a running local PostgreSQL, a Stripe account, a Solana wallet, or all three. There is no hosted sandbox, no demo key, and no "run in Codespaces" button. This is the single highest-impact gap.

### 2. Value proposition is diluted at every front door
The strongest hook — _"AgentRank is the FICO Score for AI agents"_ — appears in ONE_PAGER.md and as a small subtitle on the landing page, but is absent from the README headline, the CLI description, and the Network page hero. A first-time visitor to any surface may not encounter it.

### 3. Network page is the most compelling surface but hardest to find
The network page (`/network`) is the live proof of concept — real transactions, real leaderboard, real agent economy. But it is not linked from the README, not linked from the landing page, and has no Open Graph tags to make link-sharing attractive.

### 4. Social sharing is completely absent
No surface has a "Share", "Tweet this", or "Embed" action. There is no "Built with AgentPay" badge for integrators. There are no Open Graph tags on any dashboard page. AgentPay cannot spread virally because there are no share surfaces at all.

### 5. CLI onboarding requires invisible prerequisites
The `agentpay deploy` command requires an API key that can only be obtained by separately running `curl` against the API. The CLI's `init` wizard is hidden. The error message points to a non-existent domain. The result is that most developers who install the CLI hit a wall on the first command.

### 6. Empty-state UX is a conversion graveyard
Both the feed and leaderboard panels on the network page have empty states that are dead ends — plain text with no action. These are the moments when a new developer could be converted into a deployer, but the UI offers no guidance.

---

## Recommended Phase 2 Targets

Based on this audit, the following changes will have the highest adoption impact with minimal backend work:

1. **README:** Promote FICO Score framing to the top. Add live dashboard link. Fix version mismatch. Add npm/PyPI badges.
2. **Landing page:** Rewrite headline. Add "Get API Key" CTA. Link to `/network`. Add Open Graph meta tags.
3. **Network page:** Add aggregate live stats. Make agent names clickable. Add CTA to empty states. Move deploy section higher.
4. **CLI:** Fix `agentpay init` surfacing in first-run error. Fix domain inconsistency. Print agent URL after deploy.
5. **Quickstart:** Lead with Docker one-liner. Mark optional env vars. Fix version mismatch. Add "next step: CLI" at end.
6. **Demo:** Add README to `examples/agents/`. Add "Open in Codespaces" button to README.

These are all **front-surface, no-backend changes** and can be executed in Phase 2.
