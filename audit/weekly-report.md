# Bro Weekly Audit — 2026-04-13

## Summary

- **TypeScript health is clean** — both `api-edge` and `meridian` compile with zero errors; no type debt accumulating.
- **4 required (non-optional) secrets have no in-code fallback** — if any are missing from Cloudflare secrets, the Worker fails hard at runtime; cannot be verified from this repo alone.
- **Biggest live risk: India rail bookings are permanently `isSimulated: true`** — real IRCTC tickets are never issued; Make.com/OpenClaw carry the actual fulfilment, but the booking proof object signals simulation to every downstream consumer.
- **RCM ERA 835 connector is a scaffold** — the entire X12 835 payment parsing and posting pipeline runs in simulation mode; 6 TODO comments confirm this is intentional but unfinished.
- **Quick wins**: set `OPENTABLE_API_KEY` only after API is wired (key guard is currently bypassed), add `APPROVAL_SALT` (GDPR device-ID compliance), promote taxi skill from `_COMING_SOON` once API is integrated.

---

## 1. Unset Secrets

All secrets are expected to be set via `wrangler secret put` — none should appear in `wrangler.toml`. The `wrangler.toml` correctly contains only non-sensitive vars: `CORS_ORIGIN`, `API_BASE_URL`, `FRONTEND_URL`, `NODE_ENV`. Every entry below must be verified in the Cloudflare dashboard.

### Required (non-optional in `Env` interface — Worker fails without these)

| Secret | Enables | Critical? | Status |
|---|---|---|---|
| `WEBHOOK_SECRET` | HMAC-SHA256 signing of all outgoing webhook payloads | **REQUIRED** — no fallback | Must be set via `wrangler secret put` |
| `AGENTPAY_SIGNING_SECRET` | AP2 payment receipt signatures + wallet encryption | **REQUIRED** — no fallback | Must be set via `wrangler secret put` |
| `VERIFICATION_SECRET` | Verification certificate signatures | **REQUIRED** — no fallback | Must be set via `wrangler secret put` |
| `ADMIN_SECRET_KEY` | Admin API bearer token (`x-admin-key` header) | **REQUIRED** — no fallback | Must be set via `wrangler secret put` |

### Live Feature Secrets (optional type, but blocking live product)

| Secret | Enables | Critical? | Status |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | Ace concierge brain — all voice intents fail without it | Yes — core product | `wrangler secret put ANTHROPIC_API_KEY` |
| `DARWIN_API_KEY` | UK live departure boards (National Rail OpenLDBWS) | Yes — UK rail is live | `wrangler secret put DARWIN_API_KEY` |
| `RAPIDAPI_KEY` | India rail schedule via IRCTC (RapidAPI) | Yes — India rail is live | `wrangler secret put RAPIDAPI_KEY` |
| `STRIPE_SECRET_KEY` | UK payment checkout sessions | Yes — revenue | `wrangler secret put STRIPE_SECRET_KEY` |
| `STRIPE_WEBHOOK_SECRET` | Stripe payment confirmation webhooks | Yes — revenue | `wrangler secret put STRIPE_WEBHOOK_SECRET` |
| `STRIPE_SUCCESS_URL` | Post-payment redirect URL | Yes — UX | `wrangler secret put STRIPE_SUCCESS_URL` |
| `STRIPE_CANCEL_URL` | Post-cancel redirect URL | Yes — UX | `wrangler secret put STRIPE_CANCEL_URL` |
| `RAZORPAY_KEY_ID` | India UPI payment links | Yes — India revenue | `wrangler secret put RAZORPAY_KEY_ID` |
| `RAZORPAY_KEY_SECRET` | India UPI payment links | Yes — India revenue | `wrangler secret put RAZORPAY_KEY_SECRET` |
| `RAZORPAY_WEBHOOK_SECRET` | India payment confirmation webhooks | Yes — India revenue | `wrangler secret put RAZORPAY_WEBHOOK_SECRET` |
| `MAKECOM_WEBHOOK_URL` | Ops fulfillment sheet — every booking fires here | Yes — ops | `wrangler secret put MAKECOM_WEBHOOK_URL` |
| `OPENCLAW_API_URL` | Auto-fulfillment dispatch base URL | Yes — fulfillment | `wrangler secret put OPENCLAW_API_URL` |
| `OPENCLAW_API_KEY` | Auto-fulfillment auth | Yes — fulfillment | `wrangler secret put OPENCLAW_API_KEY` |
| `BRO_CLIENT_KEY` | `x-bro-key` header auth on `/api/concierge/intent` | Yes — security | `wrangler secret put BRO_CLIENT_KEY` |
| `APPROVAL_SALT` | SHA-256 device ID hashing (GDPR Art. 9 compliance) | Yes — compliance | `wrangler secret put APPROVAL_SALT` |
| `RESEND_API_KEY` | Booking confirmation emails | Ops-critical | `wrangler secret put RESEND_API_KEY` |
| `ADMIN_EMAIL` | Manual fulfillment alerts to ops | Ops-critical | `wrangler secret put ADMIN_EMAIL` |
| `GOOGLE_MAPS_API_KEY` | Places/restaurant discovery (searchNearby, autocomplete) | Optional fallback active | `wrangler secret put GOOGLE_MAPS_API_KEY` |

