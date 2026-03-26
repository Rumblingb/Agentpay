/**
 * Google Routes API v2
 *
 * Used for:
 *   - Non-London final-leg walking directions (EU arrivals, global)
 *   - On-the-move navigation steps (returned to Meridian map screen)
 *   - Taxi/transit ETA estimation
 *
 * Darwin/TfL take priority:
 *   If destination CRS is in LONDON_TERMINI → use queryTfLFinalLeg (not this module).
 *   This module only fires for non-London final legs and explicit navigate requests.
 */

export type TravelMode = 'WALK' | 'BICYCLE' | 'TRANSIT' | 'DRIVE';

export interface RouteStep {
  instruction: string;   // HTML stripped
  distanceMeters: number;
  durationSeconds: number;
}

export interface RouteResult {
  durationSeconds: number;
  distanceMeters: number;
  polylineEncoded: string;
  steps: RouteStep[];
}

// Field mask — only request what we need to keep costs minimal
const ROUTES_FIELD_MASK =
  'routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline,routes.legs.steps.navigationInstruction,routes.legs.steps.distanceMeters,routes.legs.steps.staticDuration';

/**
 * Compute a route between two coordinates.
 * Returns null on any error — callers should handle gracefully.
 *
 * Note: TRANSIT mode does not support waypoints (Google restriction).
 */
export async function computeRoute(
  {
    originLat,
    originLon,
    destLat,
    destLon,
    travelMode = 'WALK',
  }: {
    originLat: number;
    originLon: number;
    destLat: number;
    destLon: number;
    travelMode?: TravelMode;
  },
  apiKey: string
): Promise<RouteResult | null> {
  if (!apiKey) return null;

  try {
    const body = {
      origin: {
        location: { latLng: { latitude: originLat, longitude: originLon } },
      },
      destination: {
        location: { latLng: { latitude: destLat, longitude: destLon } },
      },
      travelMode,
      computeAlternativeRoutes: false,
      routeModifiers: { avoidTolls: false, avoidHighways: false },
      languageCode: 'en-GB',
      units: 'METRIC',
    };

    const res = await fetch(
      'https://routes.googleapis.com/directions/v2:computeRoutes',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': ROUTES_FIELD_MASK,
        },
        body: JSON.stringify(body),
      }
    );

    if (!res.ok) return null;

    const data = (await res.json()) as {
      routes?: Array<{
        duration?: string;       // e.g. "720s"
        distanceMeters?: number;
        polyline?: { encodedPolyline?: string };
        legs?: Array<{
          steps?: Array<{
            navigationInstruction?: { instructions?: string };
            distanceMeters?: number;
            staticDuration?: string;
          }>;
        }>;
      }>;
    };

    const route = data.routes?.[0];
    if (!route) return null;

    const durationSeconds = parseDuration(route.duration ?? '0s');
    const steps: RouteStep[] = (route.legs?.[0]?.steps ?? []).map((s) => ({
      instruction: stripHtml(s.navigationInstruction?.instructions ?? ''),
      distanceMeters: s.distanceMeters ?? 0,
      durationSeconds: parseDuration(s.staticDuration ?? '0s'),
    }));

    return {
      durationSeconds,
      distanceMeters: route.distanceMeters ?? 0,
      polylineEncoded: route.polyline?.encodedPolyline ?? '',
      steps,
    };
  } catch {
    return null;
  }
}

// ── Formatting ─────────────────────────────────────────────────────────────

/**
 * Format route summary for Claude context.
 * e.g. "12 min walk (750 m, 9 steps)"
 */
export function formatRouteForClaude(route: RouteResult): string {
  const mins = Math.round(route.durationSeconds / 60);
  const dist = formatDistance(route.distanceMeters);
  const stepCount = route.steps.length;
  return `${mins} min walk (${dist}, ${stepCount} steps)`;
}

/**
 * Return step instructions stripped of HTML, ready for speech synthesis.
 */
export function formatStepsForSpeech(steps: RouteStep[]): string[] {
  return steps.map((s) => s.instruction);
}

// ── Internal helpers ───────────────────────────────────────────────────────

/** Parse Google duration string like "720s" → number of seconds */
function parseDuration(s: string): number {
  return parseInt(s.replace('s', ''), 10) || 0;
}

/** Strip HTML tags from Google step instructions */
function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, '').trim();
}

function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}
