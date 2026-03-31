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

// Operator-specific boarding tips (UK rail)
const BOARDING_TIPS: Record<string, string> = {
  'Avanti West Coast': 'Quiet coach is Coach D. Bike storage at the rear.',
  'Avanti':            'Quiet coach is Coach D. Bike storage at the rear.',
  'LNER':              'Quiet coach is Coach H. First class at the front.',
  'GWR':               'Standard is mid-train. Catering in Coach C.',
  'Great Western':     'Standard is mid-train. Catering in Coach C.',
  'Thameslink':        'Short stop — doors open ~30 seconds. Be ready.',
  'Southern':          'Stand clear of the yellow line. Doors on both sides at some stations.',
  'CrossCountry':      'Quiet coach is usually Coach A. Bikes in Coach D.',
  'TransPennine':      'Standard class in the middle. First class at front.',
  'Chiltern':          'Standard at rear. First class at front.',
  'c2c':               'Short platform stops — be ready before the train arrives.',
  'Southeastern':      'Standard mid-train. Quiet zone in rear coach.',
  'East Midlands':     'First class at front. Quiet coach adjacent to first class.',
};

function broLog(event: string, data: Record<string, unknown>) {
  console.log(JSON.stringify({ event, ...data, ts: new Date().toISOString() }));
}

