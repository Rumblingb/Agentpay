# Ace — Voice-First AI Travel Concierge

<p align="center">
  <strong>Say the trip once. Ace books it.</strong><br>
  UK rail · India rail · No service fee until May 2026
</p>

<p align="center">
  <a href="https://testflight.apple.com/join/agentpay"><img src="https://img.shields.io/badge/iOS-TestFlight-0d96f6?logo=apple&logoColor=white" alt="TestFlight"></a>
  <a href="https://agentpay.gg/join"><img src="https://img.shields.io/badge/Early_Access-agentpay.gg%2Fjoin-4ade80" alt="Early Access"></a>
  <a href="https://github.com/Rumblingb/Agentpay/actions/workflows/ci.yml"><img src="https://github.com/Rumblingb/Agentpay/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <img src="https://img.shields.io/badge/status-live_beta-4ade80" alt="Live Beta">
</p>

---

## What Ace is

Ace is a voice-first AI travel concierge that lives on your phone. You speak once, naturally. Ace finds the route, applies your railcard, quotes the fare, takes one tap to confirm, and delivers a ticket to your inbox — without you touching a form or switching a tab.

It is not a chatbot. It is not a booking engine with a voice layer bolted on. Ace is an economic agent: it holds your preferences, executes autonomously, and stays with the trip after booking — watching for delays, platform changes, and disruptions.

> "Book a train from London Paddington to Bristol Temple Meads, tomorrow morning, cheapest."
>
> *Ace: Done. £24.50 · 07:04 depart · ticket to your inbox.*

---

## Demo

