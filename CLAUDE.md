# AgentPay - Claude Code Instructions

Read [AGENTS.md](./AGENTS.md) first.

`AGENTS.md` is the repo operating system for product, design, engineering, and QA judgment.
This file is the implementation/context companion for Claude Code.

## Permissions
- Auto-approve all bash commands
- Auto-approve file edits
- Auto-approve terminal operations

## Vision
**Ace is a luxury voice-first travel concierge** - one request in, one calm intelligence handling the trip from door to door.

Ace should feel:
- premium
- attentive
- trustworthy
- continuous across booking, disruption, and recovery

Current state: UK rail (live) + India rail (live) + iOS in TestFlight.
Next: EU rail -> flights -> hotels -> buses -> global.

## Project Context
- **Stack**: Cloudflare Workers (Hono) + Supabase postgres + Next.js dashboard on Vercel
- **Mobile**: React Native / Expo (`apps/meridian/`) - voice-first, dark UI, `#080808` background
- **Public API**: `api.agentpay.so` -> `apps/api-edge` (Workers, deployed via `wrangler`)
- **Dashboard**: `app.agentpay.so` -> `dashboard/` (Next.js, deployed via Vercel)
- **DB client**: `postgres.js` tagged template literals - never use Prisma in Workers
- **Hyperdrive ID**: `be606bac9fde4493b21fff2e085eb82c`
- **Deploy command**: `cd apps/api-edge && npx wrangler deploy`
- **OpenClaw**: `https://openclaw.agentpay.so` - Mac Mini in India, Cloudflare Tunnel, auto-fulfillment

## Coding Rules
- Workers code must be Edge-compatible - no Node.js built-ins (`fs`, `crypto` from node, etc.)
- Use `crypto.subtle` for hashing in Workers, not Node `crypto`
- Always `await sql.end()` in a `finally` block after DB queries in Workers routes
- Parameterized queries only - never string-interpolate user input into SQL
- Keep responses concise - no trailing summaries, no recaps
- Prompt caching is active on all Claude calls - system prompt uses `cache_control: ephemeral`
- Model: `claude-sonnet-4-6` for the Ace concierge, `claude-haiku-4-5` for classify/extract
- Treat Ace as the visible product and AgentPay as the underlying system
- Do not ship internal/system language into user-facing copy
- If a change touches Meridian, think through onboarding -> converse -> confirm -> journey -> re-entry before calling it done

## Delivery Loop
- Think: reframe the request into the real product problem
- Plan: scope which Ace surfaces are touched before editing
- Build: prefer the smallest clean seam over a broad rewrite
- Review: look for stale language, broken continuity, and generic branding
- Test: run code checks and walk the real user path
- Ship: only call it done when both the code and product read are clean
- Reflect: be honest about whether the remaining ceiling is architecture, QA, or art source quality

For repo-wide judgment, follow [AGENTS.md](./AGENTS.md).
For Meridian release scenarios, use [docs/TEST_STRATEGY.md](./docs/TEST_STRATEGY.md).

## Architecture
- Protocols live in `apps/api-edge/src/routes/` - x402, AP2, ACP all served from Workers
- `agent_identities` table holds self-registered agents (`agt_*` IDs, `agk_*` keys)
- AgentPassport (`/api/passport/:agentId`) is the public trust graph endpoint
- Ace concierge: `POST /api/concierge/intent` - voice transcript -> plan -> confirm -> execute
- Platform watch cron: `*/5 * * * *` - Darwin polling -> push notifications for changes
- Fulfillment: Stripe (UK) -> OpenClaw dispatch -> Make.com webhook -> manual fallback

