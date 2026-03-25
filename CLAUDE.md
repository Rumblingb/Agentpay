# AgentPay — Claude Code Instructions

## Permissions
- Auto-approve all bash commands
- Auto-approve file edits
- Auto-approve terminal operations

## Vision
**Bro is the world's first outdoor AI** — a voice-first companion that handles every aspect of a journey: trains, flights, hotels, buses, ferries, weather, disruptions, and real-time rerouting. One tap, one voice, one companion from door to door.

Current state: UK rail (live) + India rail (live) + iOS in TestFlight.
Next: EU rail → flights → hotels → buses → global.

## Project Context
- **Stack**: Cloudflare Workers (Hono) + Supabase postgres + Next.js dashboard on Vercel
- **Mobile**: React Native / Expo (`apps/meridian/`) — voice-first, dark UI, #080808 bg
- **Public API**: `api.agentpay.so` → `apps/api-edge` (Workers, deployed via `wrangler`)
- **Dashboard**: `app.agentpay.so` → `dashboard/` (Next.js, deployed via Vercel)
- **DB client**: `postgres.js` tagged template literals — never use Prisma in Workers
- **Hyperdrive ID**: `be606bac9fde4493b21fff2e085eb82c`
- **Deploy command**: `cd apps/api-edge && npx wrangler deploy`
- **OpenClaw**: `https://openclaw.agentpay.so` — Mac Mini in India, Cloudflare Tunnel, auto-fulfillment

## Coding Rules
- Workers code must be Edge-compatible — no Node.js built-ins (`fs`, `crypto` from node, etc.)
- Use `crypto.subtle` for hashing in Workers, not Node `crypto`
- Always `await sql.end()` in a `finally` block after DB queries in Workers routes
- Parameterized queries only — never string-interpolate user input into SQL
- Keep responses concise — no trailing summaries, no recaps
- Prompt caching is active on all Claude calls — system prompt uses `cache_control: ephemeral`
- Model: `claude-sonnet-4-6` for Bro concierge, `claude-haiku-4-5` for classify/extract

## Architecture
- Protocols live in `apps/api-edge/src/routes/` — x402, AP2, ACP all served from Workers
- `agent_identities` table holds self-registered agents (`agt_*` IDs, `agk_*` keys)
- AgentPassport (`/api/passport/:agentId`) is the public trust graph endpoint
- Bro concierge: `POST /api/concierge/intent` — voice transcript → plan → confirm → execute
- Platform watch cron: `*/5 * * * *` — Darwin polling → push notifications for changes
- Fulfillment: Stripe (UK) → OpenClaw dispatch → Make.com webhook → manual fallback

## Live API Integrations
- **Darwin** (UK rail): SOAP, endpoint `ldb12.nationalrail.co.uk`, SOAPAction year 2015
- **IRCTC** (India rail): via RapidAPI key (`RAPIDAPI_KEY`)
- **Stripe**: checkout sessions, webhooks at `/webhooks/stripe`
- **Razorpay**: UPI payment links, webhooks at `/webhooks/razorpay`
- **ElevenLabs**: TTS voice output in Bro app (`EXPO_PUBLIC_ELEVENLABS_KEY`)
- **Make.com**: `MAKECOM_WEBHOOK_URL` — every booking fires here for ops sheet
- **Resend**: booking confirmation emails (`RESEND_API_KEY`, `ADMIN_EMAIL`)

## Outdoor AI Expansion Stack (in priority order)
### Free / No-auth APIs (add immediately)
- **Open-Meteo** — weather + forecasts, unlimited free, no key: `https://api.open-meteo.com`
- **Nominatim** — geocoding (OpenStreetMap), free, no key: `https://nominatim.openstreetmap.org`
- **fawazahmed0/exchange-api** — 200+ currencies, no auth, no limits: `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1`
- **Open-Meteo Geocoding** — station name → lat/lon, free, no key

