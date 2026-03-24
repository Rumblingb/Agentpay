/**
 * platformWatch.ts — Darwin disruption detection cron
 *
 * Runs every 5 minutes. Queries for upcoming booked journeys, polls Darwin
 * for their current status, and pushes a notification via Expo if:
 *   - Platform has changed
 *   - Service has been cancelled
 *   - Service is running > 10 minutes late (sent once)
 *
 * Job metadata schema expected:
 *   platformWatchActive: true
 *   pushToken: "ExponentPushToken[xxx]"
 *   departureDatetime: "2026-03-24T17:42:00"
 *   trainDetails.origin: station name  (used for CRS lookup)
 *   trainDetails.serviceUid: "Lxxxxx"
 *   trainDetails.platform: last known platform
 *   delayNotified: true  (set after delay push sent, to avoid repeat)
 */

import type { Env } from '../types';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

function broLog(event: string, data: Record<string, unknown>) {
  console.log(JSON.stringify({ event, ...data, ts: new Date().toISOString() }));
}

async function sendExpoPush(
  token: string,
  title: string,
  body: string,
  data: Record<string, unknown>,
): Promise<void> {
  await fetch(EXPO_PUSH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ to: token, title, body, data, sound: 'default' }),
  });
}

export async function runPlatformWatch(env: Env): Promise<void> {
  if (!env.HYPERDRIVE?.connectionString) return;

  const { default: postgres } = await import('postgres');
  const sql = postgres(env.HYPERDRIVE.connectionString, { max: 2 });

  try {
    // Find jobs departing within the next 4 hours with platform watch active
    const rows = await sql<{ id: string; metadata: Record<string, unknown> }[]>`
      SELECT id, metadata
      FROM payment_intents
      WHERE metadata->>'platformWatchActive' = 'true'
        AND metadata->>'departureDatetime' IS NOT NULL
        AND (metadata->>'departureDatetime')::timestamptz BETWEEN NOW() AND NOW() + INTERVAL '4 hours'
      LIMIT 20
    `;

    if (rows.length === 0) return;

    broLog('platform_watch_check', { count: rows.length });

    const { checkServiceStatus, stationToCRS } = await import('../lib/rtt');

    for (const row of rows) {
      const meta = row.metadata as any;
      const pushToken: string | undefined         = meta.pushToken;
      const serviceUid: string | undefined        = meta.trainDetails?.serviceUid;
      const origin: string | undefined            = meta.trainDetails?.origin;
      const destination: string | undefined       = meta.trainDetails?.destination;
      const departureDatetime: string | undefined = meta.departureDatetime;
      const lastPlatform: string | undefined      = meta.trainDetails?.platform;
      const delayNotified: boolean                = meta.delayNotified === true;

      if (!pushToken || !serviceUid || !origin || !departureDatetime) continue;

      const originCRS = stationToCRS(origin);
      const destCRS   = destination ? stationToCRS(destination) : '';
      if (!originCRS) continue;

      try {
        const status = await checkServiceStatus(
          env,
          originCRS,
          destCRS ?? originCRS,
          serviceUid,
          departureDatetime,
        );

        if (!status) continue;

        const route = destination ? `${origin} → ${destination}` : origin;
        const metaUpdates: Record<string, unknown> = {
          platformLastChecked: new Date().toISOString(),
        };
        let needsUpdate = false;

        // ── Cancellation ─────────────────────────────────────────────────────
        if (status.isCancelled && !meta.cancellationNotified) {
          broLog('service_cancelled', { jobId: row.id, serviceUid });

          await sendExpoPush(
            pushToken,
            '⚠️ Train cancelled',
            `${route} has been cancelled · Ask Bro for alternatives`,
            { intentId: row.id, screen: 'receipt', action: 'cancelled' },
          );

          metaUpdates.cancellationNotified = true;
          // Deactivate watch — journey is cancelled
          metaUpdates.platformWatchActive = 'false';
          needsUpdate = true;
        }

        // ── Platform change ───────────────────────────────────────────────────
        if (!status.isCancelled && status.platform && status.platform !== lastPlatform) {
          broLog('platform_changed', {
            jobId: row.id, serviceUid,
            from: lastPlatform ?? 'unknown', to: status.platform,
          });

          await sendExpoPush(
            pushToken,
            '🚂 Platform changed',
            `${route} · Now Platform ${status.platform}`,
            { intentId: row.id, screen: 'receipt' },
          );

          // Update stored platform to prevent re-notify
          metaUpdates['trainDetails'] = { ...meta.trainDetails, platform: status.platform };
          needsUpdate = true;
        }

        // ── Delay > 10 min (notify once) ─────────────────────────────────────
        if (
          !status.isCancelled &&
          !delayNotified &&
          status.delayMinutes !== undefined &&
          status.delayMinutes >= 10
        ) {
          broLog('service_delayed', { jobId: row.id, serviceUid, delayMinutes: status.delayMinutes });

          await sendExpoPush(
            pushToken,
            `⏱ Running ${status.delayMinutes} min late`,
            `${route} · Expected delay: ${status.delayMinutes} minutes`,
            { intentId: row.id, screen: 'receipt' },
          );

          metaUpdates.delayNotified = true;
          needsUpdate = true;
        }

        if (needsUpdate) {
          await sql`
            UPDATE payment_intents
            SET metadata = metadata || ${JSON.stringify(metaUpdates)}::jsonb
            WHERE id = ${row.id}
          `;
        }
      } catch (e: any) {
        broLog('platform_watch_error', { jobId: row.id, error: e.message });
      }
    }
  } finally {
    await sql.end();
  }
}
