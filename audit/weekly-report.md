# Bro Weekly Audit — 2026-03-30

## Summary

- **Overall health: amber.** Core product (UK + India rail, Bro concierge) is wired up, but `api-edge` has a misplaced `extends: expo/tsconfig.base` that breaks `tsc --noEmit` in CI.
- **Biggest risk:** Multiple live features (EU rail, global rail, hotels, buses) silently fall back to mock/stub data in production — users receive plausible-looking fake schedules if their respective API keys are missing or calls fail.
- **TypeScript is broken in both packages** — api-edge due to a genuine tsconfig bug; meridian because expo packages are not installed in this audit environment (Expo build system handles it normally, but it blocks local `tsc` checks).
- **OpenTable is a complete no-op stub** — the function always returns `[]` even when a key is present; the implementation body is a `// TODO`.
- **Quick wins:** Fix api-edge tsconfig (remove/replace `extends`), set `GOOGLE_MAPS_API_KEY` (unlocks Places fallback for discovery), and promote `taxiSkill` out of `_COMING_SOON` once an API is wired.

---

## 1. Unset Secrets

> **Convention:** all secrets live in Cloudflare's secret store (`wrangler secret put`). Only `CORS_ORIGIN`, `API_BASE_URL`, `FRONTEND_URL`, and `NODE_ENV` live in `wrangler.toml [vars]`. The table below covers every `_KEY`, `_SECRET`, `_URL`, `_WEBHOOK` property in `types.ts` and its production readiness.

### Required (non-optional in the `Env` type)

| Secret | Enables | Critical? | Status |
|---|---|---|---|
| `WEBHOOK_SECRET` | HMAC-SHA256 signing of outgoing webhook payloads | **Critical** | Must be set via `wrangler secret put` |
| `AGENTPAY_SIGNING_SECRET` | AP2 payment receipt signatures & wallet encryption | **Critical** | Must be set |
| `VERIFICATION_SECRET` | Verification certificate signatures | **Critical** | Must be set |
| `ADMIN_SECRET_KEY` | Admin API endpoints (`x-admin-key` header) | **Critical** | Must be set |

### Core live-product secrets (optional type, but critical in practice)

| Secret | Enables | Critical? | Notes |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | Bro concierge brain (Claude Sonnet/Haiku) | **Critical** | No fallback — concierge fails completely |
| `DARWIN_API_KEY` | UK live train departure boards (Darwin SOAP) | **Critical** | Falls back to `mockSchedule()` in `rtt.ts:561` |
| `RAPIDAPI_KEY` | India rail IRCTC live schedules | **Critical** | Falls back to `buildMockResponse()` in `indianRail.ts:372` |
| `BRO_CLIENT_KEY` | App auth gate (`x-bro-key` header check) | **Critical** | If unset, gate is disabled; any client can call concierge |
| `OPENCLAW_API_URL` | Automated ticket fulfillment dispatch base URL | **Critical** | Fulfillment silently skips if unset |
| `OPENCLAW_API_KEY` | Authenticates OpenClaw dispatch requests | **Critical** | Same — no key = no auto-fulfillment |
| `MAKECOM_WEBHOOK_URL` | Ops sheet row creation for every confirmed booking | Important | Bookings not logged to ops sheet |
| `STRIPE_SECRET_KEY` | UK Stripe Checkout sessions | **Critical** (UK payments) | Stripe routes disabled if unset |
| `STRIPE_WEBHOOK_SECRET` | Verifies `/webhooks/stripe` payload signatures | **Critical** | Webhook ignored if unset |
| `STRIPE_SUCCESS_URL` / `STRIPE_CANCEL_URL` | Post-payment redirect URLs | Important | Stripe session creation fails if unset |
| `RESEND_API_KEY` | Booking confirmation emails | Important | Emails silently skipped |
| `ADMIN_EMAIL` | Admin copy of every booking request | Important | No admin alerts |

### Roadmap secrets (optional — activate when market opens)