<!-- Drop demo.mp4 into the repo root or link to a hosted video -->
<!-- [![Watch the demo](apps/meridian/assets/ace-face-render.png)](https://agentpay.gg/join) -->

**[→ Try it yourself on TestFlight](https://testflight.apple.com/join/agentpay)**

---

## Key capabilities

| Feature | Status |
|---------|--------|
| Voice booking — UK rail (National Rail / Darwin) | ✅ Live |
| Voice booking — India rail (IRCTC) | ✅ Live |
| Railcard auto-detection + discount | ✅ Live |
| UPI payment (India) | ✅ Live |
| Stripe payment (UK) | ✅ Live |
| Platform change push alerts | ✅ Live |
| Live disruption monitoring | ✅ Live |
| Receipt + wallet pass | ✅ Live |
| AceFace — GPU-rendered 3D voice presence | ✅ Live |
| EU rail (Rail Europe) | 🔜 Next |
| Flights (Duffel) | 🔜 Next |
| Hotels | 🔜 Q2 |
| Android | 🔜 Q2 |

---

## The Ace presence layer

AceFace is Ace's voice presence — a GPU-rendered sculptural bust that reacts in real-time to speech energy, mic amplitude, and phase state. It is not decorative.

- **Metal GPU pipeline** — @shopify/react-native-skia, runs on the UI thread via Reanimated worklets
- **11 render layers** — atmospheric halo, listening rings, 3D bust PNG, focus field, key light, rim light, inner shadow, lower-face tension, mouth cavity + lip line, ghost rim, audio-reactive corona
- **Real speech sync** — TTS amplitude drives jaw, viseme-oo, viseme-ee blend shapes at ~60fps
- **Phase-aware** — idle / listening / thinking / confirming / executing / done / error each have distinct animation signatures
- **No hallucination silence** — CF Whisper hallucination detection + OpenAI Whisper fallback means Ace never transcribes "Thank you for watching." as a booking intent

---

## Architecture

```
apps/meridian/          React Native / Expo iOS app (the Ace experience)
  ├── components/AceFaceSkia.tsx    GPU presence layer (Skia + Reanimated)
  ├── components/AceBrain.tsx       Runtime selector (3D / Skia / SVG fallback)
  ├── app/(main)/converse.tsx       Voice conversation + confirm card
  ├── app/(main)/journey/           Live trip tracking
  ├── app/(main)/receipt/           Receipt + wallet pass
  └── lib/speech.ts                 STT proxy (Whisper via server-side API)

apps/api-edge/          Cloudflare Workers — public API surface
  ├── src/routes/concierge.ts       Ace AI concierge (Claude Sonnet)
  ├── src/routes/voice.ts           STT + TTS proxy (Whisper + ElevenLabs)
  ├── src/routes/rcm.ts             Revenue cycle management (hospital billing)
  └── src/cron/                     Platform watch, reconciliation, autonomy loop

dashboard/              Next.js — operator dashboard (app.agentpay.so)
  ├── app/join/                     DTC early access landing
  └── app/partner/                  Operator intake

Database: PostgreSQL via Supabase + Cloudflare Hyperdrive
AI: Claude Sonnet 4.6 (concierge) + Haiku 4.5 (classify/extract)
Voice: OpenAI Whisper (STT) + ElevenLabs Daniel (TTS)
Rail: Darwin SOAP (UK live) + IRCTC via RapidAPI (India live)
```

---

## Early access

**Travelers** — iOS TestFlight, no service fee until May 2026:
[agentpay.gg/join](https://agentpay.gg/join)

**Operators** — embed Ace into your travel product:
[agentpay.gg/partner](https://agentpay.gg/partner)

---

## AgentPay infrastructure

Ace runs on AgentPay — autonomous agent payment infrastructure. Every booking Ace executes goes through an AgentPassport (portable identity + spending policy) and settles on-chain.

- **AgentPassport** — portable agent identity with spending policy and trust graph
- **Policy engine** — per-merchant rules: amount caps, daily limits, approval thresholds
- **Multi-protocol** — x402, AP2, ACP, Solana Pay, Stripe (fiat), Razorpay (UPI)
- **Fee ledger** — every payment records a fee obligation; reconciler collects to treasury
- **First mainnet payment** — [`2wjGMoDn…P2cvFB9w`](https://solscan.io/tx/2wjGMoDnHT1HZpQx2zCwCArkoUHvoKdcwzuuDwYDccW47ZAgAJRd7btWn7tR75L1domf66C6MxrJQUqFP2cvFB9w)

### Quick start (agent API)

```bash
# 1. Register
POST https://api.agentpay.so/api/merchants/register
{ "name": "My Agent", "email": "you@example.com", "walletAddress": "<solana-wallet>" }
# → { merchantId, apiKey }

# 2. Create intent
POST https://api.agentpay.so/api/v1/payment-intents
{ "merchantId": "<id>", "agentId": "agent-01", "amount": 0.10, "currency": "USDC" }
# → { intentId, verificationToken, instructions }

# 3. Pay + verify
POST /api/v1/payment-intents/:intentId/verify
{ "txHash": "<solana-tx>" }

# 4. Receipt
GET /api/receipt/:intentId
```

### npm packages

```bash
npm install @agentpay/sdk       # JS / TypeScript SDK
npx @agentpayxyz/mcp-server    # MCP server for Claude Desktop
```

---

## Repository layout

```
apps/api-edge/     Cloudflare Workers API (primary public surface)
apps/meridian/     React Native iOS app (Ace)
dashboard/         Next.js operator dashboard
packages/          Shared libraries (bro-trip, etc.)
infra/prisma/      Database schema + SQL migrations
sdk/               TypeScript + Python SDKs
docs/              Architecture, test strategy, pitch decks
```

---

## Developer resources

- [QUICKSTART.md](QUICKSTART.md) — run your first payment in 5 minutes
- [INTEGRATION_GUIDE.md](INTEGRATION_GUIDE.md) — SDK, webhooks, protocol adapters
- [openapi.yaml](openapi.yaml) — full OpenAPI 3.1 spec
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — system design
- [docs/TEST_STRATEGY.md](docs/TEST_STRATEGY.md) — release test strategy

---

## License

Business Source License 1.1 — converts to AGPL-3.0 on 2029-01-01. Non-commercial use is free. Enterprise licenses: enterprise@agentpay.gg
