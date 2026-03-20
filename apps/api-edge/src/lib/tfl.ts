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

// CRS codes → human-readable station name that TfL Journey Planner accepts as origin
const TERMINUS_NAME: Record<string, string> = {
  STP: 'St Pancras International',
  KGX: "King's Cross",
  EUS: 'Euston',
  PAD: 'Paddington',
  WAT: 'Waterloo',
  VIC: 'Victoria',
  LBG: 'London Bridge',
  LST: 'Liverpool Street',
  MYB: 'Marylebone',
  CST: 'Cannon Street',
  CHX: 'Charing Cross',
  BFR: 'Blackfriars',
};

/**
 * Query TfL Journey Planner for the final city leg.
 * @param terminusCRS  - CRS code of the London terminus (e.g. "KGX")
 * @param destination  - User's final destination text (postcode, area, address)
 * @param appKey       - Optional TfL app_key for higher rate limits
 */
export async function queryTfLFinalLeg(
  terminusCRS: string,
  destination: string,
  appKey?: string,
): Promise<TfLLegResult> {
  const from = TERMINUS_NAME[terminusCRS] ?? terminusCRS;
  const params = new URLSearchParams({
    nationalSearch: 'true',
    mode:           'tube,dlr,elizabeth-line,overground,bus,walking',
    journeyPreference: 'leasttime',
    ...(appKey ? { app_key: appKey } : {}),
  });

  const url = `https://api.tfl.gov.uk/Journey/JourneyResults/${encodeURIComponent(from)}/to/${encodeURIComponent(destination)}?${params}`;

  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(6_000),
  });

  if (!res.ok) {
    return { summary: '', duration: 0, modes: [], steps: [], error: `TfL API ${res.status}` };
  }

  let data: any;
  try {
    data = await res.json();
  } catch {
    return { summary: '', duration: 0, modes: [], steps: [], error: 'TfL parse error' };
  }

  const journeys: any[] = data?.journeys ?? [];
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

  // Build a concise human summary
  const summary = buildSummary(legs, duration, destination);

  return { summary, duration, modes, steps };
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
