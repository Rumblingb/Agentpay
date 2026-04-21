# Ace — Voice-First AI Travel Concierge

<p align="center">
  <strong>Say the trip once. Ace books it.</strong><br>
  UK rail · India rail · No service fee until May 2026
</p>

<p align="center">
  <a href="https://testflight.apple.com/join/agentpay"><img src="https://img.shields.io/badge/iOS-TestFlight-0d96f6?logo=apple&logoColor=white" alt="TestFlight"></a>
  <a href="https://agentpay.gg/join"><img src="https://img.shields.io/badge/Early_Access-agentpay.gg%2Fjoin-4ade80" alt="Early Access"></a>
  <img src="https://img.shields.io/badge/status-live_beta-4ade80" alt="Live Beta">
</p>

---

Ace is a voice-first AI travel concierge built on [AgentPay](../../README.md) infrastructure. You speak once, naturally. Ace finds the route, applies your railcard, quotes the fare, takes one tap to confirm, and delivers a ticket to your inbox — without you touching a form or switching a tab.

It is not a chatbot. It is not a booking engine with a voice layer bolted on. Ace is an economic agent: it holds your preferences, executes autonomously, and stays with the trip after booking — watching for delays, platform changes, and disruptions.

> "Book a train from London Paddington to Bristol Temple Meads, tomorrow morning, cheapest."
>
> *Ace: Done. £24.50 · 07:04 depart · ticket to your inbox.*

---

## What's live

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

## The presence layer

AceFace is Ace's voice presence — a GPU-rendered sculptural bust that reacts in real-time to speech energy, mic amplitude, and phase state. It is not decorative.

- **Metal GPU pipeline** — `@shopify/react-native-skia`, runs on the UI thread via Reanimated worklets
- **11 render layers** — atmospheric halo, listening rings, 3D bust, focus field, key light, rim light, inner shadow, lower-face tension, mouth cavity + lip line, ghost rim, audio-reactive corona
- **Real speech sync** — TTS amplitude drives jaw and viseme blend shapes at ~60fps
- **Phase-aware** — idle / listening / thinking / confirming / executing / done / error each have distinct animation signatures
- **No hallucination silence** — Cloudflare Whisper hallucination detection + OpenAI Whisper fallback

---

## App structure

```
app/
  (main)/
    converse.tsx       Voice conversation + confirm card
    journey/           Live trip tracking
    receipt/           Receipt + wallet pass
    settings/          User preferences, railcard, saved routes

components/
  AceFaceSkia.tsx      GPU presence layer (Skia + Reanimated)
  AceBrain.tsx         Runtime selector (3D / Skia / SVG fallback)
  ConfirmCard.tsx      Fare confirmation UI

lib/
  speech.ts            STT proxy (Whisper via server-side API)
  tts.ts               ElevenLabs TTS integration
  booking.ts           Concierge API client

assets/
  ace-face-render.png  AceFace reference render
  *.glb                3D model assets
```

---

## How Ace uses AgentPay

Every booking Ace executes goes through AgentPay infrastructure:

- **Governed mandate** — Ace creates a mandate for each booking intent. The user approves the fare. AgentPay enforces the budget and executes the settlement.
- **AgentPassport** — Ace holds a portable identity with spending policy, trust graph, and interaction history.
- **Multi-rail settlement** — Stripe for UK card payments, Razorpay/UPI for India, Solana/USDC as an alternative settlement layer.
- **Policy engine** — per-user rules: fare caps, daily limits, railcard preferences, approval thresholds.

---

## Running locally

```bash
# From the repo root
npm ci

# Set up the app environment
cd apps/meridian
cp .env.example .env  # Add EXPO_PUBLIC_BRO_KEY, EXPO_PUBLIC_ELEVENLABS_KEY

# Start the Expo dev server
npx expo start
```

Requires an iOS device or simulator. The voice pipeline (Whisper STT + ElevenLabs TTS) connects to the live API at `api.agentpay.so` by default.

To point at a local API:

```bash
EXPO_PUBLIC_API_URL=http://localhost:8787 npx expo start
```

---

## Early access

**Travelers** — iOS TestFlight, no service fee until May 2026:
[agentpay.gg/join](https://agentpay.gg/join)

**Operators** — embed Ace into your travel product:
[agentpay.gg/partner](https://agentpay.gg/partner)