| Secret | Enables | Phase | Notes |
|---|---|---|---|
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` / `RAZORPAY_WEBHOOK_SECRET` | India UPI payment links | Phase 2 | Pending business registration |
| `DUFFEL_API_KEY` | Flights search & booking (350+ airlines) | Phase 2 | Test prefix: `duffel_test_` |
| `RAIL_EUROPE_API_KEY` | EU train booking (200+ operators) | Phase 2 | Requires partnership |
| `TRAINLINE_API_KEY` | UK + EU 270 carriers | Phase 2 | Requires commercial partnership |
| `DISTRIBUSION_API_KEY` | 40+ EU rail carriers (OSDM) | Phase 2 | Requires partnership |
| `GOOGLE_MAPS_API_KEY` | Places (New), Routes, Geocoding | Now | Discovery falls back to empty; quick win |
| `TICKETMASTER_API_KEY` | Event discovery post-booking (5k req/day free) | Now | Self-serve free tier |
| `OPENTABLE_API_KEY` | Restaurant reservations | Blocked | Partnership required; stub always returns `[]` |
| `GETYOURGUIDE_API_KEY` | Activity & experience booking | Phase 3 | Partnership required |
| `AVIATIONSTACK_API_KEY` | Flight gate/delay/cancel push alerts | Phase 2 | 500 req/mo free tier |
| `PERPLEXITY_API_KEY` | Real-time web search (opening hours, advisories) | Phase 2 | $5/1M tokens |
| `BUSBUD_API_KEY` | Intercity buses (4,500+ carriers) | Phase 3 | Falls back to mock |
| `FLIXBUS_API_KEY` | EU + US buses | Phase 3 | Requires affiliate agreement |
| `REDBUS_API_KEY` | India + SE Asia buses | Phase 3 | Requires partnership |
| `G2RAIL_API_KEY` | Japan, China, Korea, USA, Canada rail | Phase 5 | Falls back to mock |
| `SILVERRAIL_API_KEY` | Amtrak + VIA Rail Canada | Phase 5 | Falls back to mock |
| `TWELVEGO_API_KEY` | SE Asia multimodal (trains, buses, ferries) | Phase 5 | Falls back to mock |
| `FIRECRAWL_API_KEY` | Markdown scraping for operators without APIs | Now | 500 free credits |
| `AIRWALLEX_CLIENT_ID` / `AIRWALLEX_API_KEY` | Multi-currency payments (0.5% FX) | Phase 4 | Add at 3+ markets |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_WHATSAPP_FROM` | WhatsApp booking notifications | Phase 2 | Sandbox available now |
| `ADMIN_WHATSAPP_NUMBER` | Admin WhatsApp booking alerts | Phase 2 | Pairs with Twilio |
| `SOLANA_RPC_URL` | Solana listener DO (mainnet) | Crypto | Default public node used if unset |
| `OPENAI_API_KEY` | Whisper STT fallback | Optional | CF Workers AI is primary |
| `GEMINI_API_KEY` | High-volume extraction (opt-in paid tier) | Optional | Not used in prod paths |
| `PLATFORM_TREASURY_WALLET` | Solana platform fee recipient | Crypto | Hard-coded fallback value noted in types.ts |

---

## 2. Stubbed Features

### Rail

| File | Line | What's stubbed | Detail |
|---|---|---|---|
| `apps/api-edge/src/lib/rtt.ts` | 561 | UK rail mock schedule | `mockSchedule()` — activated when `DARWIN_API_KEY` absent, date is beyond real-time window, or Darwin returns 0 services. Returns plausible but fake train times. |
| `apps/api-edge/src/lib/indianRail.ts` | 372, 387, 437 | India rail mock response | `buildMockResponse()` — triggered when `RAPIDAPI_KEY` absent or IRCTC API fails. Comment: *"Return mock data so the demo works without a key"*. |
| `apps/api-edge/src/lib/euRail.ts` | 526 | EU rail mock schedule | `buildMockServices()` fallback — activated when neither `RAIL_EUROPE_API_KEY` nor `TRAINLINE_API_KEY` is set. All EU train results are fake. |
| `apps/api-edge/src/lib/globalRail.ts` | 510 | Global rail mock schedule | `buildMockServices()` fallback — activated when `G2RAIL_API_KEY` absent. Japan/Korea/USA results are fake. |

### Hotels

| File | Line | What's stubbed | Detail |
|---|---|---|---|
| `apps/api-edge/src/lib/xotelo.ts` | 359 | Hotel mock data | Falls back to `CITY_DATA` static mock when Xotelo API unavailable. `HotelMock.isLive` flag (`xotelo.ts:294`) marks live vs mock rates. |

### Buses

| File | Line | What's stubbed | Detail |
|---|---|---|---|
| `apps/api-edge/src/lib/busbud.ts` | 511 | Bus mock schedule | `buildMockBusServices()` — activated when `BUSBUD_API_KEY` and `FLIXBUS_API_KEY` both absent. |

### Payments / Fulfillment

| File | Line | What's stubbed | Detail |
|---|---|---|---|
| `apps/api-edge/src/routes/concierge.ts` | 835, 849 | `isSimulated: true` hard-coded | WhatsApp booking proof objects carry `isSimulated: true` — signals OpenClaw hasn't confirmed ticket issuance yet. |
| `apps/api-edge/src/routes/concierge.ts` | 960 | `isSimulated: !!item.trainDetails` | Conditional flag: item is simulated when `trainDetails` is present (pre-fulfillment). |

### Restaurants / Discovery

