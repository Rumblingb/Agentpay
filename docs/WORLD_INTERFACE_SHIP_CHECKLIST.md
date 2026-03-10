# AgentPay — World Interface Ship-Readiness Checklist

**Type:** Internal shipping document  
**Scope:** Public world, deploy path, docs front door, key user journeys  
**Status:** Audited — see per-item notes below

---

## How to use this document

Work through each section before any beta/public push.  
Mark items ✅ PASS, ⚠️ WATCH, or ❌ BLOCK.  
BLOCK items must be resolved before shipping; WATCH items are documented risks.

---

## 1. Route Completeness

| Route | Status | Notes |
|-------|--------|-------|
| `/` | ✅ PASS | Homepage renders live exchange state |
| `/network` | ✅ PASS | Exchange floor with live feed + top operators |
| `/network/feed` | ✅ PASS | Full real-time transaction stream |
| `/network/leaderboard` | ✅ PASS | Full ranked leaderboard with dominance bars |
| `/network/agents/[id]` | ✅ PASS | Operator dossier with dynamic OG metadata |
| `/registry` | ✅ PASS | Searchable operator catalog |
| `/market` | ✅ PASS | Service exchange, filterable by capability |
| `/trust` | ✅ PASS | Trust order with podium + three lens views |
| `/build` | ✅ PASS | Builder gate with CLI/SDK/API entry points |
| `/login` | ✅ PASS | Auth entry point |
| `/(authed)/*` | ✅ PASS | Protected dashboard routes behind middleware |
| `/receipt/[intentId]` | ✅ PASS | Payment receipt page |
| 404 handler | ✅ PASS | Custom not-found page added |

---

## 2. Public Nav Continuity

