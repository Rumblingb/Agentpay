# Solana Listener Migration Plan

The Solana listener (`src/services/solana-listener.ts`) polls the Solana RPC
every **30 seconds** to check pending payment intents on-chain.

## Why it cannot run in Workers (yet)

1. **Sub-minute interval** — Cloudflare Cron Triggers have a minimum interval
   of 1 minute.  The listener needs 30-second resolution.

2. **`@solana/web3.js` v1** — The current listener imports `@solana/web3.js`
   which uses Node.js-specific modules (`ws`, `node:crypto`, `node-fetch`) that
   do not work in the Workers runtime.

3. **Stateful interval** — The listener maintains a `setInterval` handle and
   tracks the last-checked slot in memory.  Workers are stateless per invocation.

## Migration options

### Option A: Cloudflare Durable Object alarm (recommended)
Durable Objects support `setAlarm(timestamp)` which can fire at any interval,
including sub-minute.  The alarm can call the Solana RPC and update the DB.

Steps:
1. Create a `SolanaListenerDO` Durable Object class.
2. On `fetch('/start')`, schedule the first alarm for `Date.now() + 30_000`.
3. On `alarm()`, run one poll cycle, then schedule the next alarm.
4. Add `[[durable_objects]]` binding to `wrangler.toml`.

### Option B: Stay on Render as a separate background worker
Remove the listener from the web service and run it as a separate Render
Background Worker service (no HTTP port, just the interval loop).

This is the lowest-risk option for the beta launch.

### Option C: Upgrade to `@solana/web3.js` v2
`@solana/web3.js` v2 (2.x) is TypeScript-first and uses `fetch` + `AbortSignal`
instead of Node.js-specific modules.  It works in Workers.

Steps:
1. Replace `import { Connection, ... } from '@solana/web3.js'` with v2 equivalents.
2. Replace `@solana/spl-token` v0.3 with v0.4+ (v2-compatible).
3. Use a Cloudflare Cron Trigger at `*/1 * * * *` (1-minute minimum) or
   a Durable Object alarm for 30-second granularity.

## Current state

The listener remains on Render as the web service daemon until one of the
above options is implemented.

The v1 intent verify endpoint (`POST /api/merchants/payments/:id/verify`) also
depends on the Solana RPC — it is currently returning 501 on the Workers backend
for the same reason.

## Recommended next step for beta

Keep on Render (Option B) for now.  After the public beta stabilises, implement
Option A (Durable Object alarm) which gives sub-minute resolution without
the `@solana/web3.js` v2 migration overhead.
