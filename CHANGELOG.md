# Changelog

---

## v0.2 — April 2026

**MCP server published. Mandate system live. Zero-API-key flow.**

The `@agentpayxyz/mcp-server` package is now on npm. Any MCP-compatible AI assistant — Claude, GPT-4o, anything running the Model Context Protocol — can now create governed mandates, vault external credentials, and settle payments without the developer writing a single line of integration code.

The headline feature in this release is the Capability Vault. A user approves a one-time OTP. AgentPay vaults their API key (Firecrawl, Perplexity, OpenAI, Browserbase, and more). Every future call from that agent proxies through AgentPay — the raw credential never touches the agent process again.

The mandate system is also live on the public API. A mandate is a durable record of what an agent is authorised to do: objective, budget cap, approval threshold, currency. The agent proposes. The human approves once. AgentPay enforces from that point on, including returning `approval_required` when a single action would exceed the threshold.

**What shipped:**
- `@agentpayxyz/mcp-server` — 30+ tools across mandates, capabilities, payments, and identity
- Remote MCP endpoint at `https://api.agentpay.so/api/mcp` with short-lived token minting
- Capability Vault with OTP-based key vaulting and governed proxy execution
- Mandate API: create, approve, execute, cancel, history
- AgentPassport: portable identity bundle, phone verification, inbox provisioning, credential linking
- Hosted MCP pricing tiers: Launch (free), Builder ($39/mo), Growth ($149/mo)

---

## v0.1.1 — March 2026

**India rail live. UPI funding. Dual-currency settlement.**

IRCTC integration via RapidAPI is live. Ace can book India rail — Rajdhani, Shatabdi, the full IRCTC inventory — in the same voice-first flow as UK rail.

UPI payment is live. `agentpay_create_human_funding_request` returns a UPI deep-link and QR payload the host can render inline. The user pays without leaving the chat. No redirect. No new tab.

Settlement now runs on two parallel rails: Stripe for GBP card payments, Razorpay for INR/UPI. Both produce verifiable receipts through the same AgentPay receipt endpoint.

**What shipped:**
- IRCTC route discovery and booking via `POST /api/concierge/intent`
- UPI funding request with QR and deep-link via `agentpay_create_human_funding_request`
- Razorpay webhook handler at `/webhooks/razorpay`
- Dual-currency receipt normalisation (GBP + INR)
- Platform watch cron: 5-minute polling for delay and platform change alerts

---

## v0.1.0 — February 2026

**UK rail live. First mandate executed. First mainnet payment.**

The first production booking happened on UK National Rail through the Darwin SOAP API. A real ticket, to a real inbox, paid end-to-end through AgentPay.

The first AgentPay mandate was executed against a live Stripe payment. The policy engine enforced the budget cap. The receipt was recorded on-chain. The agent had no access to the raw Stripe secret key.

Ace — the voice-first travel concierge — shipped to TestFlight. The voice pipeline runs Cloudflare Whisper for transcription, Claude Sonnet for intent extraction and concierge reasoning, and ElevenLabs Daniel for TTS. AceFace, the GPU-rendered presence layer, runs on the Metal pipeline at ~60fps via Reanimated worklets.

**What shipped:**
- Darwin SOAP integration (UK National Rail, live departures + booking)
- Stripe checkout sessions and webhook handler at `/webhooks/stripe`
- Concierge API: `POST /api/concierge/intent` — voice transcript → plan → confirm → execute
- AgentPassport: initial identity record with trust graph
- Ace iOS app in TestFlight
- First mainnet USDC settlement recorded on Solana

---

## Roadmap

- **April–May 2026:** EU rail (Rail Europe) · Flights (Duffel) · Weather integration
- **May–June 2026:** Hotels (Booking.com / Xotelo) · Buses (Busbud) · Android · Play Store
- **Q3 2026:** Multi-currency (Airwallex) · Africa + SE Asia + Middle East · M-Pesa
- **Q4 2026:** Ferries · Car hire · Full outdoor AI (emergency, activity booking, park permits)

[Full roadmap →](docs/ROADMAP.md)
