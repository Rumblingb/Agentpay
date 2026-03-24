/**
 * platformWatch.ts — Darwin platform change detection cron
 *
 * Runs every 5 minutes. Queries for upcoming booked journeys, polls Darwin
 * for their current platform, and pushes a notification via Expo if changed.
 *
 * Job metadata schema expected:
 *   platformWatchActive: true
 *   pushToken: "ExponentPushToken[xxx]"
 *   departureDatetime: "2026-03-24T17:42:00"
 *   trainDetails.origin: station name  (used for CRS lookup)
 *   trainDetails.serviceUid: "Lxxxxx"
 *   trainDetails.platform: last known platform
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

    const { queryRTT } = await import('../lib/rtt');

    for (const row of rows) {
      const meta = row.metadata as any;
      const pushToken: string | undefined = meta.pushToken;
      const serviceUid: string | undefined = meta.trainDetails?.serviceUid;
      const origin: string | undefined = meta.trainDetails?.origin;
      const destination: string | undefined = meta.trainDetails?.destination;
      const departureDatetime: string | undefined = meta.departureDatetime;
      const lastPlatform: string | undefined = meta.trainDetails?.platform;

      if (!pushToken || !serviceUid || !origin || !departureDatetime) continue;

      try {
        // Parse date and time from ISO string
        const dep = new Date(departureDatetime);
        const dateStr = `${dep.getFullYear()}/${String(dep.getMonth() + 1).padStart(2, '0')}/${String(dep.getDate()).padStart(2, '0')}`;
        const timeStr = `${String(dep.getHours()).padStart(2, '0')}${String(dep.getMinutes()).padStart(2, '0')}`;

        const result = await queryRTT(env, origin, destination ?? '', dateStr, timeStr);
        if (!result || result.error || result.services.length === 0) continue;

        // Find our specific service by serviceUid
        const svc = result.services.find((s: any) => s.serviceUid === serviceUid)
          ?? result.services[0]; // fallback to first service if uid not matched

        const currentPlatform: string | undefined = svc?.platform;
        if (!currentPlatform || currentPlatform === lastPlatform) continue;

        // Platform changed! Push notification
        const route = destination ? `${origin} → ${destination}` : origin;
        broLog('platform_changed', {
          jobId: row.id, serviceUid, from: lastPlatform ?? 'unknown', to: currentPlatform,
        });

        await sendExpoPush(
          pushToken,
          '🚂 Platform changed',
          `${route} · Now Platform ${currentPlatform}`,
          { intentId: row.id, screen: 'receipt' },
        );

        // Update stored platform in metadata so we don't re-notify
        await sql`
          UPDATE payment_intents
          SET metadata = metadata || ${JSON.stringify({
            trainDetails: { ...meta.trainDetails, platform: currentPlatform },
            platformLastChecked: new Date().toISOString(),
          })}::jsonb
          WHERE id = ${row.id}
        `;
      } catch (e: any) {
        broLog('platform_watch_error', { jobId: row.id, error: e.message });
      }
    }
  } finally {
    await sql.end();
  }
}
