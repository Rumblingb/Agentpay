/**
 * Google Maps — Location Intelligence Layer
 *
 * Three APIs, two purposes:
 *
 *   1. Geocoding API   — free-text address → lat/lon (cheap, use when only coords needed)
 *   2. Places API (New)— nearby discovery, text search, autocomplete
 *   3. Nominatim       — free OSM fallback when GOOGLE_MAPS_API_KEY not set
 *
 * Security rules (from plan):
 *   - Server key (Workers, IP-restricted) used here — NEVER ship in mobile app
 *   - Minimal field masks on Places API (New) — never use '*'
 *   - Session tokens required for Autocomplete → Place Details (billing)
 *
 * Darwin + TfL remain source of truth for UK rail + London transit.
 * This module handles destination normalisation, geocoding, and place discovery.
 */

// ── Types ──────────────────────────────────────────────────────────────────

export interface GeoPoint {
  lat: number;
  lon: number;
  formattedAddress?: string;
}

export interface PlaceResult {
  name: string;
  address: string;
  rating?: number;
  priceLevel?: number; // 0-4
  lat?: number;
  lon?: number;
  placeId?: string;
}

export interface AutocompletePrediction {
  placeId: string;
  description: string;
  mainText: string;
}

// ── Geocoding API ──────────────────────────────────────────────────────────

/**
 * Convert a free-text address to lat/lon using Google Geocoding API.
 * Cheaper than Place Details when only coordinates are needed.
 * Returns null on any error — callers should fall back to Nominatim.
 */
export async function geocodeAddress(
  address: string,
  apiKey: string
): Promise<GeoPoint | null> {
  if (!apiKey || !address.trim()) return null;

  try {
    const params = new URLSearchParams({ address, key: apiKey });
    const res = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?${params}`
    );
    if (!res.ok) return null;

    const data = (await res.json()) as {
      status: string;
      results: Array<{
        geometry: { location: { lat: number; lng: number } };
        formatted_address: string;
      }>;
    };

    if (data.status !== 'OK' || !data.results.length) return null;

    const r = data.results[0];
    return {
      lat: r.geometry.location.lat,
      lon: r.geometry.location.lng,
      formattedAddress: r.formatted_address,
    };
  } catch {
    return null;
  }
}

// ── Nominatim fallback (free, no key) ─────────────────────────────────────

/**
 * Geocode a city name using OpenStreetMap Nominatim.
 * Free, no API key required. Use-Agent header is required by OSM policy.
 * Use as fallback when GOOGLE_MAPS_API_KEY is absent.
 */
export async function geocodeCityNominatim(
  cityName: string
): Promise<GeoPoint | null> {
  if (!cityName.trim()) return null;

  try {
    const params = new URLSearchParams({
      q: cityName,
      format: 'json',
      limit: '1',
    });
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?${params}`,
      {
        headers: {
          'User-Agent': 'Bro/1.0 (so.agentpay.meridian)',
          Accept: 'application/json',
        },
      }
    );
    if (!res.ok) return null;

    const data = (await res.json()) as Array<{
      lat: string;
      lon: string;
      display_name: string;
    }>;

    if (!data.length) return null;

    return {
      lat: parseFloat(data[0].lat),
      lon: parseFloat(data[0].lon),
      formattedAddress: data[0].display_name,
    };
  } catch {
    return null;
  }
}

// ── Places API (New) — Nearby Search ──────────────────────────────────────

const NEARBY_FIELD_MASK =
  'places.displayName,places.formattedAddress,places.rating,places.priceLevel,places.location,places.id';

/**
 * Find nearby places of a given type using Places API (New).
 * Uses minimal field mask to keep costs low.
 */
export async function searchNearby(
  {
    lat,
    lon,
    type = 'restaurant',
    maxResults = 5,
    radiusMeters = 1500,
  }: {
    lat: number;
    lon: number;
    type?: string;
    maxResults?: number;
    radiusMeters?: number;
  },
  apiKey: string
): Promise<PlaceResult[]> {
  if (!apiKey) return [];

  try {
    const body = {
      includedTypes: [type],
      maxResultCount: maxResults,
      locationRestriction: {
        circle: {
          center: { latitude: lat, longitude: lon },
          radius: radiusMeters,
        },
      },
    };

    const res = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': NEARBY_FIELD_MASK,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) return [];
    const data = (await res.json()) as { places?: GPlaceNew[] };
    return (data.places ?? []).map(mapGPlace);
  } catch {
    return [];
  }
}

/**
 * Text-based nearby search using Places API (New) searchText endpoint.
 * Use for queries like "quiet café near the river" where type alone isn't enough.
 */
