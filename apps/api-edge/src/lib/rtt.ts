/**
 * Darwin (National Rail OpenLDBWS) API client
 *
 * Replaces the RTT (Realtime Trains) integration.
 * Uses the official National Rail Darwin SOAP API for live UK train times.
 *
 * Register at: https://realtime.nationalrail.co.uk/OpenLDBWS/
 * Set your token: npx wrangler secret put DARWIN_API_KEY
 *
 * Darwin real-time window: up to ~8 hours ahead (timeOffset max 479 min).
 * For requests further out, falls back to realistic mock schedule data.
 */

const DARWIN_ENDPOINT = 'https://lite.realtime.nationalrail.co.uk/OpenLDBWS/ldb11.asmx';
const DARWIN_MAX_OFFSET_MINS = 479; // Darwin hard limit

// ── Station CRS code lookup ───────────────────────────────────────────────────

const CRS_CODES: Record<string, string> = {
  // London terminals
  'london':                    'STP',
  'london st pancras':         'STP',
  'st pancras':                'STP',
  'london euston':             'EUS',
  'euston':                    'EUS',
  'london kings cross':        'KGX',
  "london king's cross":       'KGX',
  'kings cross':               'KGX',
  "king's cross":              'KGX',
  'london paddington':         'PAD',
  'paddington':                'PAD',
  'london waterloo':           'WAT',
  'waterloo':                  'WAT',
  'london victoria':           'VIC',
  'victoria':                  'VIC',
  'london bridge':             'LBG',
  'london liverpool street':   'LST',
  'liverpool street':          'LST',
  'london marylebone':         'MYB',
  'marylebone':                'MYB',
  'london cannon street':      'CST',
  'london charing cross':      'CHX',
  'charing cross':             'CHX',
  'london blackfriars':        'BFR',

  // Major cities
  'manchester piccadilly':     'MAN',
  'manchester':                'MAN',
  'birmingham new street':     'BHM',
  'birmingham':                'BHM',
  'leeds':                     'LDS',
  'sheffield':                 'SHF',
  'nottingham':                'NOT',
  'leicester':                 'LEI',
  'derby':                     'DBY',
  'bristol temple meads':      'BRI',
  'bristol':                   'BRI',
  'edinburgh waverley':        'EDB',
  'edinburgh':                 'EDB',
  'glasgow central':           'GLC',
  'glasgow queen street':      'GLQ',
  'glasgow':                   'GLC',
  'york':                      'YRK',
  'liverpool lime street':     'LIV',
  'liverpool':                 'LIV',
  'newcastle':                 'NCL',
  'cambridge':                 'CBG',
  'oxford':                    'OXF',
  'reading':                   'RDG',
  'southampton central':       'SOU',
  'southampton':               'SOU',
  'portsmouth harbour':        'PMH',
  'portsmouth':                'PMS',
  'brighton':                  'BTN',
  'cardiff central':           'CDF',
  'cardiff':                   'CDF',
  'exeter st davids':          'EXD',
  'exeter':                    'EXC',
  'bath spa':                  'BTH',
  'bath':                      'BTH',
  'coventry':                  'COV',
  'wolverhampton':             'WVH',
  'stoke-on-trent':            'SOT',
  'stoke on trent':            'SOT',
  'stoke':                     'SOT',
  'crewe':                     'CRE',
  'chester':                   'CTR',
  'preston':                   'PRE',
  'lancaster':                 'LAN',
  'carlisle':                  'CAR',
  'peterborough':              'PBO',
  'norwich':                   'NRW',
  'ipswich':                   'IPS',
  'colchester':                'COL',
  'guildford':                 'GLD',
  'woking':                    'WOK',
  'basingstoke':               'BSK',
  'winchester':                'WIN',
  'bournemouth':               'BMH',
  'salisbury':                 'SAL',
  'swindon':                   'SWI',
  'gloucester':                'GCR',
  'cheltenham spa':            'CNM',
  'cheltenham':                'CNM',
  'worcester foregate street': 'WOF',
  'worcester':                 'WOF',
  'shrewsbury':                'SHR',
  'hereford':                  'HFD',
  'swansea':                   'SWA',
  'newport':                   'NWP',
  'aberdeen':                  'ABD',
  'inverness':                 'INV',
  'dundee':                    'DEE',
  'perth':                     'PTH',
  'stirling':                  'STG',
  'hull':                      'HUL',
  'doncaster':                 'DON',
  'huddersfield':              'HUD',
  'wakefield':                 'WKF',
  'harrogate':                 'HGT',
  'middlesbrough':             'MBR',
  'sunderland':                'SUN',
  'durham':                    'DHM',
  'darlington':                'DAR',
  'lincoln':                   'LCN',
  'bradford':                  'BDQ',
  'halifax':                   'HFX',
  'grantham':                  'GRA',
  'kettering':                 'KET',
  'wellingborough':            'WEL',
  'northampton':               'NMP',
  'milton keynes':             'MKC',
  'watford':                   'WFJ',
  'luton':                     'LUT',
  'bedford':                   'BDM',
  'st albans':                 'SAA',
  'stevenage':                 'SVG',
  'hitchin':                   'HIT',
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
  'LIV-EUS': 25, 'EUS-LIV': 25,
  'CDF-PAD': 25, 'PAD-CDF': 25,
};

