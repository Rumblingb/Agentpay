# AgentPay Protocol V1

## Overview

AgentPay is a payment protocol designed for AI agents to initiate and verify payments autonomously over Solana/USDC and Stripe fiat rails.

## Key Flows

### Agent Payment Flow
1. Agent registers with `POST /api/agents/register` to obtain an `agentId`.
2. Agent creates a payment intent with `POST /api/v1/payment-intents` (optionally including a PIN for human authorization).
3. Agent sends USDC to the `recipientAddress` on Solana using the provided `memo`.
4. Agent polls `GET /api/v1/payment-intents/:intentId` until `status === "verified"`.
5. Public verification available at `GET /api/verify/:txHash`.

### Fiat Flow
- On-ramp: `POST /api/fiat/onramp` → Stripe Checkout session for USD → USDC.
- Off-ramp: `POST /api/fiat/offramp` → Stripe payout to bank.
- Virtual card: `POST /api/fiat/issuing/create-card` → Stripe Issuing virtual card.

## Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /api/agents/register | None | Register agent identity |
| PATCH | /api/agents/update | API Key | Update agent info |
| POST | /api/agents/verify-pin | None | Verify agent PIN |
| POST | /api/agents/delegation/create | API Key | Create delegated spending key |
| POST | /api/agents/delegation/authorize | API Key | Activate delegation |
| POST | /api/agents/delegation/revoke | API Key | Revoke delegation |
| POST | /api/v1/payment-intents | None | Create payment intent |
| GET | /api/v1/payment-intents/:id | None | Get intent status |
| GET | /api/verify/:txHash | None | Public tx verification |
| POST | /api/fiat/onramp | API Key | Fiat on-ramp |
| POST | /api/fiat/offramp | API Key | Fiat off-ramp |
| POST | /api/fiat/issuing/create-card | API Key | Create virtual card |

## Response Format

All API responses use a consistent format:
- **Success**: `{ "success": true, "data": { ... } }`
- **Error**: `{ "error": "description" }`
