# Bro Weekly Audit — 2026-04-06

## Summary

- **TypeScript health is clean**: both `api-edge` and `meridian` compile with zero errors — no debt hiding in type errors.
- **Biggest risk**: every train booking is `isSimulated: true` — no automated ticket issuance exists for UK, India, or EU rail; all bookings rely on ops/OpenClaw manual fulfilment. This is the product ceiling right now.
- **Indian Rail falls back to mock data** silently when `RAPIDAPI_KEY` is absent or the API fails — users could get plausible-looking but fabricated schedules.
- **Five TODO clusters remain**: the largest is `rcmEra835Connector` (entire X12 835 parsing is a scaffold) and `openTable.ts` (restaurant booking is a dead stub returning `[]`).
- **Quick win**: `taxiSkill` is built and registered in `_COMING_SOON` but not exported — one line change enables it once API keys are in place.

---

## 1. Unset Secrets

Secrets set via `wrangler secret put` do not appear in `wrangler.toml`. The table below classifies each key by whether it is missing from wrangler.toml vars (all secrets should be absent — that is correct), and flags criticality for the live product.

| Secret | Enables | Critical? | Status |
|---|---|---|---|
| `WEBHOOK_SECRET` | HMAC-SHA256 signing on outgoing webhook payloads | **Required** | Must be set via `wrangler secret put` |
| `AGENTPAY_SIGNING_SECRET` | AP2 payment receipt signatures + wallet encryption | **Required** | Must be set via `wrangler secret put` |
| `VERIFICATION_SECRET` | Verification certificate signatures | **Required** | Must be set via `wrangler secret put` |
| `ADMIN_SECRET_KEY` | Admin API endpoints (`x-admin-key` header) | **Required** | Must be set via `wrangler secret put` |
| `ANTHROPIC_API_KEY` | Bro concierge brain — without this the product does nothing | **Critical** (no fallback) | Must be set via `wrangler secret put` |
| `DARWIN_API_KEY` | Live UK train departure boards (National Rail OpenLDBWS) | **Critical** (falls back to `mockSchedule`) | Must be set via `wrangler secret put` |
| `RAPIDAPI_KEY` | Live Indian rail schedule data via IRCTC/RapidAPI | **Critical** (falls back to `buildMockResponse`) | Must be set via `wrangler secret put` |
| `STRIPE_SECRET_KEY` | Stripe payment routes | **Critical** for UK bookings | Optional binding — no error if absent; routes silently degraded |
| `STRIPE_WEBHOOK_SECRET` | `/webhooks/stripe` signature verification | **Critical** for UK payments | Optional |
| `STRIPE_SUCCESS_URL` | Post-payment redirect | Critical for Stripe flow | Optional |
| `STRIPE_CANCEL_URL` | Cancelled checkout redirect | Critical for Stripe flow | Optional |
| `RAZORPAY_KEY_ID` | UPI payment links (India) | **Critical** for India payments | Optional |
| `RAZORPAY_KEY_SECRET` | Paired with `RAZORPAY_KEY_ID` | **Critical** for India payments | Optional |
| `RAZORPAY_WEBHOOK_SECRET` | `/webhooks/razorpay` verification | **Critical** for India payments | Optional |
| `MAKECOM_WEBHOOK_URL` | Every confirmed booking fires to ops Google Sheet | **Critical** for fulfilment | Optional |
| `OPENCLAW_API_URL` | OpenClaw automated fulfilment base URL | **Critical** for automated ops | Optional |
| `OPENCLAW_API_KEY` | Authenticates fulfilment dispatch to OpenClaw | **Critical** for automated ops | Optional |
| `BRO_CLIENT_KEY` | Static key in `x-bro-key` header — gates `/api/concierge/intent` | **Critical** for app auth | Optional (unenforced if absent) |
| `RESEND_API_KEY` | Booking confirmation emails | Important for UX | Optional |
| `ADMIN_EMAIL` | Admin copy of every booking request | Important for ops | Optional |
| `DUFFEL_API_KEY` | Flights — 350+ airlines (Phase 2) | Important | Optional |
| `RAIL_EUROPE_API_KEY` | EU rail live booking (Phase 2) | Important | Optional |
| `TRAINLINE_API_KEY` | EU rail — 270 carriers, fallback to Trainline (Phase 2) | Important | Optional |
| `GOOGLE_MAPS_API_KEY` | Places (New), Routes, Geocoding — navigation + discovery | Important | Optional |
| `TICKETMASTER_API_KEY` | Event discovery — 5k req/day free tier | Nice-to-have | Optional (returns `[]` if absent) |
| `PERPLEXITY_API_KEY` | Real-time travel intel (opening hours, advisories) | Nice-to-have | Optional |
| `ELEVENLABS_API_KEY` | Server-side premium TTS for Ace voice replies | Nice-to-have | Optional |
| `AVIATIONSTACK_API_KEY` | Flight status — gate changes, delays (Phase 2) | Nice-to-have | Optional |
| `FIRECRAWL_API_KEY` | Markdown scraping for operators without APIs | Nice-to-have | Optional |
| `APPLE_PASS_TEAM_ID` / `APPLE_PASS_TYPE_ID` / `APPLE_PASS_CERT_PEM` / `APPLE_PASS_KEY_PEM` / `APPLE_PASS_WWDR_PEM` | Apple Wallet pass generation | Nice-to-have | All optional |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_WHATSAPP_FROM` / `ADMIN_WHATSAPP_NUMBER` | WhatsApp booking alerts | Nice-to-have | All optional |
| `BUSBUD_API_KEY` | Global intercity buses (Phase 3) | Future | Optional |
| `FLIXBUS_API_KEY` | Europe + US buses (Phase 3) | Future | Optional |
| `OPENTABLE_API_KEY` | Restaurant reservations (partnership required) | Future | Stub always returns `[]` |
| `GETYOURGUIDE_API_KEY` | Experiences (partnership required) | Future | Optional |
| `AIRWALLEX_CLIENT_ID` / `AIRWALLEX_API_KEY` / `AIRWALLEX_WEBHOOK_SECRET` | Multi-currency payments (Phase 4) | Future | Optional |
| `G2RAIL_API_KEY` | Japan/China/Korea/USA/Canada rail | Future | Optional (mock fallback) |
| `SILVERRAIL_API_KEY` | Amtrak + VIA Rail Canada | Future | Optional |
| `TWELVEGO_API_KEY` | SE Asia multimodal | Future | Optional |
| `RCM_X12_CLAIM_STATUS_API_URL/KEY` | Medical billing 276/277 claim-status connector | RCM vertical | Optional |
| `RCM_HETS_API_URL/KEY` | HETS 270/271 eligibility connector | RCM vertical | Optional |
| `RCM_X12_APPEAL_INQUIRY_API_URL/KEY` | X12 appeal inquiry connector | RCM vertical | Optional |
| `RCM_VAULT_ENCRYPTION_KEY` | AES-GCM vault for RCM credentials (32-byte hex) | RCM vertical | Optional |
| `PLATFORM_TREASURY_WALLET` | Solana platform fee treasury address | Solana payments | Optional |

**Note**: `CORS_ORIGIN`, `API_BASE_URL`, `FRONTEND_URL`, `NODE_ENV` are correctly set in `wrangler.toml [vars]` as non-sensitive. `HYPERDRIVE` binding is set. `AI` binding (CF Workers AI) is set.

---

## 2. Stubbed Features

### Rail

| File | Line | Finding |
|---|---|---|
| `apps/api-edge/src/routes/concierge.ts` | 956, 970 | `isSimulated: true` on every UK/EU train booking proof object. Ticket is NOT issued by code — dispatched to ops/OpenClaw. |
| `apps/api-edge/src/routes/concierge.ts` | 2153 | Same `isSimulated: true` on the second booking-proof construction path (payment-required flow). |
| `apps/api-edge/src/lib/indianRail.ts` | 370–437 | Three fallback paths to `buildMockResponse()`: no key set (line 372), API call throws (line 387), API returns error (line 437). Mock data uses placeholder train number `12XXX` (line 485). |
| `apps/api-edge/src/lib/rtt.ts` | 561–661 | `mockSchedule()` function used as fallback when Darwin key absent (line 611), date is beyond real-time window (line 619), or Darwin returns no services (line 656). |
| `apps/api-edge/src/lib/euRail.ts` | 335–526 | `buildMockServices()` is the final fallback for EU rail when both Rail Europe and Trainline APIs fail or keys are absent (line 524–526). |
| `apps/api-edge/src/lib/globalRail.ts` | 322–510 | Same pattern — `buildMockServices()` fallback for G2Rail/12Go (line 508–510). |

### Payments / Fulfilment

| File | Line | Finding |
|---|---|---|
| `apps/api-edge/src/lib/rcmEra835Connector.ts` | 1–20, 112–142 | **Entire file is a scaffold.** `status: 'simulation'` hardcoded (line 112). ERA 835 parsing, payment matching, and payment posting all marked `// TODO` (lines 116–118). Comment at line 142: "TODO: Implement real X12 835 parsing in a follow-up phase." |
| `apps/api-edge/src/routes/foundationAgents.ts` | 331–350 | `IdentityVerifierAgent` and `DisputeResolverAgent` are Phase 2 stubs returning `501 Not Implemented` with `_schema: 'FoundationAgent/Stub/1.0'`. |

