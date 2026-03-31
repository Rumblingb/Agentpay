import type { Env } from '../types';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const LONDON_TZ = 'Europe/London';

type RoutePatternRow = {
  hirerId: string;
  origin: string;
  destination: string;
  count: number;
  pushToken: string;
  typicalFare: number | null;
  typicalMinutes: number | null;
  lastCompletedAt: string;
};

type LondonParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  weekday: number;
};

function londonNowParts(now = new Date()): LondonParts {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: LONDON_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
    weekday: 'short',
  });
  const parts = formatter.formatToParts(now);
  const lookup = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  return {
    year: Number.parseInt(lookup('year'), 10),
    month: Number.parseInt(lookup('month'), 10),
    day: Number.parseInt(lookup('day'), 10),
    hour: Number.parseInt(lookup('hour'), 10),
    weekday: weekdayMap[lookup('weekday')] ?? now.getUTCDay(),
  };
}

function tomorrowWeekday(parts: LondonParts): number {
  const tomorrowUtc = new Date(Date.UTC(parts.year, parts.month - 1, parts.day) + 24 * 60 * 60 * 1000);
  return tomorrowUtc.getUTCDay();
}

function formatTimeLabel(minutesOfDay: number | null): string | null {
  if (!Number.isFinite(minutesOfDay) || minutesOfDay == null) return null;
  const hours = Math.floor(minutesOfDay / 60);
  const minutes = minutesOfDay % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function formatFareLabel(typicalFare: number | null): string {
  if (!Number.isFinite(typicalFare) || typicalFare == null || typicalFare <= 0) return '';
  return ` · ~£${typicalFare.toFixed(2)}`;
}

async function sendExpoPush(
  token: string,
  title: string,
  body: string,
  data: Record<string, unknown>,
): Promise<boolean> {
  try {
    const response = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        to: token,
        title,
        body,
        data,
        sound: 'default',
      }),
    });
    if (!response.ok) return false;
    const json = await response.json() as any;
    return json?.data?.status !== 'error';
  } catch {
    return false;
  }
}

/**
 * Legacy name, upgraded behavior:
 * Runs once an hour, but only sends nudges at 9pm London time.
 * Looks for tomorrow-route patterns the user has completed 3+ times recently.
 */
export async function runMondayPattern(env: Env): Promise<void> {
  if (!env.HYPERDRIVE?.connectionString) return;

  const london = londonNowParts();
  if (london.hour !== 21) {
    return;
  }

  const targetWeekday = tomorrowWeekday(london);
  const { default: postgres } = await import('postgres');
  const sql = postgres(env.HYPERDRIVE.connectionString, { max: 2 });

  try {
    const rows = await sql<RoutePatternRow[]>`
      SELECT
        hirer_id AS "hirerId",
        metadata->'trainDetails'->>'origin' AS origin,
        metadata->'trainDetails'->>'destination' AS destination,
        COUNT(*)::int AS count,
        MAX(metadata->>'pushToken') AS "pushToken",
        ROUND(AVG(NULLIF(metadata->'trainDetails'->>'estimatedFareGbp', '')::numeric), 2)::float8 AS "typicalFare",
        ROUND(AVG(
          EXTRACT(HOUR FROM (metadata->>'departureDatetime')::timestamp) * 60
          + EXTRACT(MINUTE FROM (metadata->>'departureDatetime')::timestamp)
        ))::int AS "typicalMinutes",
        MAX(created_at)::text AS "lastCompletedAt"
      FROM payment_intents
      WHERE status = 'completed'
        AND created_at >= NOW() - INTERVAL '8 weeks'
        AND metadata->'trainDetails'->>'origin' IS NOT NULL
        AND metadata->'trainDetails'->>'destination' IS NOT NULL
        AND metadata->>'pushToken' IS NOT NULL
        AND metadata->>'departureDatetime' IS NOT NULL
        AND EXTRACT(DOW FROM (metadata->>'departureDatetime')::timestamp) = ${targetWeekday}
      GROUP BY
        hirer_id,
        metadata->'trainDetails'->>'origin',
        metadata->'trainDetails'->>'destination'
      HAVING COUNT(*) >= 3
      ORDER BY hirer_id ASC, COUNT(*) DESC, MAX(created_at) DESC
    `.catch(() => [] as RoutePatternRow[]);

    const nudgedHirers = new Set<string>();

    for (const row of rows) {
      if (!row.pushToken || !row.origin || !row.destination) continue;
      if (nudgedHirers.has(row.hirerId)) continue;

      nudgedHirers.add(row.hirerId);
      const routeCount = Number(row.count) || 0;
      const typicalTime = formatTimeLabel(Number(row.typicalMinutes));
      const fareLabel = formatFareLabel(Number(row.typicalFare));
      const route = `${row.origin} to ${row.destination}`;
      const title = `Tomorrow's usual ${row.destination} run?`;
      const body = typicalTime
        ? `Ace sees your ${route} pattern around ${typicalTime}${fareLabel}. Want me to line it up before you ask?`
        : `Ace sees your usual ${route}${fareLabel}. Want me to line it up before you ask?`;
      const transcript = typicalTime
        ? `Line up my usual ${row.origin} to ${row.destination} trip for tomorrow around ${typicalTime}`
        : `Line up my usual ${row.origin} to ${row.destination} trip for tomorrow`;

      await sendExpoPush(row.pushToken, title, body, {
        screen: 'converse',
        action: 'proactive_route',
        route,
        transcript,
        routeCount,
        expectedDepartureTime: typicalTime ?? undefined,
      });
    }
  } finally {
    await sql.end();
  }
}
