import type { Env } from '../types';
import { runAutoRecoverySweep } from '../lib/bookingRecovery';

export async function runBookingRecoveryCron(env: Env): Promise<void> {
  const startedAt = Date.now();
  try {
    const result = await runAutoRecoverySweep(env, { limit: 100 });
    console.info('[cron/booking-recovery] run complete', {
      scanned: result.scanned,
      candidates: result.candidates,
      acted: result.acted,
      durationMs: Date.now() - startedAt,
    });
  } catch (err: unknown) {
    console.error('[cron/booking-recovery] run failed', {
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - startedAt,
    });
  }
}