### Maps / Discovery

| File | Line | Finding |
|---|---|---|
| `apps/api-edge/src/lib/openTable.ts` | 23–46 | Entire `searchRestaurants()` function is a stub — always returns `[]`. `void` of all params (line 45) is the classic dead-code pattern. Partnership with OpenTable not yet confirmed. |
| `apps/api-edge/src/skills/index.ts` | 836 | `taxiSkill` is built and present but held in `const _COMING_SOON = [taxiSkill]` — intentionally excluded from the `SKILLS` export. Comment: "Waiting on API integration." |

### Buses

| File | Line | Finding |
|---|---|---|
| `apps/api-edge/src/lib/busbud.ts` | 318–511 | `buildMockBusServices()` is the final fallback when Busbud and FlixBus both fail/absent (line 509–511). |

### Hotels

| File | Line | Finding |
|---|---|---|
| `apps/api-edge/src/lib/xotelo.ts` | 94–359 | City-keyed mock hotel data used when Xotelo API key absent or call fails (line 359: `return []` on empty live results). `HotelMock` interface is internal mock scaffolding. |

---

## 3. TODOs & Technical Debt

### FIXME / HACK
_None found._

### TODO

| File | Line | Comment |
|---|---|---|
| `apps/api-edge/src/lib/rcmEra835Connector.ts` | 112 | `// TODO: promote to 'live' once X12 835 parsing is implemented` |
| `apps/api-edge/src/lib/rcmEra835Connector.ts` | 116 | `'era_835_parsing',     // TODO` |
| `apps/api-edge/src/lib/rcmEra835Connector.ts` | 117 | `'payment_matching',    // TODO` |
| `apps/api-edge/src/lib/rcmEra835Connector.ts` | 118 | `'payment_posting',     // TODO` |
| `apps/api-edge/src/lib/rcmEra835Connector.ts` | 142 | `// TODO: Implement real X12 835 parsing in a follow-up phase.` |
| `apps/api-edge/src/lib/openTable.ts` | 42 | `// TODO: implement once OpenTable partnership confirmed` |
| `src/services/solana-listener.ts` | 292 | `// TODO: Remove this legacy prisma.$transaction branch once the resolution` — legacy Node.js service, not in Workers runtime |

