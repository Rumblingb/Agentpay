/**
 * RTT (Realtime Trains) API client
 *
 * Provides real UK rail schedule data for the Bro concierge.
 * Register at realtimetrains.co.uk for free credentials.
 *
 * Usage: set RTT_USERNAME and RTT_PASSWORD as wrangler secrets.
 */

// ── Station CRS code lookup ───────────────────────────────────────────────────
// CRS = Computer Reservation System code (3-letter, e.g. DBY = Derby)

const CRS_CODES: Record<string, string> = {
  // London terminals
  'london':                   'STP', // default to St Pancras for rail context
  'london st pancras':        'STP',
  'st pancras':               'STP',
  'london euston':            'EUS',
  'euston':                   'EUS',
  'london kings cross':       'KGX',
  "london king's cross":      'KGX',
  'kings cross':              'KGX',
  "king's cross":             'KGX',
  'london paddington':        'PAD',
  'paddington':               'PAD',
  'london waterloo':          'WAT',
  'waterloo':                 'WAT',
  'london victoria':          'VIC',
  'victoria':                 'VIC',
  'london bridge':            'LBG',
  'london liverpool street':  'LST',
  'liverpool street':         'LST',
  'london marylebone':        'MYB',
  'marylebone':               'MYB',
  'london cannon street':     'CST',
  'london charing cross':     'CHX',
  'charing cross':            'CHX',
  'london blackfriars':       'BFR',

  // Major cities
  'manchester piccadilly':    'MAN',
  'manchester':               'MAN',
  'birmingham new street':    'BHM',
  'birmingham':               'BHM',
  'leeds':                    'LDS',
  'sheffield':                'SHF',
  'nottingham':               'NOT',
  'leicester':                'LEI',
  'derby':                    'DBY',
  'bristol temple meads':     'BRI',
  'bristol':                  'BRI',
  'edinburgh waverley':       'EDB',
  'edinburgh':                'EDB',
  'glasgow central':          'GLC',
  'glasgow queen street':     'GLQ',
  'glasgow':                  'GLC',
  'york':                     'YRK',
  'liverpool lime street':    'LIV',
  'liverpool':                'LIV',
  'newcastle':                'NCL',
  'cambridge':                'CBG',
  'oxford':                   'OXF',
  'reading':                  'RDG',
  'southampton central':      'SOU',
  'southampton':              'SOU',
  'portsmouth harbour':       'PMH',
  'portsmouth':               'PMS',
  'brighton':                 'BTN',
  'cardiff central':          'CDF',
  'cardiff':                  'CDF',
  'exeter st davids':         'EXD',
  'exeter':                   'EXC',
  'bath spa':                 'BTH',
  'bath':                     'BTH',
  'coventry':                 'COV',
  'wolverhampton':            'WVH',
  'stoke-on-trent':           'SOT',
  'stoke on trent':           'SOT',
  'stoke':                    'SOT',
  'crewe':                    'CRE',
  'chester':                  'CTR',
  'preston':                  'PRE',
  'lancaster':                'LAN',
  'carlisle':                 'CAR',
  'peterborough':             'PBO',
  'norwich':                  'NRW',
  'ipswich':                  'IPS',
  'colchester':               'COL',
  'guildford':                'GLD',
  'woking':                   'WOK',
  'basingstoke':              'BSK',
  'winchester':               'WIN',
  'bournemouth':              'BMH',
  'salisbury':                'SAL',
  'swindon':                  'SWI',
  'gloucester':               'GCR',
  'cheltenham spa':           'CNM',
  'cheltenham':               'CNM',
  'worcester foregate street': 'WOF',
  'worcester':                'WOF',
  'shrewsbury':               'SHR',
  'hereford':                 'HFD',
  'swansea':                  'SWA',
  'newport':                  'NWP',
  'aberystwyth':              'AYW',
  'aberdeen':                 'ABD',
  'inverness':                'INV',
  'dundee':                   'DEE',
  'perth':                    'PTH',
  'stirling':                 'STG',
  'hull':                     'HUL',
  'doncaster':                'DON',
  'huddersfield':             'HUD',
  'wakefield':                'WKF',
  'harrogate':                'HGT',
  'middlesbrough':            'MBR',
  'sunderland':               'SUN',
  'durham':                   'DHM',
  'darlington':               'DAR',
  'hartlepool':               'HPL',
  'grimsby town':             'GMB',
  'grimsby':                  'GMB',
  'lincoln central':          'LCN',
  'lincoln':                  'LCN',
  'barnsley':                 'BNY',
  'bradford forster square':  'BDQ',
  'bradford':                 'BDQ',
  'halifax':                  'HFX',
};

export function stationToCRS(name: string): string | null {
  const normalized = name
    .toLowerCase()
    .trim()
    .replace(/\s+station$/, '')
    .replace(/\s+/g, ' ');
  return CRS_CODES[normalized] ?? null;
}

