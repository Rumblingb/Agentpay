import type { Env } from '../types';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

export async function runMondayPattern(env: Env): Promise<void> {
  if (!env.HYPERDRIVE?.connectionString) return;
  const { default: postgres } = await import('postgres');
  const sql = postgres(env.HYPERDRIVE.connectionString, { max: 2 });

  try {
    // Find (hirer_id, origin, destination) combos that appear 3+ times on a Monday
    // in the last 6 weeks, with a push token available
    const rows = await sql<Array<{
      hirerId: string;
      origin: string;
      destination: string;
      count: number;
      pushToken: string;
      typicalFare: number;
    }>>`
      SELECT
        hirer_id           AS "hirerId",
        metadata->'trainDetails'->>'origin'      AS origin,
        metadata->'trainDetails'->>'destination' AS destination,
        COUNT(*)::int                             AS count,
        MAX(metadata->>'pushToken')               AS "pushToken",
        AVG((metadata->'trainDetails'->>'estimatedFareGbp')::numeric)::int AS "typicalFare"
      FROM payment_intents
      WHERE status = 'completed'
        AND created_at >= NOW() - INTERVAL '6 weeks'
        AND EXTRACT(DOW FROM created_at) = 1  -- Monday
        AND metadata->'trainDetails'->>'origin'      IS NOT NULL
        AND metadata->>'pushToken'                   IS NOT NULL
      GROUP BY hirer_id,
               metadata->'trainDetails'->>'origin',
               metadata->'trainDetails'->>'destination'
      HAVING COUNT(*) >= 3
    `;

    for (const row of rows) {
      if (!row.pushToken || !row.origin || !row.destination) continue;
      const fareStr = row.typicalFare > 0 ? ` · ~£${row.typicalFare}` : '';
      await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          to:    row.pushToken,
          title: 'Morning! 👋',
          body:  `Ready for your usual ${row.origin} → ${row.destination}?${fareStr}`,
          data:  {
            screen:     'converse',
            action:     'prefill',
            transcript: `Book my usual ${row.origin} to ${row.destination}`,
          },
          sound: 'default',
        }),
      });
    }
  } finally {
    await sql.end();
  }
}