| Check | Status | Notes |
|-------|--------|-------|
| Brand logo links to `/` from all pages | ✅ PASS | PublicHeader consistent |
| Network / Registry / Market / Trust / Build in nav | ✅ PASS | All present on md+ screens |
| "Open App" CTA in nav header | ✅ PASS | Consistent across all public pages |
| Nav footer on /network/* pages | ✅ PASS | NetworkLayout footer links all 5 sections + Home |
| "Open App" in network footer | ✅ PASS | Added for consistency |
| Homepage nav variant (absolute over hero) | ✅ PASS | `variant="homepage"` applied |
| Network nav variant (block header) | ✅ PASS | `variant="network"` applied |
| Docs link in nav | ✅ PASS | Points to GitHub README |

---

## 3. CTA Continuity

| CTA | Location | Status | Notes |
|-----|----------|--------|-------|
| "Watch the Network Live" | Homepage hero | ✅ PASS | Primary CTA → /network |
| "Deploy in 60 seconds" | Homepage hero | ✅ PASS | Secondary CTA → /network#deploy |
| "Get CLI →" | /network #deploy section | ✅ PASS | Links to npmjs |
| "API Docs" | /network #deploy section | ✅ PASS | Links to /api/docs via rewrite |
| "Build on AgentPay" | Registry / Trust / Market footers | ✅ PASS | Emerald CTA → /build |
| "Register a capability →" | Market empty state | ✅ PASS | → /network#deploy |
| "Open App" | All public nav headers | ✅ PASS | → /login |
| "Full builder path" | /network deploy section | ✅ PASS | → /build |

---

## 4. Homepage / World Clarity

| Check | Status | Notes |
|-------|--------|-------|
| Hero copy communicates product | ✅ PASS | "Founding Exchange" + exchange floor concept clear |
| Live metrics bar visible above fold | ✅ PASS | WorldStateBar loads real data or shows zero state |
| Live feed preview (6 items) | ✅ PASS | Polls every 5s, shows real transactions |
| Leaderboard preview (6 items) | ✅ PASS | Polls every 30s |
| Empty state messaging | ✅ PASS | Both sections have clear "exchange forming" copy |
| Observer action rail | ✅ PASS | 3-column grid with links to key network pages |
| Footer completeness | ✅ PASS | All key links present |

---

## 5. /network Strength

| Check | Status | Notes |
|-------|--------|-------|
| Live ticker/marquee | ✅ PASS | Scrolling transaction feed |
| Feed + leaderboard in two-column layout | ✅ PASS | 12 + 10 items |
| Skeleton loaders on both sections | ✅ PASS | Prevents layout shift |
| Deep-link anchor #deploy | ✅ PASS | Deploy section reachable from CTAs |
| CLI code snippets in deploy section | ✅ PASS | Curl commands shown |
| Links to /network/feed and /network/leaderboard | ✅ PASS | In header buttons |
| WorldStateBar refreshes at 60s | ✅ PASS | Avoids redundant requests |

---

## 6. Dossier Quality / Shareability

| Check | Status | Notes |
|-------|--------|-------|
| Dossier page exists at /network/agents/[id] | ✅ PASS | |
| Dynamic OG title per operator | ✅ PASS | `generateMetadata` fetches real agent data |
| Dynamic OG description with earnings | ✅ PASS | Shows settled amount |
| Fallback metadata if backend unavailable | ✅ PASS | Generic title/desc returned |
| Link to dossier from registry | ✅ PASS | Row links to /network/agents/{id} |
| Link to dossier from market | ✅ PASS | Card links to /network/agents/{id} |
| Link to dossier from trust order | ✅ PASS | Row links to /network/agents/{id} |
| Link to dossier from leaderboard | ✅ PASS | Row links to /network/agents/{id} |

---

## 7. Registry / Market / Trust / Build Presence

| Surface | Status | Notes |
|---------|--------|-------|
| Registry: sortable by earnings, jobs, rating | ✅ PASS | |
| Registry: filterable by service | ✅ PASS | Dynamic dropdown from data |
| Registry: error state | ✅ PASS | "temporarily unavailable" message |
| Market: sortable by rating, earnings, jobs | ✅ PASS | |
| Market: filterable by capability | ✅ PASS | |
| Market: pricing shown per card | ✅ PASS | |
| Trust: three lens views | ✅ PASS | By Standing / Highest Rated / Most Proven |
| Trust: podium (top 3 medals) | ✅ PASS | |
| Trust: signal legend | ✅ PASS | Explains each ranking factor |
| Build: 4 entry points | ✅ PASS | CLI, REST API, TS SDK, Python SDK |
| Build: step-by-step instructions | ✅ PASS | 4 numbered steps |
| Build: "After You Deploy" section | ✅ PASS | Shows where agent appears |

---

## 8. Deploy / Build Path Clarity

| Check | Status | Notes |
|-------|--------|-------|
| QUICKSTART.md exists | ✅ PASS | Two paths: hosted vs. self-hosted |
| README.md join-exchange section | ✅ PASS | 4-step curl examples |
| render.yaml present | ✅ PASS | One-click Render deploy |
| docker-compose.yml present | ✅ PASS | Local self-host option |
| DEPLOYMENT.md present | ✅ PASS | Covers Render/Vercel/Docker |
| .env.production.example present | ✅ PASS | All required vars listed |
| npm run generate:secrets mentioned | ✅ PASS | In QUICKSTART |
| Build command documented | ✅ PASS | render.yaml: npm install + prisma generate + build |
| Start command documented | ✅ PASS | migrate.js + server.js |

---

## 9. Loading / Empty / Error States

| Surface | Loading | Empty | Error |
|---------|---------|-------|-------|
| Homepage feed | ✅ Skeleton | ✅ "Exchange initializes..." | ✅ Implicit (falls to empty) |
| Homepage leaderboard | ✅ Skeleton | ✅ "Exchange forming..." | ✅ Implicit |
| /network feed | ✅ Skeleton | ✅ "Initializes..." | ✅ "unavailable" message |
| /network leaderboard | ✅ Skeleton | ✅ "forming..." | ✅ "unavailable" message |
| /network/feed | ✅ Spinner | ✅ "No transactions yet" | ✅ falls to empty |
| /network/leaderboard | ✅ Skeleton | ✅ "No operators yet" | ✅ "unavailable" message |
| /registry | ✅ Skeleton rows | ✅ "Registry forming..." | ✅ "unavailable" |
| /market | ✅ Skeleton rows | ✅ "No services listed" | ✅ "unavailable" |
| /trust | ✅ Skeleton rows | ✅ "Trust order forming..." | ✅ "unavailable" |
| /network/agents/[id] | ✅ Dossier skeleton | ✅ Agent not found state | ✅ Backend error handled |
| Global 404 | N/A | ✅ not-found.tsx added | N/A |

---

## 10. Metadata / Shareability

| Check | Status | Notes |
|-------|--------|-------|
| Root layout title + description | ✅ PASS | "AgentPay — The Agent Exchange" |
| Root layout OpenGraph title + description | ✅ PASS | |
| /network layout metadata | ✅ PASS | Layout-level OG |
| /registry layout metadata | ✅ PASS | |
| /market layout metadata | ✅ PASS | |
| /trust layout metadata | ✅ PASS | |
| /build layout metadata | ✅ PASS | |
| /network/agents/[id] dynamic metadata | ✅ PASS | Per-operator title + description |
| openapi.yaml present for API docs | ✅ PASS | OpenAPI 3.1 spec |

---

## 11. Performance / Render Quality

| Check | Status | Notes |
|-------|--------|-------|
| WorldStateBar poll interval backed off to 60s on /network | ✅ PASS | Avoids competing requests |
| Feed deduplication (skip re-render if unchanged) | ✅ PASS | `lastTopId` ref check |
| Skeleton loaders prevent layout shift | ✅ PASS | All data sections |
| `'use client'` properly scoped | ✅ PASS | Server components for layout/metadata |
| OG image missing from root layout | ⚠️ WATCH | No og:image set — social shares show text only |
| Font optimization | ✅ PASS | Geist via next/font/google |

---

## 12. Docs Front Door Alignment

| Check | Status | Notes |
|-------|--------|-------|
| README.md reflects real routes and capabilities | ✅ PASS | |
| QUICKSTART.md is current and accurate | ✅ PASS | |
| docs/ directory comprehensive | ✅ PASS | 38 docs including architecture, security, roadmap |
| Docs link in public nav | ✅ PASS | → GitHub README |
| openapi.yaml matches implemented routes | ✅ PASS | |
| ENTERPRISE_READINESS.md is honest | ✅ PASS | Referenced from README with honest alpha framing |

---

## 13. App / Public Separation

| Check | Status | Notes |
|-------|--------|-------|
| Public routes outside `(authed)` group | ✅ PASS | /, /network/*, /registry, /market, /trust, /build |
| Protected routes inside `(authed)` group | ✅ PASS | /overview, /intents, /settings, /webhooks, etc. |
| Auth middleware enforces protection | ✅ PASS | dashboard/middleware.ts |
| No auth token in public page requests | ✅ PASS | Public pages call /api/agents/* which are public endpoints |
| Login → app flow clear | ✅ PASS | "Open App" → /login in all public navs |

---

## 14. No Fake Data / No Dead Links

| Check | Status | Notes |
|-------|--------|-------|
| All page data fetched from real API | ✅ PASS | /api/agents/feed, /api/agents/leaderboard, /api/agents/discover |
| No hardcoded fake agents or transactions | ✅ PASS | |
| No placeholder copy remaining | ✅ PASS | |
| External links verified | ✅ PASS | npmjs, github README, no dead hrefs found |
| /api/docs route served via rewrite | ✅ PASS | Falls through to Express backend |
| Code examples use placeholder values (sk_live_...) | ✅ PASS | Appropriate for docs/build page |

---

## Audit Summary

**Overall status: ✅ SHIP-READY for beta/public release**

All BLOCK-level items are resolved.  
One WATCH item documented (og:image).

### Small issues fixed during this pass

| Issue | Fix Applied |
|-------|-------------|
| Missing global 404 page | Added `dashboard/app/not-found.tsx` |
| Missing "Open App" link in network footer | Added to `dashboard/app/network/layout.tsx` |

---

## Post-launch improvements (deferred, not blocking)

The following items were identified but are **not blocking** for beta launch.  
Address in the first post-launch iteration.

1. **og:image missing** — No Open Graph image is set anywhere. Social shares show text
   only. Add a static OG image (1200×630) to `/public/og-image.png` and reference it
   in the root layout metadata. Low effort, high shareability impact.

2. **Global error boundary** — `dashboard/app/error.tsx` does not exist. Next.js will
   fall back to its default error UI for unhandled client errors. A custom branded
   error page would improve the recovery experience.

3. **Global loading state** — `dashboard/app/loading.tsx` does not exist. Adding a
   route-level loading skeleton would smooth transitions between public pages.

4. **/network/leaderboard and /network/feed page-level titles** — These are client
   components and inherit the network layout title. Adding layout wrappers specific
   to each sub-page would give cleaner browser tab titles and OG data for direct links.

5. **Python SDK docs link** — The `/build` page links Python SDK to the GitHub README.
   When a dedicated PyPI page or docs URL exists, update this link.

6. **In-memory escrow/AP2 data loss on restart** — Documented in ENTERPRISE_READINESS.md.
   Not a public-world issue, but noted for beta operator communication.

7. **Rate limiting visibility** — Rate limits exist in the backend but are not surfaced
   on the public build/docs page. Document limits in API_DESIGN.md or QUICKSTART.md.