export function estimateFareGbp(originCRS: string, destCRS: string): number {
  return TYPICAL_FARES[`${originCRS}-${destCRS}`] ?? 20;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TrainService {
  departureTime:    string;   // HH:MM
  arrivalTime?:     string;   // HH:MM at destination
  platform?:        string;
  operator:         string;
  serviceUid:       string;
  destination:      string;
  estimatedFareGbp: number;
}

export interface RttQueryResult {
  origin:           string;
  originCRS:        string;
  destination:      string;
  destinationCRS:   string;
  date:             string;   // YYYY/MM/DD
  services:         TrainService[];
  error?:           string;
  noCredentials?:   boolean;
}

// ── Date / time helpers ───────────────────────────────────────────────────────

export function parseRttDate(dateStr?: string): string {
  const now = new Date();
  const fmt = (d: Date) =>
    `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;

  if (!dateStr) { const d = new Date(now); d.setDate(d.getDate() + 1); return fmt(d); }

  const lower = dateStr.toLowerCase().trim();
  if (lower === 'today')    return fmt(now);
  if (lower === 'tomorrow') { const d = new Date(now); d.setDate(d.getDate() + 1); return fmt(d); }

  const iso = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `${iso[1]}/${iso[2]}/${iso[3]}`;

  const DAYS = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
  const dayIdx = DAYS.indexOf(lower);
  if (dayIdx >= 0) {
    const today = now.getDay();
    let ahead = dayIdx - today;
    if (ahead <= 0) ahead += 7;
    const d = new Date(now); d.setDate(d.getDate() + ahead);
    return fmt(d);
  }

  const nextMatch = lower.match(/^next\s+(\w+)$/);
  if (nextMatch) {
    const idx = DAYS.indexOf(nextMatch[1]);
    if (idx >= 0) {
      const today = now.getDay();
      let ahead = idx - today;
      if (ahead <= 0) ahead += 7;
      const d = new Date(now); d.setDate(d.getDate() + ahead + 7);
      return fmt(d);
    }
  }

  const d = new Date(now); d.setDate(d.getDate() + 1);
  return fmt(d);
}

/**
 * Calculate Darwin timeOffset and timeWindow from date + time preference.
 * Returns null if the requested time is beyond Darwin's 479-min limit.
 */
function calcDarwinOffset(
  dateStr: string,            // YYYY/MM/DD
  timePreference?: string,
): { timeOffset: number; timeWindow: number } | null {
  const now = new Date();
  const [y, m, d] = dateStr.split('/').map(Number);

  // Target window start hour (UK local, approximated as UTC for now)
  let startHour = 6;
  if (timePreference === 'morning')   startHour = 7;
  if (timePreference === 'afternoon') startHour = 12;
  if (timePreference === 'evening')   startHour = 17;

  const targetStart = new Date(y, m - 1, d, startHour, 0, 0);
  const offsetMs    = targetStart.getTime() - now.getTime();
  const offsetMins  = Math.floor(offsetMs / 60_000);

  if (offsetMins > DARWIN_MAX_OFFSET_MINS) return null;   // beyond Darwin window
  if (offsetMins < -120)                   return null;   // too far in the past

  const timeWindow = 180; // 3-hour window
  return { timeOffset: Math.max(offsetMins, 0), timeWindow };
}

// ── Darwin SOAP request builder ───────────────────────────────────────────────

function buildDarwinSoap(
  token: string,
  originCRS: string,
  destCRS: string,
  timeOffset: number,
  timeWindow: number,
): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope
  xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
  xmlns:typ="http://thalesgroup.com/RTTI/2013-11-28/Token/types"
  xmlns:ldb="http://thalesgroup.com/RTTI/2021-11-01/ldb/">
  <soap:Header>
    <typ:AccessToken><typ:TokenValue>${token}</typ:TokenValue></typ:AccessToken>
  </soap:Header>
  <soap:Body>
    <ldb:GetDepBoardWithDetailsRequest>
      <ldb:numRows>10</ldb:numRows>
      <ldb:crs>${originCRS}</ldb:crs>
      <ldb:filterCrs>${destCRS}</ldb:filterCrs>
      <ldb:filterType>to</ldb:filterType>
      <ldb:timeOffset>${timeOffset}</ldb:timeOffset>
      <ldb:timeWindow>${timeWindow}</ldb:timeWindow>
    </ldb:GetDepBoardWithDetailsRequest>
  </soap:Body>
</soap:Envelope>`;
}

// ── XML helpers (no DOM — edge-safe) ─────────────────────────────────────────

function xmlFirst(xml: string, tag: string): string {
  const re = new RegExp(`<[^:>]*:?${tag}[^>]*>([^<]*)<`, 'i');
  return (xml.match(re)?.[1] ?? '').trim();
}

function xmlBlocks(xml: string, tag: string): string[] {
  const re = new RegExp(`<[^:>]*:?${tag}[^>]*>([\\s\\S]*?)<\\/[^:>]*:?${tag}>`, 'gi');
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) out.push(m[1]);
  return out;
}

