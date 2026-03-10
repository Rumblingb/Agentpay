# ADR-004: Multi-Protocol Support (PAL — Protocol Abstraction Layer)

**Status:** Accepted  
**Date:** 2026-03-10  
**Deciders:** Engineering / Product

---

## Context

AI agent payment standards are nascent and fragmented:
- **x402** — HTTP 402 paywall standard from Coinbase
- **ACP** — Agent Communication Protocol
- **AP2** — Agent Payment Protocol v2
- **Solana Pay** — Native USDC on Solana
- **Stripe** — Fiat card/bank payments

No single standard dominates. Enterprise customers and AI frameworks each have different preferences.

## Decision

Build a Protocol Abstraction Layer (PAL) that:
1. Accepts requests in any supported protocol format
2. Routes to the appropriate adapter
3. Normalizes to a canonical `PaymentIntent` internally
4. Returns responses in the expected protocol format

This means AgentPay is **protocol-neutral** — it doesn't bet on one winning standard.

## Implementation

- `src/services/protocolRouter.ts` — PAL entry point
- `src/protocols/acp.ts` — ACP adapter
- `src/protocols/ap2.ts` — AP2 adapter
- `POST /api/protocol/detect` — Auto-detect protocol from request shape

## Trade-offs

**Benefits:**
- Single integration for developers regardless of their agent framework
- Can add new protocols without changing core payment logic
- Positions AgentPay as the reference implementation for all standards

**Costs:**
- Maintenance burden for each protocol adapter
- AP2 currently uses in-memory state (tracked in ADR-003)
- Protocol detection logic can be ambiguous if request shapes overlap

## Protocol Deprecation Policy

If a protocol sees no usage for 12 months, it is deprecated with a 6-month notice period before removal.

---

**Related:** `src/protocols/`, `src/services/protocolRouter.ts`, `docs/ARCHITECTURE.md`