async function sendExpoPush(
  token: string,
  title: string,
  body: string,
  data: Record<string, unknown>,
): Promise<boolean> {
  try {
    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ to: token, title, body, data, sound: 'default' }),
    });
    if (!res.ok) return false;
    const json = await res.json() as any;
    // Expo returns { data: { status: 'ok' | 'error', ... } }
    const ticket = json?.data;
    if (ticket?.status === 'error') {
      broLog('expo_push_error', { token, details: ticket.details ?? ticket.message });
      return false;
    }
    return true;
  } catch {
    return false;
  }
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

          const transcript = altService && destination
            ? `Rebook my cancelled ${cancelledTime} to ${destination} — put me on the ${(altService as any).departureTime} instead`
            : `My train to ${destination ?? origin} was cancelled — find me the next one`;

          // If we found an alternative, build a richer offer-style push that deep-links
          // into the live Journey surface with the specific train pre-populated.
          const rerouteTitle = altService
            ? `Your ${cancelledTime} to ${destination ?? origin} is cancelled`
            : undefined;
          const rerouteBody = altService
            ? `I found the ${(altService as any).departureTime}${(altService as any).estimatedFareGbp ? ` · £${(altService as any).estimatedFareGbp}` : ''}. Tap to switch.`
            : undefined;

          const pushAction = altService ? 'proactive_reroute' : 'cancelled';
          const pushBody = rerouteBody
            ?? (destination
              ? `Your ${cancelledTime} to ${destination} is cancelled. Ask Ace for alternatives.`
              : `Your train is cancelled. Ask Ace for alternatives.`);

          const cancellationSent = await sendExpoPush(
            pushToken,
            rerouteTitle ?? '⚠️ Train cancelled',
            pushBody,
            {
              intentId: row.id,
              screen:   altService ? 'journey' : 'receipt',
              action:   pushAction,
              transcript,
              rerouteTitle:  rerouteTitle ?? undefined,
              rerouteBody:   rerouteBody ?? undefined,
              destination:   destination ?? origin,
              disruptionRoute: route,
            },
          );
          await fanOutToTripRoom(row.id, `⚠️ Cancelled: ${route}.${altText || ' Ask Ace for alternatives.'}`, sql);

          if (cancellationSent) {
            // Persist the reroute offer into the job so Journey polling can surface it.
            if (rerouteTitle && rerouteBody) {
              metaUpdates.rerouteOfferTitle      = rerouteTitle;
              metaUpdates.rerouteOfferBody       = rerouteBody;
              metaUpdates.rerouteOfferTranscript = transcript;
            }
            metaUpdates.cancellationNotified = true;
            // Deactivate watch — journey is cancelled
            metaUpdates.platformWatchActive = 'false';
            needsUpdate = true;
          }
        }

        // ── Platform change ───────────────────────────────────────────────────
        if (!status.isCancelled && status.platform && status.platform !== lastPlatform) {
          broLog('platform_changed', {
            jobId: row.id, serviceUid,
            from: lastPlatform ?? 'unknown', to: status.platform,
          });

          const platformSent = await sendExpoPush(
            pushToken,
            '🚂 Platform changed',
            `${route} · Now Platform ${status.platform}`,
            {
              intentId: row.id,
              screen: 'receipt',
              action: 'platform_changed',
              platform: status.platform,
              disruptionRoute: route,
            },
          );
          await fanOutToTripRoom(row.id, `🚂 Platform changed: ${route} · Now Platform ${status.platform}`, sql);

          if (platformSent) {
            // Update stored platform to prevent re-notify
            metaUpdates['trainDetails'] = { ...meta.trainDetails, platform: status.platform };
            needsUpdate = true;
          }
        }

        // ── Delay > 10 min (notify once, offer earlier service if available) ───
        if (
          !status.isCancelled &&
          !delayNotified &&
          status.delayMinutes !== undefined &&
          status.delayMinutes >= 10
        ) {
          broLog('service_delayed', { jobId: row.id, serviceUid, delayMinutes: status.delayMinutes });

          // Search for an earlier/alternative service the user could switch to
          let delayAltText = '';
          let delayAltTranscript: string | undefined;
          try {
            const { queryRTT } = await import('../lib/rtt');
            const altResult = await queryRTT(env, origin, destination ?? origin, 'today', 'any');
            const cancelledHHMM = departureDatetime ? departureDatetime.slice(11, 16) : '00:00';
            // Find a service that departs BEFORE the delayed one (or same time but on different service)
            const earlier = altResult.services.find(s =>
              s.departureTime < cancelledHHMM && s.serviceUid !== serviceUid,
            );
            const next = altResult.services.find(s =>
              s.departureTime > cancelledHHMM && s.serviceUid !== serviceUid,
            );
            const alt = earlier ?? next;
            if (alt) {
              const fare = alt.estimatedFareGbp ? ` · £${alt.estimatedFareGbp}` : '';
              delayAltText = ` The ${alt.departureTime} is on time${fare}. Move you onto it?`;
              delayAltTranscript = destination
                ? `My ${cancelledHHMM} to ${destination} is delayed ${status.delayMinutes} min — rebook me on the ${alt.departureTime} instead`
                : undefined;
            }
          } catch { /* non-fatal */ }

          // If we have an alternative, surface a specific offer rather than a generic nudge.
          const hasDelayAlt = !!delayAltTranscript;
          const delayRerouteTitle = hasDelayAlt
            ? `${status.delayMinutes} min delay on your ${departureDatetime?.slice(11, 16) ?? 'train'}`
            : undefined;
          const delayRerouteBody  = hasDelayAlt ? delayAltText.trim() : undefined;
          const delayAction       = hasDelayAlt ? 'proactive_reroute' : 'delay';
          const delayBody         = delayRerouteBody
            ?? `${route} running ${status.delayMinutes} min late. Check app for alternatives.`;

          const delaySent = await sendExpoPush(
            pushToken,
            delayRerouteTitle ?? `⏱ ${status.delayMinutes} min delay`,
            delayBody,
            {
              intentId: row.id,
              screen:   hasDelayAlt ? 'journey' : 'receipt',
              action:   delayAction,
              delayMinutes:  status.delayMinutes,
              transcript:    delayAltTranscript ?? undefined,
              rerouteTitle:  delayRerouteTitle  ?? undefined,
              rerouteBody:   delayRerouteBody   ?? undefined,
              disruptionRoute: route,
            },
          );
          await fanOutToTripRoom(row.id, `⏱ ${route} running ${status.delayMinutes} min late.${delayAltText}`, sql);

          if (delaySent) {
            // Persist reroute offer so the Journey screen can show it on next poll.
            if (delayRerouteTitle && delayRerouteBody) {
              metaUpdates.rerouteOfferTitle      = delayRerouteTitle;
              metaUpdates.rerouteOfferBody       = delayRerouteBody;
              metaUpdates.rerouteOfferTranscript = delayAltTranscript ?? undefined;
            }
            metaUpdates.delayNotified = true;
            needsUpdate = true;
          }
        }

        // ── Boarding tip push (T-25 to T-35 min, once per journey) ──────────
        if (!meta.boardingTipSent && departureDatetime) {
          const minsToDepart = Math.round(
            (new Date(departureDatetime).getTime() - Date.now()) / 60_000,
          );
          if (minsToDepart >= 25 && minsToDepart <= 35) {
            const operator: string | undefined = meta.trainDetails?.operator;
            const tipKey = operator
              ? Object.keys(BOARDING_TIPS).find(
                  (k) =>
                    operator.toLowerCase().includes(k.toLowerCase()) ||
                    k.toLowerCase().includes(operator.toLowerCase()),
                )
              : undefined;
            if (pushToken && tipKey) {
              const tipSent = await sendExpoPush(
                pushToken,
                `🚂 ${tipKey} boarding tip`,
                BOARDING_TIPS[tipKey]!,
                { intentId: row.id, screen: 'receipt', action: 'boarding_tip' },
              );
              if (tipSent) {
                broLog('boarding_tip_sent', { jobId: row.id, operator: tipKey, minsToDepart });
                metaUpdates.boardingTipSent = true;
                needsUpdate = true;
              }
            }
          }
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