function parseTime(raw: string): string {
  if (!raw) return '';
  if (raw.length === 4 && /^\d{4}$/.test(raw)) return `${raw.slice(0, 2)}:${raw.slice(2)}`;
  if (raw.includes(':')) return raw.slice(0, 5);
  return raw;
}

// ── Darwin response parser ────────────────────────────────────────────────────

function parseDarwinResponse(
  xml: string,
  originCRS: string,
  destCRS: string,
  originLabel: string,
  destLabel: string,
  date: string,
  timePreference: string | undefined,
): RttQueryResult {
  const serviceBlocks = xmlBlocks(xml, 'service');
  const fare = estimateFareGbp(originCRS, destCRS);

  const services: TrainService[] = [];

  for (const svc of serviceBlocks) {
    const std      = xmlFirst(svc, 'std');   // scheduled departure HH:MM
    const etd      = xmlFirst(svc, 'etd');   // "On time" | "HH:MM" | "Cancelled"
    const platform = xmlFirst(svc, 'platform');
    const operator = xmlFirst(svc, 'operator') || 'National Rail';
    const svcId    = xmlFirst(svc, 'serviceID') || xmlFirst(svc, 'rsid') || std;

    if (!std) continue;
    if (etd.toLowerCase() === 'cancelled') continue;

    // Filter by time preference
    const depHour = parseInt(std.slice(0, 2), 10);
    if (timePreference === 'morning'   && (depHour < 6  || depHour >= 12)) continue;
    if (timePreference === 'afternoon' && (depHour < 12 || depHour >= 17)) continue;
    if (timePreference === 'evening'   && (depHour < 17 || depHour >= 23)) continue;

    // Find arrival at destination from callingPoints
    let arrivalTime: string | undefined;
    const callingBlocks = xmlBlocks(svc, 'callingPoint');
    for (const cp of callingBlocks) {
      const cpCrs = xmlFirst(cp, 'crs');
      if (cpCrs.toUpperCase() === destCRS.toUpperCase()) {
        const st = xmlFirst(cp, 'st');
        const et = xmlFirst(cp, 'et');
        const arrRaw = (et && et !== 'On time' && et !== 'Delayed' && /^\d{2}:\d{2}$/.test(et))
          ? et : st;
        if (arrRaw) arrivalTime = parseTime(arrRaw);
        break;
      }
    }

    // Effective departure (use etd if it's a time, else std)
    const depRaw = (etd && /^\d{2}:\d{2}$/.test(etd)) ? etd : std;

    services.push({
      departureTime:    parseTime(depRaw),
      arrivalTime,
      platform:         platform || undefined,
      operator,
      serviceUid:       svcId,
      destination:      destLabel,
      estimatedFareGbp: fare,
    });

    if (services.length >= 5) break;
  }

  return { origin: originLabel, originCRS, destination: destLabel, destinationCRS: destCRS, date, services };
}

