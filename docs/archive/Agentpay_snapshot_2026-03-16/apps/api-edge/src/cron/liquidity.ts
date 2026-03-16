/**
 * Liquidity cron handler for Workers.
 *
 * Original: src/services/liquidityService.ts
 * Original interval: every 5 minutes
 *
 * Status: STUB — the liquidity bot is a demo/market-maker feature that uses:
 *   - Prisma (Node.js)
 *   - In-memory escrow service (src/escrow/trust-escrow.ts)
 *   - setTimeout for auto-completion (not compatible with Workers stateless model)
 *   - Marketplace emitter (SSE/WebSocket, not applicable in Workers)
 *
 * Migration path:
 *   1. Replace Prisma with postgres.js (createDb).
 *   2. Replace in-memory escrow with DB-persisted escrow_transactions table.
 *   3. Replace setTimeout auto-complete with a follow-up Cron Trigger.
 *   4. Remove SSE/WebSocket emitter calls (not needed for backend cron work).
 *
 * This stub logs a no-op so the cron fires without crashing until the real
 * implementation is ready.
 */

import type { Env } from '../types';

export async function runLiquidityCron(env: Env): Promise<void> {
  console.info('[cron/liquidity] tick — TODO: implement (deferred, see RENDER_RETIREMENT.md)');
  // No-op stub. The liquidity bot currently runs on Render (src/services/liquidityService.ts).
  // Migration requires: postgres.js + DB-persisted escrow + no setTimeout.
  void env; // suppress unused-var lint
}
