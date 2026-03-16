# AgentPay — FCA Sandbox Use Case

## Title
**Verifying AI-to-Merchant Micro-Payments on Solana in Under 2 Seconds**

---

## Summary

This sandbox demonstrates a production-grade **HTTP 402 Payment Required** flow enabling autonomous AI agents to pay human merchants for data, API calls, or content — without a human in the loop.

The AgentPay engine sits between AI agents and the Solana blockchain, providing:
1. A standardised REST API agents can call with a single HTTP request.
2. Cryptographic on-chain verification that the correct merchant actually received funds.
3. An automated webhook delivery system so the merchant's agent is notified instantly.

---

## Scenario

| Role | Actor | Description |
|------|-------|-------------|
| Merchant | `NewsAPI Ltd` | Sells real-time headlines at £0.001 per request |
| AI Agent | `ResearchBot v2` | Autonomous agent that purchases news to answer user queries |
| Payment | Devnet USDC | SPL-token on Solana devnet (equivalent to mainnet behaviour) |

---

## Step-by-Step Flow

### 1. Merchant registers (once)
```http
POST /api/merchants/register
{
  "name":           "NewsAPI Ltd",
  "email":          "ops@newsapi.example",
  "walletAddress":  "9B5X2FWc4PQHqbXkhmr8vgYKHjgP7V8HBzMgMTf8Hkqo",
  "webhookUrl":     "https://newsapi.example/webhooks/agentpay"
}
→ { "merchantId": "...", "apiKey": "ag_live_..." }
```

### 2. AI Agent requests a payment token (each purchase)
```http
POST /api/merchants/payments
Authorization: Bearer ag_live_...
{
  "amountUsdc":       0.001,
  "recipientAddress": "9B5X2FWc4PQHqbXkhmr8vgYKHjgP7V8HBzMgMTf8Hkqo",
  "expiryMinutes":    5
}
→ { "transactionId": "...", "paymentId": "..." }
```

### 3. AI Agent sends USDC on Solana and submits the hash
```http
POST /api/merchants/payments/{transactionId}/verify
Authorization: Bearer ag_live_...
{
  "transactionHash": "5J7KvB8mN2pQrXtY..."
}
→ { "verified": true, "payer": "FpCMFD...", "message": "Payment confirmed!" }
```
**Total round-trip: < 2 seconds on devnet.**

### 4. Merchant's agent is notified via webhook
```json
POST https://newsapi.example/webhooks/agentpay
X-AgentPay-Signature: sha256=<hmac>

{
  "event":            "payment.verified",
  "transactionId":    "...",
  "amountUsdc":       0.001,
  "verified":         true,
  "timestamp":        "2026-02-21T00:00:00.000Z"
}
```
The merchant's backend verifies the HMAC signature and unlocks the article.

---

## What the FCA Can Observe

| Observable | Where |
|------------|-------|
| Live dashboard (transactions, stats, API key management) | `https://agentpay.vercel.app` |
| API health check | `GET /health` |
| Every verify attempt (incl. failures) | `payment_audit_log` table |
| Webhook delivery log (retries, response codes) | `webhook_events` table |
| Source code | `https://github.com/Rumblingb/Agentpay` |

---

## Security Assurances

- **AML Audit Trail**: Every verify attempt logged with IP and outcome.
- **Recipient Verification**: Engine rejects tx hashes not addressed to the registered wallet.
- **Key Security**: PBKDF2 (100 000 iterations) — never stored in plaintext.
- **Circuit Breaker**: Graceful degradation when blockchain RPC is unavailable.

---

## Network & Environment

| Property | Value |
|----------|-------|
| Blockchain | Solana Devnet |
| Token | Devnet USDC (SPL) |
| Confirmation depth | 2 blocks (≈ 1 s) |
| API region | Render (EU West) |
| Dashboard | Vercel (Edge Network) |