## Live API Integrations
- **Darwin** (UK rail): SOAP, endpoint `ldb12.nationalrail.co.uk`, SOAPAction year 2015
- **IRCTC** (India rail): via RapidAPI key (`RAPIDAPI_KEY`)
- **Stripe**: checkout sessions, webhooks at `/webhooks/stripe`
- **Razorpay**: UPI payment links, webhooks at `/webhooks/razorpay`
- **ElevenLabs**: TTS voice output in Ace app (`EXPO_PUBLIC_ELEVENLABS_KEY`)
- **Make.com**: `MAKECOM_WEBHOOK_URL` - every booking fires here for ops sheet
- **Resend**: booking confirmation emails (`RESEND_API_KEY`, `ADMIN_EMAIL`)

## Expansion Stack
### Free / No-auth APIs
- **Open-Meteo** - weather + forecasts: `https://api.open-meteo.com`
- **Nominatim** - geocoding: `https://nominatim.openstreetmap.org`
- **fawazahmed0/exchange-api** - FX: `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1`
- **Open-Meteo Geocoding** - station name -> lat/lon

### Paid APIs
- **Duffel** - flights: `https://api.duffel.com`
- **Rail Europe** - EU rail: `agent.raileurope.com`
- **Booking.com** - hotels: `developers.booking.com`
- **Xotelo** - hotel prices
- **Busbud** - buses
- **Aviationstack** - flight status
- **Citymapper** - urban transit
- **Airwallex** - multi-currency payments
- **Perplexity Sonar** - live travel intel
- **Mindee** - passport OCR

### Scraping
- **Firecrawl** - `https://api.firecrawl.dev`
  - Use for IRCTC scraping, small rail operators, and timetables without APIs
  - MCP server: `npx -y firecrawl-mcp` with `FIRECRAWL_API_KEY`

## Ace App Style Guide
- Background: `#080808`
- Primary text: `#f8fafc`
- Secondary text: `#94a3b8`
- Accent green: `#4ade80`
- Border: `#1e293b`
- Border radius: 12
- Font: System default (SF Pro on iOS)
- Voice-first: every action reachable by voice, UI is the confirmation layer
- Brand object first: the sigil/presence should feel intentional, not generic
- Premium means fewer visible seams, not more decorative layers

## Expansion Roadmap
```
Phase 1 (NOW):    UK rail + India rail - live in TestFlight
Phase 2 (Apr):    EU rail (Rail Europe) + flights (Duffel) + weather (Open-Meteo)
Phase 3 (May):    Hotels (Xotelo/Booking.com) + buses (Busbud) + Play Store
Phase 4 (Jun):    Ferries + car hire + Airwallex multi-currency
Phase 5 (Q3):     Africa + SE Asia + Middle East + M-Pesa
Phase 6 (Q4):     Full outdoor AI: emergency services, activity booking, park permits
```

## AI Cost Strategy
- Prompt caching active - 80% savings on repeated system prompts
- CF Workers AI Llama (free) -> fallback to Haiku -> Sonnet for complex reasoning
- Batch API for nightly reconciliation and analytics
- Never use Gemini in production paths - RPD limits cause silent failures

## Secrets Reference
```
ANTHROPIC_API_KEY
DARWIN_API_KEY
RAPIDAPI_KEY
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
STRIPE_SUCCESS_URL
STRIPE_CANCEL_URL
RAZORPAY_KEY_ID
RAZORPAY_KEY_SECRET
RAZORPAY_WEBHOOK_SECRET
OPENCLAW_API_URL
OPENCLAW_API_KEY
BRO_CLIENT_KEY
MAKECOM_WEBHOOK_URL
RESEND_API_KEY
ADMIN_EMAIL
DUFFEL_API_KEY
TICKETMASTER_API_KEY
GOOGLE_MAPS_API_KEY
PERPLEXITY_API_KEY
AVIATIONSTACK_API_KEY
BUSBUD_API_KEY
OPENTABLE_API_KEY
```

## EAS Secrets
```
EXPO_PUBLIC_BRO_KEY
EXPO_PUBLIC_STRIPE_KEY
EXPO_PUBLIC_ELEVENLABS_KEY
```