| File | Line | What's stubbed | Detail |
|---|---|---|---|
| `apps/api-edge/src/lib/openTable.ts` | 40–46 | Full stub — always `return []` | `searchRestaurants()` returns `[]` unconditionally even when `apiKey` is provided; body is `void` params + `return []`. No API calls ever made. |
| `apps/api-edge/src/lib/googlePlaces.ts` | 156, 180, 206, 230, 253, 271, 293 | `return []` on missing key / errors | All three exported functions (`searchNearby`, `textSearch`, `autocomplete`) return empty array when `GOOGLE_MAPS_API_KEY` unset. |

### Other

| File | Line | What's stubbed | Detail |
|---|---|---|---|
| `apps/api-edge/src/skills/index.ts` | 789 | `taxiSkill` — `_COMING_SOON` | Taxi skill defined but not registered in `SKILLS` export; comment: *"Waiting on API integration"*. |

---

## 3. TODOs & Technical Debt

### FIXME / HACK (none found)

No `FIXME` or `HACK` comments found in `apps/` or `src/`.

### TODO

| File | Line | Comment |
|---|---|---|
| `apps/api-edge/src/lib/openTable.ts` | 42 | `// TODO: implement once OpenTable partnership confirmed` — stub body with all params voided; function always returns `[]` even with a valid key. |
| `src/services/solana-listener.ts` | 292 | `// TODO: Remove this legacy prisma.$transaction branch once the resolution engine is confirmed stable in production.` — double-write risk: resolution engine is canonical but legacy path creates a parallel `transactions` row. |
| `packages/sdk/src/types.ts` | 1 | `// Minimal public types for PR1. Conservative shapes; TODOs kept where backend parity must be verified.` — shapes may be incomplete vs backend responses. |

---

## 4. TypeScript Health

### api-edge: **FAIL**

```
tsconfig.json(25,14): error TS6053: File 'expo/tsconfig.base' not found.
```

**Root cause:** `apps/api-edge/tsconfig.json` line 25 has `"extends": "expo/tsconfig.base"`. This is wrong — `api-edge` is a Cloudflare Workers project with no Expo dependency. The `expo` package is not installed in `api-edge/node_modules`. All `tsc --noEmit` runs in CI or local audit will fail until this is removed.

**Fix:** Remove the `"extends"` line from `apps/api-edge/tsconfig.json`. The existing `compilerOptions` block already sets everything needed for Workers (`target: ES2022`, `lib: [ES2022]`, `types: [@cloudflare/workers-types]`).

---

### meridian: **FAIL** (1,341 errors — environment issue)

```
error TS2468: Cannot find global value 'Promise'.
app/(main)/_layout.tsx(1,23): error TS2307: Cannot find module 'expo-router' or its corresponding type declarations.
app/(main)/converse.tsx(16,65): error TS2307: Cannot find module 'react' ...
... (1,341 total errors across all app screens and components)
```

**Root cause:** `apps/meridian/tsconfig.json` extends `expo/tsconfig.base`, which pulls in Expo's JSX and lib settings. In the audit environment, `expo` and its peer packages (`react`, `react-native`, `expo-router`, etc.) are not installed (`npm install --prefer-offline` installs only root-level packages). Without the base, TypeScript falls back to `ES5` lib which is missing `Promise`, `Array.includes`, etc.

**Assessment:** This is an environment-specific failure, not a code bug. The Expo managed workflow (`eas build`, `expo prebuild`) installs all packages before running `tsc`. However, it means `tsc` cannot be used as a standalone lint step without `cd apps/meridian && npm install` first. No action required on the code; consider adding `apps/meridian/node_modules` to CI install scope if type-checking meridian independently.

---

## Recommended Actions This Week

### 1. Fix `api-edge` tsconfig — removes CI blocker (5 min)
Remove line 25 (`"extends": "expo/tsconfig.base"`) from `apps/api-edge/tsconfig.json`. This is a genuine misconfiguration — a Cloudflare Workers project should never extend Expo's tsconfig. Once removed, `cd apps/api-edge && npx tsc --noEmit` will pass cleanly.

### 2. Implement `openTable.ts` body or remove the key check (1 hr to implement, 5 min to document)
`searchRestaurants()` at `apps/api-edge/src/lib/openTable.ts:40` returns `[]` even when `OPENTABLE_API_KEY` is set. The `apiKey` check on line 40 is dead code. Either implement the `POST /FindAvailability` call (unblock the partnership) or remove the stub key-check so the function clearly signals "not available" rather than silently returning nothing.

### 3. Set `GOOGLE_MAPS_API_KEY` + `TICKETMASTER_API_KEY` — immediate live-data wins
Both APIs are self-serve (no partnership required). Without `GOOGLE_MAPS_API_KEY`, all restaurant discovery via `googlePlaces.ts` returns `[]`, making the Places fallback for `book_restaurant` inoperative. `TICKETMASTER_API_KEY` has a free 5k req/day tier and requires only sign-up. Both can be live today: `npx wrangler secret put GOOGLE_MAPS_API_KEY` and `npx wrangler secret put TICKETMASTER_API_KEY`.
