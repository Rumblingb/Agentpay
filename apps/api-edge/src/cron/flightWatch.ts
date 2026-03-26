/**
 * flightWatch.ts — Aviationstack flight status polling
 *
 * Runs every 5 minutes alongside platformWatch.
 * Polls for booked Duffel flight jobs departing within 6 hours and pushes:
 *   - Gate assigned / gate changed
 *   - Delay > 15 minutes (once)
 *   - Cancellation → offer rebook via Duffel
 *
 * Activates automatically when AVIATIONSTACK_API_KEY is set.
 * Free tier: 500 req/mo — guards with `flightWatchActive` flag set at booking.
 *
 * Job metadata expected:
 *   flightWatchActive: true
 *   pushToken: "ExponentPushToken[xxx]"
 *   flightDetails.flightNumber: "BA0215"
 *   flightDetails.departureAt: ISO datetime
 *   flightDetails.origin: IATA or city
 *   flightDetails.destination: IATA or city
 */

import type { Env } from '../types';
import { fanOutToTripRoom } from '../routes/tripRooms';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const AVIATIONSTACK_URL = 'https://api.aviationstack.com/v1/flights';

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

interface AviationstackFlight {
  flight_status: string;       // 'scheduled' | 'active' | 'landed' | 'cancelled' | 'incident' | 'diverted'
  departure: {
    estimated?: string;        // ISO
    scheduled?: string;        // ISO
    gate?: string;
    delay?: number;            // minutes
  };
  arrival: {
    estimated?: string;
    scheduled?: string;
    gate?: string;
  };
}

async function fetchFlightStatus(
  apiKey: string,
  flightIata: string,          // e.g. "BA215"
  departureDate: string,       // YYYY-MM-DD
): Promise<AviationstackFlight | null> {
  const url = `${AVIATIONSTACK_URL}?access_key=${encodeURIComponent(apiKey)}&flight_iata=${encodeURIComponent(flightIata)}&dep_date=${encodeURIComponent(departureDate)}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const body = await res.json() as { data?: AviationstackFlight[] };
    return body.data?.[0] ?? null;
  } catch {
    return null;
  }
}

export async function runFlightWatch(env: Env): Promise<void> {
  if (!env.AVIATIONSTACK_API_KEY || !env.HYPERDRIVE?.connectionString) return;

  const { default: postgres } = await import('postgres');
  const sql = postgres(env.HYPERDRIVE.connectionString, { max: 2 });

  try {
    // Jobs with a booked flight departing within the next 6 hours
    const rows = await sql<{ id: string; metadata: Record<string, unknown> }[]>`
      SELECT id, metadata
      FROM payment_intents
      WHERE metadata->>'flightWatchActive' = 'true'
        AND metadata->'flightDetails'->>'departureAt' IS NOT NULL
        AND (metadata->'flightDetails'->>'departureAt')::timestamptz BETWEEN NOW() AND NOW() + INTERVAL '6 hours'
      LIMIT 20
    `;

    if (rows.length === 0) return;

    broLog('flight_watch_check', { count: rows.length });

    for (const row of rows) {
      const meta        = row.metadata as any;
      const pushToken   = meta.pushToken as string | undefined;
      const fd          = meta.flightDetails as any;
      const flightNum   = fd?.flightNumber as string | undefined;   // e.g. "BA0215"
      const departureAt = fd?.departureAt  as string | undefined;   // ISO
      const destination = fd?.destination  as string | undefined;

      if (!pushToken || !flightNum || !departureAt) continue;

      const depDate = departureAt.slice(0, 10);   // YYYY-MM-DD
      // Aviationstack uses IATA without leading zeros: BA215 not BA0215
      const flightIata = flightNum.replace(/^([A-Z]{2})0+(\d)/, '$1$2');

      try {
        const status = await fetchFlightStatus(env.AVIATIONSTACK_API_KEY, flightIata, depDate);
        if (!status) continue;

        const metaUpdates: Record<string, unknown> = {};
        let needsUpdate = false;
        const route = destination ? `${fd.origin ?? ''} → ${destination}` : flightNum;

        // ── Cancellation ───────────────────────────────────────────────────
        if (status.flight_status === 'cancelled' && !meta.flightCancellationNotified) {
          const transcript = `My flight ${flightNum} was cancelled — find me an alternative`;
          await sendExpoPush(
            pushToken,
            '✈️ Flight cancelled',
            `${flightNum} to ${destination ?? 'your destination'} has been cancelled. Contact your airline or let Bro find alternatives.`,
            {
              intentId: row.id,
              screen: 'receipt',
              action: 'cancelled',
              transcript,
              destination: destination ?? null,
              disruptionRoute: route,
            },
          );
          await fanOutToTripRoom(row.id, `✈️ ${flightNum} cancelled. Contact airline or ask Bro for alternatives.`, sql);
          metaUpdates.flightCancellationNotified = true;
          metaUpdates.flightWatchActive = 'false';
          needsUpdate = true;
          broLog('flight_cancelled', { jobId: row.id, flightNum });
        }

        // ── Delay > 15 min (once) ──────────────────────────────────────────
        if (
          status.flight_status !== 'cancelled' &&
          !meta.flightDelayNotified &&
          status.departure.delay !== undefined &&
          status.departure.delay >= 15
        ) {
          const delayMins = status.departure.delay;
          const newDepEst = status.departure.estimated
            ? new Date(status.departure.estimated).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
            : null;
          const body = newDepEst
            ? `${flightNum} to ${destination ?? 'your destination'} is delayed ${delayMins} min. New departure: ${newDepEst}.`
            : `${flightNum} to ${destination ?? 'your destination'} is running ${delayMins} min late.`;
          await sendExpoPush(
            pushToken,
            `✈️ ${delayMins} min delay`,
            body,
            {
              intentId: row.id,
              screen: 'receipt',
              action: 'delay',
              delayMinutes: delayMins,
              disruptionRoute: route,
            },
          );
          await fanOutToTripRoom(row.id, `✈️ ${route} delayed ${delayMins} min.`, sql);
          metaUpdates.flightDelayNotified = true;
          needsUpdate = true;
          broLog('flight_delayed', { jobId: row.id, flightNum, delayMins });
        }

        // ── Gate assigned / changed ────────────────────────────────────────
        const newGate = status.departure.gate;
        const lastGate = meta.flightGate as string | undefined;
        if (newGate && newGate !== lastGate && !meta.flightCancellationNotified) {
          const title = lastGate ? '✈️ Gate changed' : '✈️ Gate assigned';
          const body  = lastGate
            ? `${flightNum}: gate changed from ${lastGate} to ${newGate}.`
            : `${flightNum}: departing from Gate ${newGate}.`;
          await sendExpoPush(
            pushToken,
            title,
            body,
            {
              intentId: row.id,
              screen: 'receipt',
              action: lastGate ? 'gate_changed' : 'gate_assigned',
              gate: newGate,
              disruptionRoute: route,
            },
          );
          await fanOutToTripRoom(row.id, `${title}: ${body}`, sql);
          metaUpdates.flightGate = newGate;
          needsUpdate = true;
          broLog('flight_gate', { jobId: row.id, flightNum, gate: newGate, prev: lastGate ?? null });
        }

        if (needsUpdate) {
          await sql`
            UPDATE payment_intents
            SET metadata = metadata || ${JSON.stringify(metaUpdates)}::jsonb
            WHERE id = ${row.id}
          `;
        }
      } catch (e: any) {
        broLog('flight_watch_error', { jobId: row.id, error: e.message });
      }
    }
  } finally {
    await sql.end();
  }
}