### Other notable debt

| File | Line | Note |
|---|---|---|
| `apps/api-edge/src/lib/rcmEra835Connector.ts` | 11 | File header: `Status: SCAFFOLD — full X12 835 parsing and payment posting are TODO.` |
| `apps/api-edge/src/routes/foundationAgents.ts` | 332 | `// POST /api/foundation-agents/identity — IdentityVerifierAgent (Phase 2 stub)` |
| `apps/api-edge/src/routes/foundationAgents.ts` | 346 | Response schema `'FoundationAgent/Stub/1.0'` — public callers will receive this schema string |
| `apps/api-edge/src/lib/indianRail.ts` | 485 | Mock train number `'12XXX'` in `buildMockResponse` — could surface to users if RAPIDAPI_KEY goes down |

---

## 4. TypeScript Health

```
api-edge: PASS (0 errors)
meridian: PASS (0 errors)
```

Both `npx tsc --noEmit` runs exited with code `0`. No type errors in either package.

---

## Recommended Actions This Week

### 1. Confirm critical secrets are live in production (immediate, high-impact)
Verify that `ANTHROPIC_API_KEY`, `DARWIN_API_KEY`, `RAPIDAPI_KEY`, `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET`, `RAZORPAY_KEY_ID`/`RAZORPAY_KEY_SECRET`, `OPENCLAW_API_KEY`/`OPENCLAW_API_URL`, and `MAKECOM_WEBHOOK_URL` are all set in the production Worker via `wrangler secret list`. Any gap here silently degrades the live product — Darwin or IRCTC falling back to mock means users get fabricated schedules.

### 2. Harden the Indian Rail mock fallback (medium, user-facing risk)
`apps/api-edge/src/lib/indianRail.ts:370–437` — three separate code paths silently fall back to `buildMockResponse()`. The mock data includes a placeholder train number `12XXX` (line 485) that could surface to users. At minimum, the fallback response should carry a clear `dataSource: 'mock'` flag and the concierge prompt should treat mock data as planning-only, never showing it as a confirmed timetable. Consider also adding an alert log when the IRCTC API fails in production.

### 3. Kill or advance the RCM ERA 835 scaffold (medium, technical debt)
`apps/api-edge/src/lib/rcmEra835Connector.ts` is a 200-line scaffold with hardcoded `status: 'simulation'` and three `// TODO` items for the core logic. If the RCM vertical is not on the roadmap for the next sprint, add a clear comment or a `throw` at the entry point so it cannot be called silently. If it is active work, promote the scaffold to a real implementation. Leaving it in a half-simulated state risks misleading ops tooling that reads the `status` field.
