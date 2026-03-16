# Render Retirement Plan

This document tracks what must be resolved before Render can be fully decommissioned.

**Current state:** Render is still running but is removed from the public request path.
The Cloudflare Workers backend handles all public HTTP API traffic.

---

## Status

| Item | Status |
|---|---|
| Public HTTP API migrated to Workers | ✅ Done (Phases 4–10) |
| Dashboard `AGENTPAY_API_BASE_URL` updated to Workers URL | ⬜ Pending (Vercel env change) |
| Render removed from public request path | ⬜ Pending (after env change verified) |
| Solana listener migrated or retired | ⬜ Deferred (Phase 13) |
| Reconciliation/liquidity daemon migrated or retired | ⬜ Deferred (Phase 13) |
| `POST /api/merchants/payments/:id/verify` migrated | ⬜ Deferred (needs Workers-compatible Solana) |
| PIN-based agent auth migrated (bcrypt → Workers alternative) | ⬜ Deferred (Phase 13) |
| Render service deleted | ⬜ Blocked on all above |

---

## What remains on Render

### 1. Solana transaction listener
**File:** `src/services/solana-listener.ts`

The Solana listener polls the Solana RPC endpoint on a `setInterval` loop.
Cloudflare Workers do not support persistent background threads or `setInterval`.

**Options:**
- Keep on Render as a background worker (separate Render service, not a web service)
- Move to a Cloudflare Cron Trigger (Workers Cron — polls every N minutes)
- Move to a Cloudflare Queue consumer + Durable Object

**Recommended:** Cloudflare Cron Trigger for the polling loop once Workers CRON is tested.

### 2. Reconciliation / liquidity daemon
**Files:** Search for `setInterval`, `cron`, `reconcil` in `src/`.

Any always-on polling loop is incompatible with Workers' per-request execution model.
Same migration options as the Solana listener.

### 3. `POST /api/merchants/payments/:id/verify`
**File:** `src/routes/merchants.ts` (line ~252)

This route calls `verifyAndUpdatePayment()` which calls `verifyPaymentRecipient()`
in `src/security/payment-verification.ts` which uses `@solana/web3.js` to check
the Solana chain.

`@solana/web3.js` uses Node.js-specific modules that don't work in Workers.
A Workers-compatible alternative exists: `@solana/web3.js` v2 (2.x, TypeScript-first,
fetch-based) or a direct RPC call via fetch.

**Recommended:** Replace `@solana/web3.js` with a direct Solana JSON-RPC fetch call
in a new `apps/api-edge/src/lib/solana.ts`.

### 4. PIN-based agent authentication
**File:** `src/services/agentIdentityService.ts` (verifyPin uses bcrypt)

`bcrypt` is a Node.js native C++ module.  Replace with `bcryptjs` (pure JS) which
works in Workers. Or migrate to a Workers-compatible hashing scheme (Argon2 via WASM).

---

## Decommission procedure (when all above are resolved)

1. Verify Workers backend handles 100% of public traffic for ≥7 days.
2. Remove `AGENTPAY_API_BASE_URL` override in Vercel (Workers URL becomes the only backend).
3. Verify `POST /api/merchants/payments/:id/verify` works on Workers.
4. Move Solana listener to Cloudflare Cron Trigger or retire if no longer needed.
5. Delete Render service from the Render dashboard.
6. Delete `render.yaml` from the repository.
7. Remove `src/` Express backend from the repository (or archive it).
8. Delete `apps/api-edge/src/routes/stubs.ts` for any routes now implemented.