// ── Typical advance fares by route (GBP) ─────────────────────────────────────
// RTT does not provide pricing. These are representative advance fares.

const TYPICAL_FARES: Record<string, number> = {
  'DBY-STP': 18, 'STP-DBY': 18,
  'DBY-EUS': 16, 'EUS-DBY': 16,
  'DBY-NOT': 8,  'NOT-DBY': 8,
  'DBY-LDS': 14, 'LDS-DBY': 14,
  'DBY-SHF': 10, 'SHF-DBY': 10,
  'DBY-MAN': 16, 'MAN-DBY': 16,
  'DBY-BHM': 12, 'BHM-DBY': 12,
  'MAN-EUS': 25, 'EUS-MAN': 25,
  'MAN-STP': 28, 'STP-MAN': 28,
  'MAN-LDS': 8,  'LDS-MAN': 8,
  'MAN-SHF': 12, 'SHF-MAN': 12,
  'LDS-KGX': 22, 'KGX-LDS': 22,
  'LDS-EUS': 24, 'EUS-LDS': 24,
  'LDS-SHF': 6,  'SHF-LDS': 6,
  'BHM-EUS': 18, 'EUS-BHM': 18,
  'BHM-STP': 22, 'STP-BHM': 22,
  'BHM-PAD': 22, 'PAD-BHM': 22,
  'NCL-KGX': 35, 'KGX-NCL': 35,
  'EDB-KGX': 45, 'KGX-EDB': 45,
  'EDB-EUS': 45, 'EUS-EDB': 45,
  'BRI-PAD': 22, 'PAD-BRI': 22,
  'OXF-PAD': 15, 'PAD-OXF': 15,
  'CBG-KGX': 18, 'KGX-CBG': 18,
  'NOT-STP': 22, 'STP-NOT': 22,
  'NOT-EUS': 20, 'EUS-NOT': 20,
  'LEI-STP': 20, 'STP-LEI': 20,
  'CRE-EUS': 22, 'EUS-CRE': 22,
  'YRK-KGX': 28, 'KGX-YRK': 28,
  'SHF-STP': 24, 'STP-SHF': 24,
  'SHF-KGX': 24, 'KGX-SHF': 24,
  'LIV-EUS': 25, 'EUS-LIV': 25,
  'CDF-PAD': 25, 'PAD-CDF': 25,
};

export function estimateFareGbp(originCRS: string, destCRS: string): number {
  const key = `${originCRS}-${destCRS}`;
  return TYPICAL_FARES[key] ?? 20; // default £20 if route unknown
}

// ── Date parsing ──────────────────────────────────────────────────────────────

