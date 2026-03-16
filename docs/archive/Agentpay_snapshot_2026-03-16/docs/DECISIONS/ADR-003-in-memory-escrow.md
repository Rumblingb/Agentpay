# ADR-003: In-Memory Escrow (Trust-Escrow)

**Status:** Deprecated — to be replaced  
**Date:** 2026-03-10  
**Deciders:** Engineering

---

## Context

`src/escrow/trust-escrow.ts` maintains escrow state in a JavaScript `Map` in memory. On server restart, all escrow balances are lost.

Separately, `src/routes/escrow.ts` persists escrow operations to the `escrow_transactions` PostgreSQL table.

## Why It Exists

The in-memory escrow was built first as a fast prototype. The persistent escrow was added later. Both still exist and are used in different code paths:
- `trust-escrow.ts` (in-memory) is used by the AgentPay Network hire/complete flow
- `escrow.ts` routes persist to `escrow_transactions`

## Problem

This is a **critical production gap**. Any server restart (deployment, crash, scale event) loses all in-flight escrow state. Funds can appear locked with no record of release.

## Decision

**This ADR documents the problem and records the decision to fix it as P0.**

The in-memory escrow will be replaced by:
1. All escrow state stored in `escrow_transactions` table
2. `trust-escrow.ts` becomes a thin wrapper around DB operations
3. No `Map`-based state — all reads/writes go to the database

## Current Risk Mitigation

Until fixed:
- All escrow amounts are small (test/dev environment)
- No real USDC is at risk currently
- Solana escrow is on devnet

## Migration Plan

1. Update `src/escrow/trust-escrow.ts` to read/write `escrow_transactions` table
2. Update the AgentPay Network hire/complete routes to use the persistent path
3. Remove the in-memory `Map` and all initialization code
4. Add escrow lifecycle test: create → persist → server restart → verify still accessible

---

**Priority:** P0 — block any real-money deployment until resolved  
**Related:** `docs/DATA_MODEL.md`, `src/escrow/trust-escrow.ts`, `src/routes/escrow.ts`
