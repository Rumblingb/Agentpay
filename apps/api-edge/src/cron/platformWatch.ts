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
import { fanOutToTripRoom } from '../routes/tripRooms';

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

          // Search for next available service on the same route
          let altText = '';
          let altService: Record<string, unknown> | undefined;
          try {
            const { queryRTT } = await import('../lib/rtt');
            const altResult = await queryRTT(env, origin, destination ?? origin, 'today', 'any');
            // Find the first service that departs after the cancelled one
            const cancelledHHMM = departureDatetime ? departureDatetime.slice(11, 16) : '00:00';
            const nextSvc = altResult.services.find(s => s.departureTime > cancelledHHMM);
            if (nextSvc) {
              const fare = nextSvc.estimatedFareGbp ? ` · £${nextSvc.estimatedFareGbp}` : '';
              altText = ` I found the ${nextSvc.departureTime}${nextSvc.arrivalTime ? ` → ${nextSvc.arrivalTime}` : ''}${fare}. Tap to rebook.`;
              altService = {
                origin,
                destination: destination ?? origin,
                departureTime:  nextSvc.departureTime,
                arrivalTime:    nextSvc.arrivalTime,
                operator:       nextSvc.operator,
                estimatedFareGbp: nextSvc.estimatedFareGbp,
                serviceUid:     nextSvc.serviceUid,
              };
              metaUpdates.alternativeService = altService;
            }
          } catch { /* non-fatal */ }

          const cancelledTime = departureDatetime ? departureDatetime.slice(11, 16) : 'your train';
          const pushBody = destination
            ? `Your ${cancelledTime} to ${destination} is cancelled.${altText || ' Ask Bro for alternatives.'}`
            : `Your train is cancelled.${altText || ' Ask Bro for alternatives.'}`;

          const transcript = altService && destination
            ? `Rebook my cancelled ${cancelledTime} to ${destination} — put me on the ${(altService as any).departureTime} instead`
            : `My train to ${destination ?? origin} was cancelled — find me the next one`;

          await sendExpoPush(
            pushToken,
            '⚠️ Train cancelled',
            pushBody,
            {
              intentId: row.id,
              screen:   altService ? 'converse' : 'receipt',
              action:   'rebook',
              transcript,
            },
          );
          await fanOutToTripRoom(row.id, `⚠️ Cancelled: ${route}.${altText || ' Ask Bro for alternatives.'}`, sql);

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
          await fanOutToTripRoom(row.id, `🚂 Platform changed: ${route} · Now Platform ${status.platform}`, sql);

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
          await fanOutToTripRoom(row.id, `⏱ ${route} running ${status.delayMinutes} min late.`, sql);

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