export function parseRttDate(dateStr?: string): string {
  const now = new Date();

  const fmt = (d: Date) =>
    `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;

  if (!dateStr) {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    return fmt(d);
  }

  const lower = dateStr.toLowerCase().trim();

  if (lower === 'today') return fmt(now);

  if (lower === 'tomorrow') {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    return fmt(d);
  }

  // ISO YYYY-MM-DD
  const iso = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `${iso[1]}/${iso[2]}/${iso[3]}`;

  // Day names
  const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const dayIdx = DAYS.indexOf(lower);
  if (dayIdx >= 0) {
    const today = now.getDay();
    let ahead = dayIdx - today;
    if (ahead <= 0) ahead += 7;
    const d = new Date(now);
    d.setDate(d.getDate() + ahead);
    return fmt(d);
  }

  // "next monday" etc.
  const nextMatch = lower.match(/^next\s+(\w+)$/);
  if (nextMatch) {
    const idx = DAYS.indexOf(nextMatch[1]);
    if (idx >= 0) {
      const today = now.getDay();
      let ahead = idx - today;
      if (ahead <= 0) ahead += 7;
      const d = new Date(now);
      d.setDate(d.getDate() + ahead + 7); // always "next week"
      return fmt(d);
    }
  }

  // Default: tomorrow
  const d = new Date(now);
  d.setDate(d.getDate() + 1);
  return fmt(d);
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TrainService {
  departureTime: string;  // HH:MM
  arrivalTime?: string;   // HH:MM (at final destination if available)
  platform?: string;
  operator: string;
  serviceUid: string;
  destination: string;
  estimatedFareGbp: number;
}

export interface RttQueryResult {
  origin: string;
  originCRS: string;
  destination: string;
  destinationCRS: string;
  date: string;          // YYYY/MM/DD
  services: TrainService[];
  error?: string;
  noCredentials?: boolean;
}

// ── Main query ────────────────────────────────────────────────────────────────

export async function queryRTT(
  env: { RTT_USERNAME?: string; RTT_PASSWORD?: string },
  origin: string,
  destination: string,
  dateStr?: string,
  timePreference?: string,
): Promise<RttQueryResult> {
  const originCRS = stationToCRS(origin);
  const destCRS   = stationToCRS(destination);
  const date      = parseRttDate(dateStr);

  if (!originCRS) {
    return { origin, originCRS: '???', destination, destinationCRS: destCRS ?? '???', date, services: [], error: `Unknown station: ${origin}` };
  }
  if (!destCRS) {
    return { origin, originCRS, destination, destinationCRS: '???', date, services: [], error: `Unknown station: ${destination}` };
  }

  if (!env.RTT_USERNAME || !env.RTT_PASSWORD) {
    return { origin, originCRS, destination, destinationCRS: destCRS, date, services: [], noCredentials: true };
  }

  const auth = btoa(`${env.RTT_USERNAME}:${env.RTT_PASSWORD}`);
  const url  = `https://api.rtt.io/api/v1/json/search/${originCRS}/to/${destCRS}/${date}`;

  try {
    const res = await fetch(url, {
      headers: { Authorization: `Basic ${auth}` },
      // 5s timeout — Workers have a 30s CPU limit; don't block on slow RTT
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      return { origin, originCRS, destination, destinationCRS: destCRS, date, services: [], error: `RTT API ${res.status}` };
    }

    const data = await res.json() as {
      location?: { name?: string };
      filter?: { destination?: { name?: string } };
      services?: any[];
    };

    const allServices = data.services ?? [];

    // Filter by time preference
    const filtered = allServices.filter((s: any) => {
      const dep = s.locationDetail?.realtimeDeparture ?? s.locationDetail?.gbttBookingDep ?? '';
      if (!dep) return false;
      const hour = parseInt(dep.slice(0, 2), 10);
      if (timePreference === 'morning')   return hour >= 5  && hour < 12;
      if (timePreference === 'afternoon') return hour >= 12 && hour < 17;
      if (timePreference === 'evening')   return hour >= 17 && hour < 23;
      return true;
    });

    const farePerService = estimateFareGbp(originCRS, destCRS);

    const services: TrainService[] = filtered.slice(0, 5).map((s: any) => {
      const depRaw = s.locationDetail?.realtimeDeparture ?? s.locationDetail?.gbttBookingDep ?? '0000';
      const arrRaw = s.locationDetail?.destination?.[0]?.publicTime;
      return {
        departureTime:    formatTime(depRaw),
        arrivalTime:      arrRaw ? formatTime(arrRaw) : undefined,
        platform:         s.locationDetail?.platform ?? undefined,
        operator:         s.atocName ?? 'National Rail',
        serviceUid:       s.serviceUid ?? '',
        destination:      s.locationDetail?.destination?.[0]?.description ?? destination,
        estimatedFareGbp: farePerService,
      };
    });

    return {
      origin:          data.location?.name ?? origin,
      originCRS,
      destination:     data.filter?.destination?.name ?? destination,
      destinationCRS:  destCRS,
      date,
      services,
    };
  } catch (e: any) {
    return { origin, originCRS, destination, destinationCRS: destCRS, date, services: [], error: e.message ?? 'RTT fetch failed' };
  }
}

// ── Format helpers ────────────────────────────────────────────────────────────

function formatTime(raw: string): string {
  // RTT returns times as "0714" — format to "07:14"
  if (raw.length === 4) return `${raw.slice(0, 2)}:${raw.slice(2)}`;
  if (raw.includes(':'))  return raw.slice(0, 5);
  return raw;
}

/**
 * Format RTT results into natural language for Claude to narrate.
 * Claude will pick the best option and present it to the user.
 */
export function formatTrainsForClaude(result: RttQueryResult): string {
  if (result.noCredentials) {
    return `RTT API not configured. Cannot fetch live train times. Please set RTT_USERNAME and RTT_PASSWORD.`;
  }
  if (result.error || result.services.length === 0) {
    return `No trains found from ${result.origin} to ${result.destination} on ${result.date.replace(/\//g, '-')}. ${result.error ?? 'No services available.'}`;
  }

  const lines: string[] = [
    `Live trains from ${result.origin} to ${result.destination} (${result.date.replace(/\//g, '-')}):`,
    '',
  ];

  result.services.slice(0, 3).forEach((s, i) => {
    const arr  = s.arrivalTime ? ` → arrives ${s.arrivalTime}` : '';
    const plat = s.platform    ? `, Platform ${s.platform}`    : '';
    const fare = `£${s.estimatedFareGbp} advance`;
    lines.push(`${i + 1}. ${s.departureTime}${arr} — ${s.operator}${plat} — ${fare}`);
  });

  lines.push('');
  lines.push(`Present the best option (first or recommended) to the user in one clear sentence under 25 words. Include departure time, operator, platform if available, and estimated fare. Ask if they want to confirm.`);

  return lines.join('\n');
}
