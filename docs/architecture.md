# AgentPay — Architecture Overview

## System Layers

AgentPay is structured as three cooperating layers:

```
┌───────────────────────────────────────────────────────────┐
│   Layer 1 — Protocol Translation (Input)                  │
│   Normalises API requests from AI Agents / Merchants      │
│   • Joi input validation                                  │
│   • Solana address format check                           │
│   • Rate limiting (express-rate-limit)                    │
└───────────────────┬───────────────────────────────────────┘
                    │
                    ▼
┌───────────────────────────────────────────────────────────┐
│   Layer 2 — Business Logic (Express Engine)               │
│   • Merchant auth (PBKDF2 + key_prefix O(1) lookup)       │
│   • Payment request creation & tracking                   │
│   • Webhook dispatch (HMAC-SHA256 signed, retry ×3)       │
│   • Audit logging (append-only payment_audit_log)         │
└───────────────────┬───────────────────────────────────────┘
                    │
                    ▼
┌───────────────────────────────────────────────────────────┐
│   Layer 3 — Settlement & Verification (Blockchain)        │
│   • Solana RPC call — getParsedTransaction                │
│   • SPL-token transfer extraction                         │
│   • Recipient address verification (CRITICAL SECURITY)    │
│   • Confirmation depth check (≥ 2 blocks)                 │
│   • Circuit Breaker (open after 3 RPC failures / 30 s)    │
└───────────────────────────────────────────────────────────┘
```

## Data Flow: Agent → Engine → Blockchain

```
AI Agent                  AgentPay Engine              Solana Network
   │                            │                            │
   │  POST /api/merchants/      │                            │
   │  payments/:id/verify       │                            │
   │  {transactionHash}         │                            │
   │──────────────────────────>│                            │
   │                            │  getParsedTransaction()    │
   │                            │──────────────────────────>│
   │                            │  <parsed tx + meta>        │
   │                            │<──────────────────────────│
   │                            │                            │
   │                            │ ✓ Verify recipient address  │
   │                            │ ✓ Verify confirmation depth │
   │                            │ ✓ Write audit_log entry     │
   │                            │ ✓ Update transaction status │
   │  {verified: true}          │                            │
   │<──────────────────────────│                            │
   │                            │  POST merchant.webhookUrl  │
   │                            │  (async, HMAC signed)      │
   │                            │──────────────>  Merchant   │
```

## Component Map

| Component | Path | Responsibility |
|-----------|------|----------------|
| API Server | `src/server.ts` | Express app, rate limits, health check |
| Merchant Routes | `src/routes/merchants.ts` | CRUD for merchants & payments |
| Auth Middleware | `src/middleware/auth.ts` | Bearer token → merchant lookup |
| Payment Verification | `src/security/payment-verification.ts` | Solana RPC + circuit breaker |
| Merchants Service | `src/services/merchants.ts` | Registration, key rotation |
| Transactions Service | `src/services/transactions.ts` | Create, verify, query payments |
| Webhooks Service | `src/services/webhooks.ts` | Signed delivery with retry |
| Audit Service | `src/services/audit.ts` | Append-only FCA audit log |
| DB Pool | `src/db/index.ts` | PostgreSQL connection pool |
| DB Schema | `src/db/init.ts` | Table + index creation |

## Database Schema (simplified)

```
merchants
  id, name, email, wallet_address, webhook_url
  api_key_hash, api_key_salt, key_prefix (indexed)
  is_active, created_at, updated_at

transactions
  id, merchant_id → merchants
  payment_id, amount_usdc, recipient_address
  payer_address, transaction_hash
  status (pending | confirmed | failed | expired)
  webhook_status (not_sent | sent | failed)
  confirmation_depth, required_depth
  expires_at, created_at, updated_at

payment_audit_log   ← APPEND-ONLY (FCA AML)
  id, merchant_id, ip_address
  transaction_signature, transaction_id
  endpoint, method, succeeded, failure_reason
  created_at

webhook_events
  id, merchant_id, event_type, transaction_id
  webhook_url, payload, status
  retry_count, response_status, last_attempt_at
```