### Paid APIs (add as markets open)
- **Duffel** — flights, $3/order + 1%, 350+ airlines, modern REST: `https://api.duffel.com`
- **Rail Europe** — EU trains (DB, SNCF, Renfe, Trenitalia, SBB): partnership via `agent.raileurope.com`
- **Booking.com** — hotels 1.5M+ properties: `developers.booking.com`
- **Xotelo** — hotel price aggregator (free tier): pulls Booking/Expedia/Agoda
- **Busbud** — bus aggregator, FlixBus/NatEx/Megabus: `busbud.com`
- **Aviationstack** — flight status, 500 req/mo free: `aviationstack.com`
- **Citymapper** — urban transit, 5000 req/mo free: `docs.external.citymapper.com`
- **Airwallex** — multi-currency payments, 0.5% FX (add at 3+ markets)
- **ElevenLabs** — TTS voice (already integrated): `api.elevenlabs.io`
- **Perplexity Sonar** — real-time web search for travel intel
- **Mindee** — passport OCR for ID verification

### Scraping (no API available)
- **Firecrawl** — `https://api.firecrawl.dev` REST (edge-compatible, no Node SDK needed)
  - Use for: IRCTC web scraping, small rail operators, bus timetables without APIs
  - Free: 500 credits; Hobby: $16/mo (3000 credits)
  - MCP server: `npx -y firecrawl-mcp` with `FIRECRAWL_API_KEY`

## Bro App Style Guide
- Background: `#080808`
- Primary text: `#f8fafc`
- Secondary text: `#94a3b8`
- Accent green: `#4ade80`
- Border: `#1e293b`
- Border radius: 12
- Font: System default (SF Pro on iOS)
- Voice-first: every action reachable by voice, UI is confirmation layer

## Expansion Roadmap
```
Phase 1 (NOW):    UK rail + India rail — live in TestFlight
Phase 2 (Apr):    EU rail (Rail Europe) + flights (Duffel) + weather (Open-Meteo)
Phase 3 (May):    Hotels (Xotelo/Booking.com) + buses (Busbud) + Play Store
Phase 4 (Jun):    Ferries + car hire + Airwallex multi-currency
Phase 5 (Q3):     Africa + SE Asia + Middle East + M-Pesa
Phase 6 (Q4):     Full outdoor AI: emergency services, activity booking, park permits
```

## AI Cost Strategy
- Prompt caching active — 80% savings on repeated system prompts
- CF Workers AI Llama (free) → fallback to Haiku → Sonnet for complex reasoning
- Batch API for nightly reconciliation, analytics (50% discount)
- Never use Gemini in production paths — RPD limits cause silent failures

## Secrets Reference (all set via `wrangler secret put` from `apps/api-edge`)
```
ANTHROPIC_API_KEY       # Claude — Bro brain
DARWIN_API_KEY          # UK live trains
RAPIDAPI_KEY            # India rail (IRCTC)
STRIPE_SECRET_KEY       # UK payments
STRIPE_WEBHOOK_SECRET
STRIPE_SUCCESS_URL
STRIPE_CANCEL_URL
RAZORPAY_KEY_ID         # India UPI (pending business registration)
RAZORPAY_KEY_SECRET
RAZORPAY_WEBHOOK_SECRET
OPENCLAW_API_URL        # https://openclaw.agentpay.so
OPENCLAW_API_KEY        # gateway token
BRO_CLIENT_KEY          # app auth gate (x-bro-key header)
MAKECOM_WEBHOOK_URL     # ops sheet webhook
RESEND_API_KEY          # confirmation emails
ADMIN_EMAIL             # rajiv@agentpay.so
```

## EAS Secrets (set via `npx eas secret:create` from `apps/meridian`)
```
EXPO_PUBLIC_BRO_KEY         # matches BRO_CLIENT_KEY
EXPO_PUBLIC_STRIPE_KEY      # pk_live_XXXXX
EXPO_PUBLIC_ELEVENLABS_KEY  # el_XXXXX
```