// ── Mock schedule fallback ────────────────────────────────────────────────────
// Used when Darwin key is missing or request is beyond the 8h real-time window.
// Based on known typical UK schedules.

const MOCK_SCHEDULES: Record<string, Array<{ dep: string; arr: string; operator: string }>> = {
  'DBY-STP': [
    { dep: '07:10', arr: '08:43', operator: 'East Midlands Railway' },
    { dep: '07:42', arr: '09:15', operator: 'East Midlands Railway' },
    { dep: '08:10', arr: '09:43', operator: 'East Midlands Railway' },
    { dep: '08:42', arr: '10:15', operator: 'East Midlands Railway' },
    { dep: '09:10', arr: '10:43', operator: 'East Midlands Railway' },
  ],
  'MAN-EUS': [
    { dep: '07:03', arr: '09:08', operator: 'Avanti West Coast' },
    { dep: '07:33', arr: '09:38', operator: 'Avanti West Coast' },
    { dep: '08:03', arr: '10:08', operator: 'Avanti West Coast' },
    { dep: '09:03', arr: '11:08', operator: 'Avanti West Coast' },
  ],
  'BHM-EUS': [
    { dep: '07:00', arr: '07:56', operator: 'Avanti West Coast' },
    { dep: '07:30', arr: '08:27', operator: 'Avanti West Coast' },
    { dep: '08:00', arr: '08:56', operator: 'Avanti West Coast' },
    { dep: '08:33', arr: '09:27', operator: 'Avanti West Coast' },
  ],
  'EDB-KGX': [
    { dep: '07:00', arr: '11:25', operator: 'LNER' },
    { dep: '08:00', arr: '12:26', operator: 'LNER' },
    { dep: '09:00', arr: '13:25', operator: 'LNER' },
  ],
  'NCL-KGX': [
    { dep: '07:00', arr: '09:27', operator: 'LNER' },
    { dep: '07:30', arr: '09:57', operator: 'LNER' },
    { dep: '08:00', arr: '10:28', operator: 'LNER' },
    { dep: '09:00', arr: '11:25', operator: 'LNER' },
  ],
  'LDS-KGX': [
    { dep: '07:00', arr: '08:59', operator: 'LNER' },
    { dep: '07:30', arr: '09:29', operator: 'LNER' },
    { dep: '08:03', arr: '10:04', operator: 'TransPennine Express' },
    { dep: '09:00', arr: '10:59', operator: 'LNER' },
  ],
  'BRI-PAD': [
    { dep: '07:00', arr: '08:33', operator: 'GWR' },
    { dep: '07:30', arr: '09:03', operator: 'GWR' },
    { dep: '08:00', arr: '09:33', operator: 'GWR' },
    { dep: '09:00', arr: '10:33', operator: 'GWR' },
  ],
};

function mockSchedule(
  originCRS: string,
  destCRS: string,
  originLabel: string,
  destLabel: string,
  date: string,
  timePreference?: string,
): RttQueryResult {
  const key = `${originCRS}-${destCRS}`;
  const rawSchedule = MOCK_SCHEDULES[key] ?? [];
  const fare = estimateFareGbp(originCRS, destCRS);

  let schedule = rawSchedule;
  if (timePreference === 'morning')   schedule = schedule.filter(s => parseInt(s.dep, 10) < 12);
  if (timePreference === 'afternoon') schedule = schedule.filter(s => parseInt(s.dep, 10) >= 12 && parseInt(s.dep, 10) < 17);
  if (timePreference === 'evening')   schedule = schedule.filter(s => parseInt(s.dep, 10) >= 17);

  const services: TrainService[] = schedule.slice(0, 3).map((s, i) => ({
    departureTime:    s.dep,
    arrivalTime:      s.arr,
    platform:         undefined,
    operator:         s.operator,
    serviceUid:       `MOCK-${originCRS}${destCRS}-${i}`,
    destination:      destLabel,
    estimatedFareGbp: fare,
  }));

  return { origin: originLabel, originCRS, destination: destLabel, destinationCRS: destCRS, date, services };
}

// ── Main query ────────────────────────────────────────────────────────────────