### Phase 2–4 Expansion Secrets (not yet wired in production)

| Secret | Enables | When needed |
|---|---|---|
| `DUFFEL_API_KEY` | Flights (350+ airlines) | Phase 2 (Apr) |
| `RAIL_EUROPE_API_KEY` | EU rail 200+ operators | Phase 2 (Apr) |
| `TRAINLINE_API_KEY` | UK + EU 270 carriers | Phase 2 (Apr) |
| `DISTRIBUSION_API_KEY` | EU rail OSDM | Phase 2 (Apr) |
| `AVIATIONSTACK_API_KEY` | Flight status / gate changes | Phase 2 |
| `PERPLEXITY_API_KEY` | Real-time travel intel (Sonar) | Phase 2 |
| `TICKETMASTER_API_KEY` | Events discovery | Phase 3 |
| `OPENTABLE_API_KEY` | Restaurant reservations (partnership required) | Phase 3 |
| `GETYOURGUIDE_API_KEY` | Activities / experiences | Phase 3 |
| `BUSBUD_API_KEY` | Global intercity buses | Phase 3 |
| `FLIXBUS_API_KEY` | Europe + US + LatAm buses | Phase 3 |
| `REDBUS_API_KEY` | India + SE Asia buses | Phase 3 |
| `AIRWALLEX_CLIENT_ID` + `AIRWALLEX_API_KEY` | Multi-currency payments | Phase 4 |
| `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN` + `TWILIO_WHATSAPP_FROM` | WhatsApp booking alerts | Phase 3 |
| `APPLE_PASS_TEAM_ID` + `APPLE_PASS_TYPE_ID` + `APPLE_PASS_CERT_PEM` + `APPLE_PASS_KEY_PEM` + `APPLE_PASS_WWDR_PEM` | Apple Wallet boarding passes | Phase 3 |
| `ELEVENLABS_API_KEY` | Server-side TTS (client key already in EAS) | Optional premium |
| `FIRECRAWL_API_KEY` | Markdown scraping for operators without APIs | Phase 2 |
| `SOLANA_RPC_URL` + `PLATFORM_TREASURY_WALLET` | On-chain fee settlement | Crypto path |
| `RCM_X12_CLAIM_STATUS_API_KEY` + `RCM_HETS_API_KEY` + `RCM_X12_APPEAL_INQUIRY_API_KEY` + `RCM_VAULT_ENCRYPTION_KEY` | Healthcare RCM connectors | RCM vertical |

---

## 2. Stubbed Features

### Rail

**India rail fallback placeholder data** — `apps/api-edge/src/lib/indianRail.ts:485`  
When a route is not in the static train map, the fallback returns `trainNumber: '12XXX'` and `trainName: 'Express Train'` as placeholder values. This reaches users for any unmapped origin/destination pair.

**India rail bookings: `isSimulated: true` hardcoded** — `apps/api-edge/src/routes/concierge.ts:956, 970, 2153`  
The booking proof object is hardcoded `isSimulated: true` in both the WhatsApp proof block and the plan confirm response. Real IRCTC seat reservation is not implemented — OpenClaw/Make.com handle fulfilment — but the booking record permanently signals simulation to all downstream consumers (app UI, receipts, ops).

### Payments / RCM

**RCM ERA 835 connector — full scaffold** — `apps/api-edge/src/lib/rcmEra835Connector.ts`  
File header: `Status: SCAFFOLD`. `getEra835ConnectorAvailability()` (line 103) returns `status: 'simulation'` for all connectors. `runEra835Connector()` (line 145) returns synthetic simulation data — no real X12 parsing occurs. ERA 835 parsing, payment matching, and payment posting are all unimplemented (see TODOs below).

**Foundation Agents: Phase 2 stubs returning 503** — `apps/api-edge/src/routes/foundationAgents.ts:331-350`  
`POST /api/foundation-agents/identity` (IdentityVerifierAgent) and `POST /api/foundation-agents/dispute` (DisputeResolverAgent) both return `503 NOT_YET_AVAILABLE` via the `phase2Stub()` helper.

### Maps / Discovery / Restaurants

**OpenTable search — body is a no-op even when key is present** — `apps/api-edge/src/lib/openTable.ts:40-46`  
`searchRestaurants()` returns `[]` when `apiKey` is absent (line 40 guard). When a key _is_ present, the function still exits at `void city; void date; void time; void partySize; void cuisineType; return [];` (lines 45–46) — the real API call is never made. The concierge falls back to Google Places for restaurant discovery (`routes/concierge.ts:1712`).

