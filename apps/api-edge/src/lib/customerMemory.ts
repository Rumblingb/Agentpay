import type { Env } from '../types';
import { createDb } from './db';
import type { FlightOffer } from './duffel';
import type { HotelResult } from './xotelo';

type HistoryRow = {
  origin: string | null;
  destination: string | null;
  operator: string | null;
  fare: string | null;
  hotelCity: string | null;
  hotelArea: string | null;
  hotelName: string | null;
  created_at: string;
};

export type CustomerMemory = {
  tripHistoryContext: string;
  usualRoute?: { origin: string; destination: string; count: number; typicalFareGbp?: number };
  preferredCarrier?: string;
  preferredHotelArea?: string;
  preferredHotelCity?: string;
};

function normalizeKey(value?: string | null): string {
  return (value ?? '').trim().toLowerCase();
}

function topCount(entries: Array<string | null | undefined>): string | undefined {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    const key = normalizeKey(entry);
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return sorted[0]?.[1] && sorted[0][1] >= 2 ? sorted[0][0] : undefined;
}

function sameOriginDestination(a: string | undefined, b: string | undefined, x: string | undefined, y: string | undefined) {
  return normalizeKey(a) === normalizeKey(x) && normalizeKey(b) === normalizeKey(y);
}

export async function loadCustomerMemory(env: Env, hirerId: string): Promise<CustomerMemory> {
  const histSql = createDb(env);
  try {
    const rows = await histSql<HistoryRow[]>`
      SELECT
        COALESCE(
          metadata->'trainDetails'->>'origin',
          metadata->'flightDetails'->>'origin'
        ) AS origin,
        COALESCE(
          metadata->'trainDetails'->>'destination',
          metadata->'flightDetails'->>'destination'
        ) AS destination,
        COALESCE(
          metadata->'trainDetails'->>'operator',
          metadata->'flightDetails'->>'carrier'
        ) AS operator,
        COALESCE(
          metadata->'trainDetails'->>'estimatedFareGbp',
          metadata->'flightDetails'->>'totalGbp'
        ) AS fare,
        metadata->'hotelDetails'->>'city' AS hotel_city,
        metadata->'hotelDetails'->'bestOption'->>'area' AS hotel_area,
        metadata->'hotelDetails'->'bestOption'->>'name' AS hotel_name,
        created_at::text AS created_at
      FROM payment_intents
      WHERE hirer_id = ${hirerId}
        AND status = 'completed'
      ORDER BY created_at DESC
      LIMIT 12
    `.catch(() => []);

    const trips = rows.filter((r) => r.origin && r.destination);
    const hotelRows = rows.filter((r) => r.hotelCity || r.hotelArea || r.hotelName);

    let tripHistoryContext = '';
    let usualRoute: CustomerMemory['usualRoute'];
    if (trips.length > 0) {
      const lines = trips.slice(0, 5).map((t) => {
        const date = t.created_at ? t.created_at.slice(0, 10) : '';
        const fare = t.fare && Number(t.fare) > 0 ? ` £${Math.round(Number(t.fare))}` : '';
        const op = t.operator ? ` (${t.operator})` : '';
        return `- ${t.origin} → ${t.destination}${op}, ${date}${fare}`;
      });
      const routeCounts: Record<string, number> = {};
      for (const t of trips) {
        const key = `${t.origin}→${t.destination}`;
        routeCounts[key] = (routeCounts[key] ?? 0) + 1;
      }
      const frequentEntry = Object.entries(routeCounts).sort((a, b) => b[1] - a[1]).find(([, n]) => n >= 2);
      if (frequentEntry) {
        const [routeKey, count] = frequentEntry;
        const [orig, dest] = routeKey.split('→');
        const typicalFare = trips.find((t) => t.origin === orig && t.destination === dest && t.fare);
        usualRoute = {
          origin: orig ?? '',
          destination: dest ?? '',
          count,
          typicalFareGbp: typicalFare?.fare ? Math.round(Number(typicalFare.fare)) : undefined,
        };
      }
      tripHistoryContext = `\nUser's recent trips:\n${lines.join('\n')}`
        + (usualRoute ? `\nFrequent route: ${usualRoute.origin}→${usualRoute.destination} (${usualRoute.count}× in history) — if this matches the request, say "Same as last time?" and quote the fare.` : '');
    }

    const preferredCarrier = topCount(trips.map((t) => t.operator));
    const preferredHotelArea = topCount(hotelRows.map((r) => r.hotelArea));
    const preferredHotelCity = topCount(hotelRows.map((r) => r.hotelCity));

    const preferenceLines: string[] = [];
    if (preferredCarrier) preferenceLines.push(`Preferred carrier/operator from history: ${preferredCarrier}.`);
    if (preferredHotelArea && preferredHotelCity) preferenceLines.push(`Preferred hotel area: ${preferredHotelArea} in ${preferredHotelCity}.`);
    else if (preferredHotelCity) preferenceLines.push(`Preferred hotel city pattern: ${preferredHotelCity}.`);
    if (preferenceLines.length > 0) {
      tripHistoryContext += `\nBooking preferences:\n- ${preferenceLines.join('\n- ')}`;
    }

    return {
      tripHistoryContext,
      usualRoute,
      preferredCarrier,
      preferredHotelArea,
      preferredHotelCity,
    };
  } finally {
    await histSql.end().catch(() => {});
  }
}

export function rankFlightsByMemory(
  offers: FlightOffer[],
  memory: Pick<CustomerMemory, 'preferredCarrier' | 'usualRoute'>,
  request?: { origin?: string; destination?: string },
): FlightOffer[] {
  const preferredCarrier = normalizeKey(memory.preferredCarrier);
  const routeMatchesHistory = sameOriginDestination(request?.origin, request?.destination, memory.usualRoute?.origin, memory.usualRoute?.destination);
  return [...offers].sort((a, b) => {
    const carrierBoostA = preferredCarrier && normalizeKey(a.carrier) === preferredCarrier ? 1 : 0;
    const carrierBoostB = preferredCarrier && normalizeKey(b.carrier) === preferredCarrier ? 1 : 0;
    if (carrierBoostA !== carrierBoostB && routeMatchesHistory) return carrierBoostB - carrierBoostA;

    const directBoostA = a.stops === 0 ? 1 : 0;
    const directBoostB = b.stops === 0 ? 1 : 0;
    if (directBoostA !== directBoostB && Math.abs(a.totalAmount - b.totalAmount) <= 25) return directBoostB - directBoostA;

    return a.totalAmount - b.totalAmount;
  });
}

export function rankHotelsByMemory(
  hotels: HotelResult[],
  memory: Pick<CustomerMemory, 'preferredHotelArea' | 'preferredHotelCity'>,
  request?: { city?: string },
): HotelResult[] {
  const preferredArea = normalizeKey(memory.preferredHotelArea);
  const preferredCity = normalizeKey(memory.preferredHotelCity);
  const requestedCity = normalizeKey(request?.city);
  return [...hotels].sort((a, b) => {
    const areaBoostA = preferredArea && preferredCity && requestedCity === preferredCity && normalizeKey(a.area) === preferredArea ? 1 : 0;
    const areaBoostB = preferredArea && preferredCity && requestedCity === preferredCity && normalizeKey(b.area) === preferredArea ? 1 : 0;
    if (areaBoostA !== areaBoostB) return areaBoostB - areaBoostA;
    return a.ratePerNight - b.ratePerNight;
  });
}
