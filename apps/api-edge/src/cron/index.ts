/**
 * Cron handler entry point for the AgentPay Workers API.
 *
 * Cloudflare Workers Cron Triggers call the `scheduled` export on the module.
 * This file routes each cron event (by its cron expression) to the appropriate
 * handler.
 *
 * Cron schedule (defined in wrangler.toml [[triggers.crons]]):
 *   every 5 min  — liquidity monitor (matches liquidityService.ts CRON_INTERVAL_MS)
 *   every 15 min — reconciliation   (matches reconciliationDaemon.ts DEFAULT_INTERVAL_MS)
 *
 * Note: The Solana listener (30-second poll) is NOT migrated here because
 * Cloudflare Cron Triggers have a minimum interval of 1 minute.  The Solana
 * listener remains on Render until a Durable Object alarm is implemented.
 * See SOLANA_LISTENER_MIGRATION.md for the migration plan.
 *
 * Usage:
 *   The scheduled handler is wired into the Workers module export in
 *   src/index.ts as part of the default export object.
 */

import type { Env } from '../types';
import { runLiquidityCron } from './liquidity';
import { runReconciliation } from './reconciliation';
import { runPlatformWatch } from './platformWatch';
import { runFlightWatch } from './flightWatch';
import { runMondayPattern } from './mondayPattern';

/**
 * Routes a scheduled cron event to the correct handler by its cron expression.
 *
 * @param event  The ScheduledEvent from the Workers runtime.
 * @param env    The Workers environment bindings (same as c.env in Hono handlers).
 * @param ctx    ExecutionContext — use ctx.waitUntil() for async post-response work.
 */
export async function scheduledHandler(
  event: ScheduledEvent,
  env: Env,
  ctx: ExecutionContext,
): Promise<void> {
  // Route by cron expression (spaces matter — must match wrangler.toml exactly)
  switch (event.cron) {
    case '*/5 * * * *':
      ctx.waitUntil(runLiquidityCron(env));
      ctx.waitUntil(runPlatformWatch(env));
      ctx.waitUntil(runFlightWatch(env));
      break;

    case '*/15 * * * *':
      ctx.waitUntil(runReconciliation(env));
      break;

    case '0 9 * * 1':
      ctx.waitUntil(runMondayPattern(env));
      break;

    default:
      console.warn('[cron] unknown cron expression:', event.cron);
  }
}
