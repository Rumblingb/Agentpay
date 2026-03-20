/**
 * TfL Journey Planner API client
 *
 * Used for final-leg routing when a mainline train arrives at a London terminus.
 * Public API — no key required for low volume. Optionally set TFL_APP_KEY secret
 * for higher rate limits.
 *
 * Docs: https://api.tfl.gov.uk/
 */

export interface TfLLegResult {
  summary:   string;    // e.g. "Piccadilly line (3 stops) → Covent Garden, 12 min"
  duration:  number;    // total journey minutes
  modes:     string[];  // e.g. ['tube', 'walking']
  steps:     string[];  // individual leg descriptions
  error?:    string;
}

// CRS codes → TfL NAPTAN/NLC IDs for precise station matching.
// Using 910G (National Rail) NAPTAN IDs avoids TfL's text disambiguation
// returning wrong places (e.g. "Euston Tap" pub instead of Euston station).
const TERMINUS_NAPTAN: Record<string, string> = {
  STP: '910GSTPNCRS',   // St Pancras International
  KGX: '910GKNGX',     // King's Cross
  EUS: '910GEUSTON',   // Euston
  PAD: '910GPADTON',   // Paddington
  WAT: '910GWATRLOO',  // Waterloo
  VIC: '910GVICTRIA',  // Victoria
  LBG: '910GLONDBDG',  // London Bridge
  LST: '910GLIVST',    // Liverpool Street
  MYB: '910GMARYLBN',  // Marylebone
  CST: '910GCNNST',    // Cannon Street
  CHX: '910GCHX',      // Charing Cross
  BFR: '910GBLKFR',    // Blackfriars
};

/**
 * Query TfL Journey Planner for the final city leg.
 * @param terminusCRS  - CRS code of the London terminus (e.g. "KGX")
 * @param destination  - User's final destination text (postcode, area, address)
 * @param appKey       - Optional TfL app_key for higher rate limits
 */
const TFL_BASE = 'https://api.tfl.gov.uk';

export async function queryTfLFinalLeg(
  terminusCRS: string,
  destination: string,
  appKey?: string,
): Promise<TfLLegResult> {
  const from = TERMINUS_NAPTAN[terminusCRS] ?? terminusCRS;
  const baseParams = new URLSearchParams({
    nationalSearch:    'true',
    mode:              'tube,dlr,elizabeth-line,overground,bus,walking',
    journeyPreference: 'leasttime',
    ...(appKey ? { app_key: appKey } : {}),
  });

  const firstUrl = `${TFL_BASE}/Journey/JourneyResults/${encodeURIComponent(from)}/to/${encodeURIComponent(destination)}?${baseParams}`;

  const data = await tflFetch(firstUrl);
  if (!data) return { summary: '', duration: 0, modes: [], steps: [], error: 'TfL unavailable' };

  // If TfL returns journeys directly, we're done.
  let journeys: any[] = data.journeys ?? [];

  // TfL returns 300 (or 200 with empty journeys) when either location is ambiguous.
  // Re-run with the best-matched parameterValue for both from and to.
  if (!journeys.length) {
    const bestFrom: any  = data.fromLocationDisambiguation?.disambiguationOptions?.[0];
    const bestTo: any    = data.toLocationDisambiguation?.disambiguationOptions?.[0];
    const resolvedFrom   = bestFrom?.parameterValue ? encodeURIComponent(bestFrom.parameterValue) : encodeURIComponent(from);
    const resolvedTo     = bestTo?.parameterValue   ? encodeURIComponent(bestTo.parameterValue)   : null;
    if (resolvedTo) {
      const retryUrl = `${TFL_BASE}/Journey/JourneyResults/${resolvedFrom}/to/${resolvedTo}?${baseParams}`;
      const retryData = await tflFetch(retryUrl);
      journeys = retryData?.journeys ?? [];
    }
  }

  if (!journeys.length) {
    return { summary: '', duration: 0, modes: [], steps: [], error: 'No TfL journeys found' };
  }

  const journey = journeys[0];
  const duration: number = journey.duration ?? 0;
  const legs: any[] = journey.legs ?? [];

  const modes: string[] = [];
  const steps: string[] = [];

  for (const leg of legs) {
    const mode: string = leg.mode?.id ?? 'walk';
    if (!modes.includes(mode)) modes.push(mode);

    const instruction: string = leg.instruction?.summary ?? '';
    if (instruction) steps.push(instruction);
  }

  const summary = buildSummary(legs, duration, destination);

  return { summary, duration, modes, steps };
}

async function tflFetch(url: string): Promise<any | null> {
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(6_000),
    });
    // TfL uses 300 for disambiguation (still parseable JSON), 200 for success.
    // Reject only on 4xx/5xx or non-JSON responses.
    if (res.status >= 400) return null;
    const text = await res.text();
    try { return JSON.parse(text); } catch { return null; }
  } catch {
    return null;
  }
}

function buildSummary(legs: any[], duration: number, finalDest: string): string {
  // Find transit legs (ignore pure walking if mixed with transit)
  const transitLegs = legs.filter((l: any) => l.mode?.id && l.mode.id !== 'walking');
  if (!transitLegs.length) {
    return `Walking to ${finalDest}, ${duration} min`;
  }

  const parts: string[] = [];
  for (const leg of legs) {
    const mode = leg.mode?.id ?? '';
    const instr = leg.instruction?.summary ?? '';

    if (mode === 'walking') {
      const walkMins = Math.round((leg.duration ?? 0));
      if (walkMins >= 3) parts.push(`${walkMins} min walk`);
    } else {
      // Get line name from routeOptions or instruction
      const lineName: string = leg.routeOptions?.[0]?.name
        ?? leg.instruction?.summary
        ?? instr
        ?? modeFriendlyName(mode);
      const stops: number = (leg.path?.stopPoints?.length ?? 0);
      const stopStr = stops > 1 ? ` (${stops} stops)` : '';
      parts.push(`${friendlyLine(lineName)}${stopStr}`);
    }
  }

  const joined = parts.filter(Boolean).join(' → ');
  return joined ? `${joined}, ${duration} min` : `${duration} min to ${finalDest}`;
}

function modeFriendlyName(mode: string): string {
  const map: Record<string, string> = {
    'tube':            'Tube',
    'dlr':             'DLR',
    'elizabeth-line':  'Elizabeth line',
    'overground':      'Overground',
    'bus':             'Bus',
    'national-rail':   'National Rail',
    'walking':         'Walk',
  };
  return map[mode] ?? mode;
}

function friendlyLine(name: string): string {
  // Capitalise known Tube line names properly
  const lines: Record<string, string> = {
    'bakerloo':         'Bakerloo line',
    'central':          'Central line',
    'circle':           'Circle line',
    'district':         'District line',
    'hammersmith':      'Hammersmith & City line',
    'jubilee':          'Jubilee line',
    'metropolitan':     'Metropolitan line',
    'northern':         'Northern line',
    'piccadilly':       'Piccadilly line',
    'victoria':         'Victoria line',
    'waterloo':         'Waterloo & City line',
    'elizabeth':        'Elizabeth line',
    'dlr':              'DLR',
    'overground':       'Overground',
  };
  const lower = name.toLowerCase();
  for (const [key, friendly] of Object.entries(lines)) {
    if (lower.includes(key)) return friendly;
  }
  return name;
}