export async function searchNearbyText(
  {
    query,
    lat,
    lon,
    maxResults = 5,
  }: {
    query: string;
    lat: number;
    lon: number;
    maxResults?: number;
  },
  apiKey: string
): Promise<PlaceResult[]> {
  if (!apiKey || !query.trim()) return [];

  try {
    const body = {
      textQuery: query,
      maxResultCount: maxResults,
      locationBias: {
        circle: {
          center: { latitude: lat, longitude: lon },
          radius: 5000,
        },
      },
    };

    const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': NEARBY_FIELD_MASK,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) return [];
    const data = (await res.json()) as { places?: GPlaceNew[] };
    return (data.places ?? []).map(mapGPlace);
  } catch {
    return [];
  }
}

// ── Places API (New) — Autocomplete ───────────────────────────────────────

/**
 * Get destination autocomplete predictions using Places API (New).
 *
 * BILLING NOTE: Generate one sessionToken UUID per user voice turn.
 * Reuse the same token for all autocomplete calls in that turn.
 * End the session with one getPlaceDetails() call — billed as a single
 * Autocomplete Session (much cheaper than per-request billing).
 */
export async function autocompleteDestination(
  input: string,
  apiKey: string,
  sessionToken: string
): Promise<AutocompletePrediction[]> {
  if (!apiKey || !input.trim()) return [];

  try {
    const res = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'suggestions.placePrediction.placeId,suggestions.placePrediction.text,suggestions.placePrediction.structuredFormat',
      },
      body: JSON.stringify({
        input,
        sessionToken,
        languageCode: 'en',
        includedPrimaryTypes: ['locality', 'transit_station', 'airport', 'train_station'],
      }),
    });

    if (!res.ok) return [];

    const data = (await res.json()) as {
      suggestions?: Array<{
        placePrediction?: {
          placeId?: string;
          text?: { text?: string };
          structuredFormat?: { mainText?: { text?: string } };
        };
      }>;
    };

    return (data.suggestions ?? [])
      .map((s) => s.placePrediction)
      .filter(Boolean)
      .slice(0, 3)
      .map((p) => ({
        placeId: p!.placeId ?? '',
        description: p!.text?.text ?? '',
        mainText: p!.structuredFormat?.mainText?.text ?? p!.text?.text ?? '',
      }));
  } catch {
    return [];
  }
}

/**
 * Get place details to complete an Autocomplete session.
 * MUST be called after autocompleteDestination to end the billing session.
 */
export async function getPlaceDetails(
  placeId: string,
  apiKey: string,
  sessionToken: string
): Promise<GeoPoint | null> {
  if (!apiKey || !placeId) return null;

  try {
    const res = await fetch(
      `https://places.googleapis.com/v1/places/${placeId}`,
      {
        headers: {
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': 'id,displayName,formattedAddress,location',
          // sessionToken closes the Autocomplete billing session
          'X-Goog-SessionToken': sessionToken,
        },
      }
    );

    if (!res.ok) return null;

    const data = (await res.json()) as {
      location?: { latitude?: number; longitude?: number };
      formattedAddress?: string;
    };

    if (!data.location?.latitude) return null;

    return {
      lat: data.location.latitude,
      lon: data.location.longitude ?? 0,
      formattedAddress: data.formattedAddress,
    };
  } catch {
    return null;
  }
}

// ── Formatting ─────────────────────────────────────────────────────────────

const PRICE_LABELS = ['Free', '$', '$$', '$$$', '$$$$'];

/**
 * Format places list for Claude's context window.
 */
export function formatPlacesForClaude(places: PlaceResult[], type = 'place'): string {
  if (places.length === 0) {
    return `No ${type}s found nearby.`;
  }

  const lines = places.map((p, i) => {
    const rating = p.rating ? ` ★${p.rating.toFixed(1)}` : '';
    const price =
      p.priceLevel !== undefined ? ` ${PRICE_LABELS[p.priceLevel] ?? ''}` : '';
    return `${i + 1}. **${p.name}**${rating}${price} — ${p.address}`;
  });

  return `Nearby ${type}s:\n${lines.join('\n')}`;
}

// ── Internal helpers ───────────────────────────────────────────────────────

interface GPlaceNew {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  rating?: number;
  priceLevel?: string; // e.g. "PRICE_LEVEL_MODERATE"
  location?: { latitude?: number; longitude?: number };
}

const PRICE_LEVEL_MAP: Record<string, number> = {
  PRICE_LEVEL_FREE: 0,
  PRICE_LEVEL_INEXPENSIVE: 1,
  PRICE_LEVEL_MODERATE: 2,
  PRICE_LEVEL_EXPENSIVE: 3,
  PRICE_LEVEL_VERY_EXPENSIVE: 4,
};

function mapGPlace(p: GPlaceNew): PlaceResult {
  return {
    name: p.displayName?.text ?? 'Unknown',
    address: p.formattedAddress ?? '',
    rating: p.rating,
    priceLevel: p.priceLevel ? PRICE_LEVEL_MAP[p.priceLevel] : undefined,
    lat: p.location?.latitude,
    lon: p.location?.longitude,
    placeId: p.id,
  };
}