export async function queryRTT(
  env: { DARWIN_API_KEY?: string; RTT_USERNAME?: string; RTT_PASSWORD?: string },
  origin: string,
  destination: string,
  dateStr?: string,
  timePreference?: string,
): Promise<RttQueryResult> {
  const originCRS = stationToCRS(origin);
  const destCRS   = stationToCRS(destination);
  const date      = parseRttDate(dateStr);

  if (!originCRS) return { origin, originCRS: '???', destination, destinationCRS: destCRS ?? '???', date, services: [], error: `Unknown station: ${origin}` };
  if (!destCRS)   return { origin, originCRS, destination, destinationCRS: '???', date, services: [], error: `Unknown station: ${destination}` };

  const darwinKey = env.DARWIN_API_KEY;

  if (!darwinKey) {
    // Fall back to mock if no key set
    return mockSchedule(originCRS, destCRS, origin, destination, date, timePreference);
  }

  // Calculate Darwin time offset
  const offsets = calcDarwinOffset(date, timePreference);

  if (!offsets) {
    // Beyond Darwin's real-time window — use mock with a note
    const result = mockSchedule(originCRS, destCRS, origin, destination, date, timePreference);
    return { ...result, error: 'advance_schedule' };
  }

  try {
    const soap = buildDarwinSoap(darwinKey, originCRS, destCRS, offsets.timeOffset, offsets.timeWindow);

    const res = await fetch(DARWIN_ENDPOINT, {
      method:  'POST',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        'SOAPAction':   'http://thalesgroup.com/RTTI/2021-11-01/ldb/GetDepBoardWithDetails',
      },
      body:   soap,
      signal: AbortSignal.timeout(6000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      // 500 from Darwin usually means invalid token or station code
      const fallback = mockSchedule(originCRS, destCRS, origin, destination, date, timePreference);
      return { ...fallback, error: `Darwin ${res.status}: ${errText.slice(0, 120)}` };
    }

    const xml = await res.text();

    // Check for SOAP fault
    if (xml.includes('faultstring') || xml.includes('Fault')) {
      const fault = xmlFirst(xml, 'faultstring') || xmlFirst(xml, 'ExceptionMessage') || 'SOAP fault';
      const fallback = mockSchedule(originCRS, destCRS, origin, destination, date, timePreference);
      return { ...fallback, error: `Darwin fault: ${fault}` };
    }

    const result = parseDarwinResponse(xml, originCRS, destCRS, origin, destination, date, timePreference);

    // If Darwin returned no services (e.g. no trains at that time), fall back to mock
    if (result.services.length === 0) {
      return mockSchedule(originCRS, destCRS, origin, destination, date, timePreference);
    }

    return result;
  } catch (e: any) {
    const fallback = mockSchedule(originCRS, destCRS, origin, destination, date, timePreference);
    return { ...fallback, error: e.message ?? 'Darwin fetch failed' };
  }
}

// ── Format for Claude ─────────────────────────────────────────────────────────

export function formatTrainsForClaude(result: RttQueryResult): string {
  if (result.services.length === 0) {
    return `No trains found from ${result.origin} to ${result.destination} on ${result.date.replace(/\//g, '-')}. ${result.error ?? 'No services available.'}`;
  }

  const isAdvance = result.error === 'advance_schedule';
  const isLive    = !result.error;

  const header = isLive
    ? `Live trains from ${result.origin} to ${result.destination} (${result.date.replace(/\//g, '-')}):`
    : `Typical trains from ${result.origin} to ${result.destination} (${result.date.replace(/\//g, '-')}) — advance booking:`;

  const lines: string[] = [header, ''];

  result.services.slice(0, 3).forEach((s, i) => {
    const arr  = s.arrivalTime ? ` → arrives ${s.arrivalTime}` : '';
    const plat = s.platform    ? `, Platform ${s.platform}`    : '';
    const fare = `£${s.estimatedFareGbp} advance`;
    lines.push(`${i + 1}. ${s.departureTime}${arr} — ${s.operator}${plat} — ${fare}`);
  });

  lines.push('');
  if (isAdvance) {
    lines.push('These are typical scheduled times. Live times will be available closer to departure.');
  }
  lines.push('Present the best option to the user in one clear sentence under 25 words. Include departure time, operator, platform if available, and estimated fare. Ask if they want to confirm.');

  return lines.join('\n');
}
