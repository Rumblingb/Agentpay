/**
 * OpenTable restaurant search — stub implementation
 *
 * Returns [] while OPENTABLE_API_KEY is absent.
 * Activates automatically when the key is set via `npx wrangler secret put OPENTABLE_API_KEY`.
 *
 * OpenTable Affiliate API requires commercial partnership: opentable.com/partners
 * Until then, book_restaurant uses Google Places (New) searchNearby for discovery.
 */

export interface RestaurantResult {
  name: string;
  address: string;
  cuisine: string;
  rating?: number;
  priceLevel?: number;
  availableTimes?: string[];
  reservationUrl?: string;
}

/**
 * Search for available restaurants.
 * Stub — returns [] until OpenTable partnership is confirmed and key is set.
 */
export async function searchRestaurants({
  city,
  date,
  time,
  partySize = 2,
  cuisineType,
  apiKey,
}: {
  city: string;
  date: string;
  time?: string;
  partySize?: number;
  cuisineType?: string;
  apiKey?: string;
}): Promise<RestaurantResult[]> {
  if (!apiKey) return [];

  // TODO: implement once OpenTable partnership confirmed
  // POST https://platform.otapi.net/api-ext/FindAvailability
  // Params: RestaurantCountryId, CityName, DateTime, PartySize, etc.
  void city; void date; void time; void partySize; void cuisineType;
  return [];
}

/**
 * Format restaurant results for Claude.
 */
export function formatRestaurantsForClaude(
  restaurants: RestaurantResult[],
  city: string
): string {
  if (restaurants.length === 0) {
    return `No OpenTable availability found in ${city}. I can search Google Places for nearby restaurants instead.`;
  }

  const lines = restaurants.map((r, i) => {
    const rating = r.rating ? ` ★${r.rating.toFixed(1)}` : '';
    const times = r.availableTimes?.length
      ? ` | Available: ${r.availableTimes.join(', ')}`
      : '';
    return `${i + 1}. **${r.name}**${rating} — ${r.cuisine} | ${r.address}${times}`;
  });

  return `Restaurants in ${city}:\n${lines.join('\n')}`;
}