**Xotelo hotels — limited static city coverage** — `apps/api-edge/src/lib/xotelo.ts:358-359`  
`searchHotels()` returns `[]` for any city not present in the hardcoded `CITY_DATA` map. Comment: `// Return empty — Claude will say "not available yet"`.

### Other

**Taxi skill deferred** — `apps/api-edge/src/skills/index.ts:836`  
`taxiSkill` is defined but assigned to `_COMING_SOON` and excluded from the exported `SKILLS` registry. Comment: `// Taxi not yet active — waiting on API integration.`

**Ace Intents `/plan` stub recommendation** — `apps/api-edge/src/routes/aceIntents.ts:221`  
`POST /api/ace/intents/:intentId/plan` returns a hardcoded `{ summary: "Ace plan for: ${intent.objective}", totalAmountPence: budgetMax ?? 0, currency: 'GBP' }`. Comment: `// Stub recommendation — real AI planning happens via /api/concierge/intent`.

**Meridian onboarding: scripted demo responses** — `apps/meridian/app/onboard.tsx:1168`  
`getDemoResponse()` generates scripted mock replies (e.g. `"Found an Avanti at 09:45 for around £28..."`) during onboarding. Intentional for the demo walkthrough, but the function is not gated — if reachable outside onboarding it would silently return fake data.

---

## 3. TODOs & Technical Debt

No `FIXME`, `HACK`, `XXX`, `TEMP`, or `REMOVEME` comments found anywhere in `apps/api-edge/src/` or `apps/meridian/`.

### TODO — RCM ERA 835 (cohesive block, all in `apps/api-edge/src/lib/rcmEra835Connector.ts`)

| Line | Comment |
|---|---|
| 11 | `Status: SCAFFOLD — full X12 835 parsing and payment posting are TODO.` (file header) |
| 112 | `// TODO: promote to 'live' once X12 835 parsing is implemented` |
| 116 | `'era_835_parsing', // TODO` |
| 117 | `'payment_matching', // TODO` |
| 118 | `'payment_posting', // TODO` |
| 142 | `* TODO: Implement real X12 835 parsing in a follow-up phase.` |

These 6 TODOs are a single cohesive unit — the ERA 835 lane is an acknowledged Phase 2 item across all 3 capability areas.

### TODO — OpenTable

| File | Line | Comment |
|---|---|---|
| `apps/api-edge/src/lib/openTable.ts` | 42 | `// TODO: implement once OpenTable partnership confirmed` |

### Placeholder Data

| File | Line | Issue |
|---|---|---|
| `apps/api-edge/src/lib/indianRail.ts` | 485 | `trainNumber: '12XXX'` — placeholder in unmapped-route fallback, user-visible |

### Temporary Component (Meridian)

| File | Line | Note |
|---|---|---|
| `apps/meridian/components/AceFace.tsx` | 2 | JSDoc: `AceFace - temporary Path 2 presence.` — placeholder for the Skia-based `AceFaceSkia.tsx`; unclear if still in active use or orphaned |

---

## 4. TypeScript Health

**api-edge:** PASS — `npx tsc --noEmit` produced zero errors.  
**meridian:** PASS — `npx tsc --noEmit` produced zero errors.

Both codebases are type-clean. No suppression accumulation or `any`-cast drift detected at compilation level.

---

## Recommended Actions This Week

### 1. Audit live secrets in Cloudflare dashboard (highest risk, 30 min)

Run `npx wrangler secret list` and cross-reference against the required list in Section 1. Particular attention to: `WEBHOOK_SECRET`, `AGENTPAY_SIGNING_SECRET`, `VERIFICATION_SECRET`, `ADMIN_SECRET_KEY` (Worker fails without these), and `DARWIN_API_KEY`, `RAPIDAPI_KEY`, `ANTHROPIC_API_KEY` (live features dark without these). Add `APPROVAL_SALT` if not present — it is required for GDPR-compliant device ID hashing on every approval session.

### 2. Clarify `isSimulated: true` semantics on India rail bookings (`routes/concierge.ts:956, 970, 2153`)

Every India rail booking confirmation hardcodes `isSimulated: true`. If OpenClaw successfully issues a ticket, this flag is still `true` — misleading the app receipt UI, Make.com ops sheet, and any future audit trail. Define the correct state: either remove the flag once OpenClaw confirms, wire it to an actual fulfilment-confirmed callback, or rename it to something unambiguous like `requiresManualFulfilment: true`.

### 3. Fix the OpenTable stub to fail loudly when a key is set (`lib/openTable.ts:42-46`)

The function currently burns through the key guard and returns `[]` unconditionally — if `OPENTABLE_API_KEY` is ever set in production the function will silently return empty instead of calling the API. Either gate the entire function body on `process.env.OPENTABLE_PARTNERSHIP_ACTIVE` / a feature flag, or throw/log an error when a key is present but the API call is not wired. Silent empty results are the hardest class of bug to diagnose.
