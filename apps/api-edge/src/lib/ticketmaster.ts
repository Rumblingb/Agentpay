/**
 * Ticketmaster Discovery API v2
 *
 * Free tier: 5,000 requests/day — self-serve at developer.ticketmaster.com
 * Used by Bro to proactively surface events at destination after booking.
 *
 * Never throws — returns [] gracefully on any error so concierge stays up.
 */

export interface TicketmasterEvent {
  name: string;
  date: string;
  time: string;
  venue: string;
  city: string;
  priceRange: string;
  url: string;
  genre: string;
}

interface TmEvent {
  name?: string;
  dates?: { start?: { localDate?: string; localTime?: string } };
  _embedded?: { venues?: Array<{ name?: string; city?: { name?: string } }> };
  priceRanges?: Array<{ min?: number; max?: number; currency?: string }>;
  url?: string;
  classifications?: Array<{ segment?: { name?: string }; genre?: { name?: string } }>;
}

interface TmResponse {
  _embedded?: { events?: TmEvent[] };
  page?: { totalElements?: number };
}

/**
 * Search Ticketmaster events in a city on a given date.
 *
 * @param city - Destination city name (e.g. "Paris", "London")
 * @param travelDate - ISO date string "YYYY-MM-DD"
 * @param keyword - Optional keyword filter (e.g. "music", "comedy")
 * @param size - Max results to return (default 5)
 */
export async function searchEvents({
  city,
  travelDate,
  keyword,
  size = 5,
  apiKey,
}: {
  city: string;
  travelDate: string;
  keyword?: string;
  size?: number;
  apiKey: string;
}): Promise<TicketmasterEvent[]> {
  if (!apiKey) return [];

  try {
    const startDateTime = `${travelDate}T00:00:00Z`;
    const endDateTime = `${travelDate}T23:59:59Z`;

    const params = new URLSearchParams({
      apikey: apiKey,
      city,
      startDateTime,
      endDateTime,
      size: String(size),
      sort: 'date,asc',
      ...(keyword ? { keyword } : {}),
    });

    const res = await fetch(
      `https://app.ticketmaster.com/discovery/v2/events.json?${params}`,
      { headers: { Accept: 'application/json' } }
    );

    if (!res.ok) return [];

    const data = (await res.json()) as TmResponse;
    const events = data._embedded?.events ?? [];

    return events.map((e): TicketmasterEvent => {
      const venue = e._embedded?.venues?.[0];
      const price = e.priceRanges?.[0];
      const genre =
        e.classifications?.[0]?.genre?.name ??
        e.classifications?.[0]?.segment?.name ??
        'Event';

      const priceStr = price
        ? price.min === price.max
          ? `${price.currency ?? ''}${price.min}`
          : `${price.currency ?? ''}${price.min}–${price.max}`
        : 'Price TBC';

      return {
        name: e.name ?? 'Unnamed Event',
        date: e.dates?.start?.localDate ?? travelDate,
        time: e.dates?.start?.localTime?.slice(0, 5) ?? '',
        venue: venue?.name ?? 'Venue TBC',
        city: venue?.city?.name ?? city,
        priceRange: priceStr,
        url: e.url ?? '',
        genre,
      };
    });
  } catch {
    return [];
  }
}

/**
 * Format a list of Ticketmaster events into a concise string for Claude.
 */
export function formatEventsForClaude(events: TicketmasterEvent[], city: string, date: string): string {
  if (events.length === 0) {
    return `No events found on Ticketmaster for ${city} on ${date}.`;
  }

  const lines = events.map((e, i) => {
    const timeStr = e.time ? ` at ${e.time}` : '';
    return `${i + 1}. **${e.name}** — ${e.venue}${timeStr} | ${e.priceRange} | ${e.genre}${e.url ? ` | ${e.url}` : ''}`;
  });

  return `Events in ${city} on ${date}:\n${lines.join('\n')}`;
}
