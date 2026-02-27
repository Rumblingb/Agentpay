# AgentPay Twitter Micropayments Bot

A Clawbot-style Twitter bot that brings instant Solana USDC micropayments to X/Twitter — powered by the [AgentPay](../../README.md) protocol.

## Features

| Feature | Description |
|---------|-------------|
| **Tweet → Payment** | `@AgentPay tip 0.25 to @user` creates and replies with a pay link |
| **Send / Pay aliases** | `send 1 USDC to @user` and `pay 0.10 to this` work identically |
| **#paywall support** | Tweets containing `#paywall $0.05` get an "Unlock for $0.05" reply |
| **On-chain verification** | After Solana confirmation the bot tweets a signed certificate |
| **Wallet linking** | Users DM "Connect Wallet" to link a non-custodial delegated key |
| **Daily spend limits** | Per-user $20/day hard-cap with configurable threshold |
| **PIN authorization** | Sensitive payments require PBKDF2 PIN hash via AgentPay verify-pin API |
| **Reputation display** | Every verification tweet includes the sender's AgentPay trust score |

## Quick Start

### Prerequisites

- Node.js ≥ 20
- An [AgentPay](../../README.md) backend running (or using the hosted service)
- A Twitter Developer App with **OAuth 1.0a** + **v2 API** access

### 1. Clone and install

```bash
cd apps/twitter-bot
cp .env.example .env
npm install
```

### 2. Configure `.env`

| Variable | Description |
|----------|-------------|
| `TWITTER_API_KEY` | Twitter app key |
| `TWITTER_API_SECRET` | Twitter app secret |
| `TWITTER_ACCESS_TOKEN` | Bot account access token |
| `TWITTER_ACCESS_SECRET` | Bot account access secret |
| `TWITTER_BEARER_TOKEN` | App-only bearer token (for streaming) |
| `TWITTER_BOT_HANDLE` | Bot's @handle without the @ (default: `AgentPay`) |
| `AGENTPAY_BASE_URL` | AgentPay backend URL |
| `AGENTPAY_API_KEY` | AgentPay API key |
| `AGENTPAY_MERCHANT_ID` | Default merchant UUID for received tips |
| `DAILY_LIMIT_USD` | Per-user hard daily cap in USD (default: `20`) |
| `SOLANA_WEBHOOK_SECRET` | Shared secret for Solana confirmation webhooks. Generate a strong value with `openssl rand -hex 32` |

### 3. Run

```bash
# Development (auto-reload)
npm run dev

# Production
npm run build
npm start
```

The bot starts two concurrent processes:
1. **Express webhook server** on `$PORT` (default `4000`)
2. **Twitter v2 filtered stream** for `@AgentPay` mentions

## Supported Tweet Commands

```
# Tip a user
@AgentPay tip 0.25 to @alice

# Send a fixed amount
@AgentPay send 1 USDC to @alice

# Pay the tweet author
@AgentPay pay 0.10 to this

# Developer paywall tag (post this in your own tweet)
Check out my new tutorial! #paywall $0.05
```

## Webhook Integration

The bot exposes `POST /webhook/solana` to receive payment confirmation events from the AgentPay backend.

Configure your AgentPay `WEBHOOK_URL` to point here. The payload should be:

```json
{
  "txHash": "4xYz...",
  "amountUsd": "0.25",
  "currency": "USDC",
  "senderHandle": "alice",
  "senderAgentId": "twitter:alice",
  "receiverHandle": "bob",
  "replyToTweetId": "1234567890"
}
```

Secure the endpoint by setting `SOLANA_WEBHOOK_SECRET` — the server validates the `X-AgentPay-Signature: sha256=<secret>` header.

## Architecture

```
apps/twitter-bot/
├── config/
│   └── twitterClient.ts          Twitter API v2 client factory
├── src/
│   ├── index.ts                  Entry point: stream + webhook server
│   ├── handlers/
│   │   ├── incomingTweets.ts     Route parsed commands to handlers
│   │   ├── tipping.ts            tip / send / pay flow
│   │   ├── payLinks.ts           #paywall flow
│   │   └── verification.ts      Post signed payment certificates
│   └── services/
│       ├── agentpayClient.ts     AgentPay REST API wrapper + daily limits
│       └── tweetParser.ts        Regex-based tweet command parser
└── tests/
    ├── tweetParser.test.ts
    ├── agentpayClient.test.ts
    ├── tipping.test.ts
    ├── payLinks.test.ts
    └── verification.test.ts
```

## Daily Spend Limits

By default each Twitter user is limited to **$20 USD per day**. The limit is tracked in memory (replace `spendStore` in `agentpayClient.ts` with Redis or Supabase for production persistence).

When a user exceeds the limit:
- The bot replies: "You've reached your daily spend limit."
- No payment intent is created.

## Running Tests

```bash
npm test
```

Tests cover tweet parsing, payment flow, PIN authorization, delegated keys and spending limits — all without requiring live Twitter or AgentPay credentials.
