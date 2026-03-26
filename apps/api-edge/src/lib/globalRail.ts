/**
 * Global Rail client — Japan, USA, Canada, South Korea, SE Asia, Australia.
 *
 * Suppliers (in priority order):
 *   1. G2Rail API   (live, Japan/Korea/USA/Canada/EU) — requires G2RAIL_API_KEY
 *   2. 12Go API     (live, SE Asia multimodal)         — requires TWELVEGO_API_KEY
 *   3. Realistic mock schedule                         — always available
 *
 * Coverage:
 *   Shinkansen   — Japan bullet trains (Nozomi/Hikari/Kodama)
 *   Amtrak       — USA intercity (Northeast Corridor, California Zephyr, etc.)
 *   VIA Rail     — Canada (Toronto–Montréal, Vancouver–Kamloops, etc.)
 *   KTX / SRT    — South Korea (Seoul–Busan, Seoul–Gwangju, etc.)
 *   SE Asia      — Bangkok–Chiang Mai, Singapore–KL, Hanoi–Ho Chi Minh, etc.
 *   Australia    — XPT/Indian Pacific/The Ghan (Sydney–Melbourne, etc.)
 *
 * When G2Rail partnership is active:
 *   npx wrangler secret put G2RAIL_API_KEY
 *   npx wrangler secret put TWELVEGO_API_KEY
 */

import type { Env } from '../types';
import type { RttQueryResult, TrainService } from './rtt';

// ── Station name normalisation ─────────────────────────────────────────────

const GLOBAL_STATIONS: Record<string, { display: string; region: Region; currency: Currency }> = {
  // ── Japan ─────────────────────────────────────────────────────────────────
  'tokyo':                  { display: 'Tokyo',             region: 'japan',     currency: 'JPY' },
  'tokyo station':          { display: 'Tokyo',             region: 'japan',     currency: 'JPY' },
  'shin-osaka':             { display: 'Shin-Osaka',        region: 'japan',     currency: 'JPY' },
  'osaka':                  { display: 'Shin-Osaka',        region: 'japan',     currency: 'JPY' },
  'kyoto':                  { display: 'Kyoto',             region: 'japan',     currency: 'JPY' },
  'hiroshima':              { display: 'Hiroshima',         region: 'japan',     currency: 'JPY' },
  'nagoya':                 { display: 'Nagoya',            region: 'japan',     currency: 'JPY' },
  'fukuoka':                { display: 'Hakata (Fukuoka)',  region: 'japan',     currency: 'JPY' },
  'hakata':                 { display: 'Hakata (Fukuoka)',  region: 'japan',     currency: 'JPY' },
  'sapporo':                { display: 'Sapporo',           region: 'japan',     currency: 'JPY' },
  'sendai':                 { display: 'Sendai',            region: 'japan',     currency: 'JPY' },
  'nara':                   { display: 'Nara',              region: 'japan',     currency: 'JPY' },
  'kobe':                   { display: 'Shin-Kobe',         region: 'japan',     currency: 'JPY' },
  'shin-kobe':              { display: 'Shin-Kobe',         region: 'japan',     currency: 'JPY' },

  // ── USA ────────────────────────────────────────────────────────────────────
  'new york':               { display: 'New York Penn',     region: 'usa',       currency: 'USD' },
  'new york penn':          { display: 'New York Penn',     region: 'usa',       currency: 'USD' },
  'nyc':                    { display: 'New York Penn',     region: 'usa',       currency: 'USD' },
  'washington':             { display: 'Washington Union',  region: 'usa',       currency: 'USD' },
  'washington dc':          { display: 'Washington Union',  region: 'usa',       currency: 'USD' },
  'dc':                     { display: 'Washington Union',  region: 'usa',       currency: 'USD' },
  'boston':                 { display: 'Boston South',      region: 'usa',       currency: 'USD' },
  'philadelphia':           { display: 'Philadelphia',      region: 'usa',       currency: 'USD' },
  'chicago':                { display: 'Chicago Union',     region: 'usa',       currency: 'USD' },
  'los angeles':            { display: 'Los Angeles Union', region: 'usa',       currency: 'USD' },
  'la':                     { display: 'Los Angeles Union', region: 'usa',       currency: 'USD' },
  'san francisco':          { display: 'San Francisco Emb', region: 'usa',       currency: 'USD' },
  'sf':                     { display: 'San Francisco Emb', region: 'usa',       currency: 'USD' },
  'seattle':                { display: 'Seattle King St',   region: 'usa',       currency: 'USD' },
  'portland':               { display: 'Portland Union',    region: 'usa',       currency: 'USD' },
  'new orleans':            { display: 'New Orleans',       region: 'usa',       currency: 'USD' },
  'miami':                  { display: 'Miami',             region: 'usa',       currency: 'USD' },
  'orlando':                { display: 'Orlando',           region: 'usa',       currency: 'USD' },
  'denver':                 { display: 'Denver Union',      region: 'usa',       currency: 'USD' },

  // ── Canada ─────────────────────────────────────────────────────────────────
  'toronto':                { display: 'Toronto Union',     region: 'canada',    currency: 'CAD' },
  'montreal':               { display: 'Montréal Central',  region: 'canada',    currency: 'CAD' },
  'montréal':               { display: 'Montréal Central',  region: 'canada',    currency: 'CAD' },
  'ottawa':                 { display: 'Ottawa',            region: 'canada',    currency: 'CAD' },
  'vancouver':              { display: 'Vancouver Pacific', region: 'canada',    currency: 'CAD' },
  'quebec':                 { display: 'Québec City',       region: 'canada',    currency: 'CAD' },
  'quebec city':            { display: 'Québec City',       region: 'canada',    currency: 'CAD' },
  'kingston':               { display: 'Kingston',          region: 'canada',    currency: 'CAD' },
  'windsor':                { display: 'Windsor',           region: 'canada',    currency: 'CAD' },

  // ── South Korea ────────────────────────────────────────────────────────────
  'seoul':                  { display: 'Seoul',             region: 'korea',     currency: 'KRW' },
  'busan':                  { display: 'Busan',             region: 'korea',     currency: 'KRW' },
  'daegu':                  { display: 'Dongdaegu',         region: 'korea',     currency: 'KRW' },
  'dongdaegu':              { display: 'Dongdaegu',         region: 'korea',     currency: 'KRW' },
  'gwangju':                { display: 'Gwangju Songjeong', region: 'korea',     currency: 'KRW' },
  'incheon':                { display: 'Incheon Airport',   region: 'korea',     currency: 'KRW' },
  'daejeon':                { display: 'Daejeon',           region: 'korea',     currency: 'KRW' },
  'suwon':                  { display: 'Suwon',             region: 'korea',     currency: 'KRW' },

  // ── SE Asia ────────────────────────────────────────────────────────────────
  'bangkok':                { display: 'Bangkok Hua Lamphong', region: 'seasia', currency: 'THB' },
  'hua lamphong':           { display: 'Bangkok Hua Lamphong', region: 'seasia', currency: 'THB' },
  'chiang mai':             { display: 'Chiang Mai',        region: 'seasia',    currency: 'THB' },
  'chiang rai':             { display: 'Chiang Rai',        region: 'seasia',    currency: 'THB' },
  'pattaya':                { display: 'Pattaya',           region: 'seasia',    currency: 'THB' },
  'singapore':              { display: 'Singapore Woodlands', region: 'seasia',  currency: 'SGD' },
  'kuala lumpur':           { display: 'Kuala Lumpur Sentral', region: 'seasia', currency: 'MYR' },
  'kl':                     { display: 'Kuala Lumpur Sentral', region: 'seasia', currency: 'MYR' },
  'penang':                 { display: 'Butterworth (Penang)', region: 'seasia', currency: 'MYR' },
  'johor bahru':            { display: 'Johor Bahru',       region: 'seasia',    currency: 'MYR' },
  'jb':                     { display: 'Johor Bahru',       region: 'seasia',    currency: 'MYR' },
  'hanoi':                  { display: 'Hanoi',             region: 'seasia',    currency: 'VND' },
  'ho chi minh':            { display: 'Ho Chi Minh City',  region: 'seasia',    currency: 'VND' },
  'saigon':                 { display: 'Ho Chi Minh City',  region: 'seasia',    currency: 'VND' },
  'hue':                    { display: 'Hué',               region: 'seasia',    currency: 'VND' },
  'da nang':                { display: 'Da Nang',           region: 'seasia',    currency: 'VND' },
  'jakarta':                { display: 'Jakarta Gambir',    region: 'seasia',    currency: 'IDR' },
  'bandung':                { display: 'Bandung',           region: 'seasia',    currency: 'IDR' },
  'surabaya':               { display: 'Surabaya Gubeng',   region: 'seasia',    currency: 'IDR' },
  'yogyakarta':             { display: 'Yogyakarta',        region: 'seasia',    currency: 'IDR' },
  'jogja':                  { display: 'Yogyakarta',        region: 'seasia',    currency: 'IDR' },

  // ── Australia ──────────────────────────────────────────────────────────────
  'sydney':                 { display: 'Sydney Central',    region: 'australia', currency: 'AUD' },
  'melbourne':              { display: 'Melbourne Southern Cross', region: 'australia', currency: 'AUD' },
  'brisbane':               { display: 'Brisbane Roma St',  region: 'australia', currency: 'AUD' },
  'adelaide':               { display: 'Adelaide',          region: 'australia', currency: 'AUD' },
  'perth':                  { display: 'Perth',             region: 'australia', currency: 'AUD' },
  'canberra':               { display: 'Canberra',          region: 'australia', currency: 'AUD' },
  'gold coast':             { display: 'Gold Coast',        region: 'australia', currency: 'AUD' },
};

type Region   = 'japan' | 'usa' | 'canada' | 'korea' | 'seasia' | 'australia';
type Currency = 'JPY' | 'USD' | 'CAD' | 'KRW' | 'THB' | 'SGD' | 'MYR' | 'VND' | 'IDR' | 'AUD';

export interface GlobalRailResult extends RttQueryResult {
  currency: Currency;
  region: Region;
}

function resolveStation(name: string): { display: string; region: Region; currency: Currency } | undefined {
  return GLOBAL_STATIONS[name.toLowerCase().trim()];
}

/** True if either origin or destination is a known global-rail city (not UK, not EU, not India). */
export function isGlobalRoute(origin: string, destination: string): boolean {
  return !!(resolveStation(origin) || resolveStation(destination));
}

// ── Fares by corridor (local currency, approximate) ───────────────────────

const GLOBAL_FARES: Record<string, number> = {
  // Japan (JPY)
  'tokyo-osaka':         13870, 'osaka-tokyo':         13870,
  'tokyo-kyoto':         13870, 'kyoto-tokyo':         13870,
  'tokyo-hiroshima':     18040, 'hiroshima-tokyo':     18040,
  'tokyo-nagoya':         6560, 'nagoya-tokyo':         6560,
  'tokyo-fukuoka':       22320, 'fukuoka-tokyo':       22320,
  'tokyo-sendai':         6590, 'sendai-tokyo':         6590,
  'osaka-hiroshima':      9440, 'hiroshima-osaka':      9440,
  'osaka-kyoto':          1420, 'kyoto-osaka':          1420,
  'osaka-fukuoka':        9640, 'fukuoka-osaka':        9640,
  'nagoya-kyoto':         5810, 'kyoto-nagoya':         5810,
  'tokyo-kobe':          14990, 'kobe-tokyo':          14990,

  // USA (USD)
  'new york-washington':     49, 'washington-new york':     49,
  'new york-boston':         45, 'boston-new york':         45,
  'new york-philadelphia':   28, 'philadelphia-new york':   28,
  'new york-chicago':       108, 'chicago-new york':       108,
  'washington-philadelphia': 18, 'philadelphia-washington': 18,
  'washington-boston':       74, 'boston-washington':       74,
  'chicago-new orleans':    100, 'new orleans-chicago':    100,
  'los angeles-seattle':    115, 'seattle-los angeles':    115,
  'los angeles-san francisco': 65, 'san francisco-los angeles': 65,
  'seattle-portland':        35, 'portland-seattle':        35,
  'los angeles-portland':    80, 'portland-los angeles':    80,

  // Canada (CAD)
  'toronto-montreal':        62, 'montreal-toronto':        62,
  'toronto-ottawa':          45, 'ottawa-toronto':          45,
  'montreal-quebec':         35, 'quebec-montreal':         35,
  'toronto-kingston':        30, 'kingston-toronto':        30,
  'toronto-windsor':         50, 'windsor-toronto':         50,
  'vancouver-seattle':       35, 'seattle-vancouver':       35,

  // South Korea (KRW)
  'seoul-busan':          59800, 'busan-seoul':          59800,
  'seoul-daegu':          42600, 'daegu-seoul':          42600,
  'seoul-gwangju':        46800, 'gwangju-seoul':        46800,
  'seoul-daejeon':        23700, 'daejeon-seoul':        23700,
  'busan-daegu':          14800, 'daegu-busan':          14800,

  // SE Asia (mixed — stored in local currency)
  'bangkok-chiang mai':     798, 'chiang mai-bangkok':     798,  // THB
  'singapore-kuala lumpur': 35,  'kuala lumpur-singapore':  35,  // SGD/MYR (SGD used)
  'hanoi-ho chi minh':     350000,'ho chi minh-hanoi':    350000, // VND
  'hanoi-hue':             150000,'hue-hanoi':             150000,
  'ho chi minh-hue':       200000,'hue-ho chi minh':      200000,
  'jakarta-bandung':        90000,'bandung-jakarta':        90000, // IDR
  'jakarta-yogyakarta':    150000,'yogyakarta-jakarta':    150000,
  'jakarta-surabaya':      200000,'surabaya-jakarta':      200000,

  // Australia (AUD)
  'sydney-melbourne':        59, 'melbourne-sydney':        59,
  'sydney-brisbane':         79, 'brisbane-sydney':         79,
  'sydney-canberra':         29, 'canberra-sydney':         29,
  'melbourne-adelaide':      89, 'adelaide-melbourne':      89,
  'brisbane-gold coast':     15, 'gold coast-brisbane':     15,
};

function estimateGlobalFare(origin: string, destination: string): number {
  const key = `${origin.toLowerCase().split(' ')[0]}-${destination.toLowerCase().split(' ')[0]}`;
  // Try full first-word key, then longer matches
  for (const [k, v] of Object.entries(GLOBAL_FARES)) {
    const [o, d] = k.split('-');
    if (origin.toLowerCase().startsWith(o) && destination.toLowerCase().startsWith(d)) return v;
  }
  // Region-based defaults
  const station = resolveStation(origin) ?? resolveStation(destination);
  switch (station?.region) {
    case 'japan':     return 8000;
    case 'usa':       return 60;
    case 'canada':    return 50;
    case 'korea':     return 40000;
    case 'seasia':    return 500;
    case 'australia': return 55;
    default:          return 50;
  }
  void key;
}

// ── Operators ──────────────────────────────────────────────────────────────

function globalOperator(origin: string, destination: string, region: Region): string {
  switch (region) {
    case 'japan':     return 'JR Shinkansen';
    case 'usa':       return 'Amtrak';
    case 'canada':    return 'VIA Rail';
    case 'korea':     {
      const o = origin.toLowerCase(); const d = destination.toLowerCase();
      if (o.includes('busan') || d.includes('busan') || o.includes('gwangju') || d.includes('gwangju')) return 'Korail SRT';
      return 'Korail KTX';
    }
    case 'seasia':    {
      const o = origin.toLowerCase();
      if (o.includes('singapore') || o.includes('kuala') || o.includes('penang') || o.includes('johor')) return 'KTM Intercity';
      if (o.includes('jakarta') || o.includes('bandung') || o.includes('surabaya')) return 'KAI (Kereta Api)';
      if (o.includes('hanoi') || o.includes('ho chi minh') || o.includes('hue') || o.includes('da nang')) return 'Vietnam Railways (VR)';
      return 'State Railways of Thailand (SRT)';
    }
    case 'australia': {
      const o = origin.toLowerCase(); const d = destination.toLowerCase();
      if ((o.includes('sydney') || d.includes('sydney')) && (o.includes('melbourne') || d.includes('melbourne'))) return 'NSW TrainLink XPT';
      if (o.includes('brisbane') || d.includes('brisbane')) return 'Queensland Rail';
      if (o.includes('perth') || d.includes('perth')) return 'TransWA / Indian Pacific';
      return 'Great Southern Rail';
    }
  }
}

// ── Durations (minutes) ────────────────────────────────────────────────────

const GLOBAL_DURATIONS: Record<string, number> = {
  // Japan
  'tokyo-osaka': 135, 'osaka-tokyo': 135,
  'tokyo-kyoto': 130, 'kyoto-tokyo': 130,
  'tokyo-hiroshima': 240, 'hiroshima-tokyo': 240,
  'tokyo-nagoya': 85, 'nagoya-tokyo': 85,
  'tokyo-fukuoka': 300, 'fukuoka-tokyo': 300,
  'osaka-hiroshima': 90, 'hiroshima-osaka': 90,
  'osaka-fukuoka': 150, 'fukuoka-osaka': 150,
  // USA
  'new york-washington': 195, 'washington-new york': 195,
  'new york-boston': 225, 'boston-new york': 225,
  'new york-philadelphia': 70, 'philadelphia-new york': 70,
  'new york-chicago': 780, 'chicago-new york': 780,
  'los angeles-san francisco': 390, 'san francisco-los angeles': 390,
  'seattle-portland': 210, 'portland-seattle': 210,
  // Canada
  'toronto-montreal': 315, 'montreal-toronto': 315,
  'toronto-ottawa': 285, 'ottawa-toronto': 285,
  'montreal-quebec': 195, 'quebec-montreal': 195,
  // Korea
  'seoul-busan': 150, 'busan-seoul': 150,
  'seoul-daegu': 95, 'daegu-seoul': 95,
  'seoul-gwangju': 90, 'gwangju-seoul': 90,
  'seoul-daejeon': 50, 'daejeon-seoul': 50,
  // SE Asia
  'bangkok-chiang mai': 720, 'chiang mai-bangkok': 720,
  'singapore-kuala lumpur': 330, 'kuala lumpur-singapore': 330,
  'hanoi-ho chi minh': 2040, 'ho chi minh-hanoi': 2040, // overnight
  'jakarta-bandung': 150, 'bandung-jakarta': 150,
  'jakarta-yogyakarta': 330, 'yogyakarta-jakarta': 330,
  // Australia
  'sydney-melbourne': 660, 'melbourne-sydney': 660,
  'sydney-brisbane': 840, 'brisbane-sydney': 840,
  'sydney-canberra': 190, 'canberra-sydney': 190,
  'melbourne-adelaide': 600, 'adelaide-melbourne': 600,
};

function globalDuration(origin: string, destination: string): number {
  for (const [k, v] of Object.entries(GLOBAL_DURATIONS)) {
    const [o, d] = k.split('-');
    if (origin.toLowerCase().startsWith(o) && destination.toLowerCase().startsWith(d)) return v;
  }
  return 240;
}

// ── Mock schedule ──────────────────────────────────────────────────────────

const DEPARTURE_SLOTS = ['06:00', '07:30', '08:50', '10:00', '11:35', '13:00', '14:30', '16:00', '17:40', '19:00', '20:30'];

function addMinutes(time: string, mins: number): string {
  const [h, m] = time.split(':').map(Number);
  const total = h * 60 + m + mins;
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function pickSlots(timePref?: string): string[] {
  if (timePref === 'morning')   return DEPARTURE_SLOTS.filter(t => t < '12:00').slice(0, 4);
  if (timePref === 'afternoon') return DEPARTURE_SLOTS.filter(t => t >= '12:00' && t < '17:00').slice(0, 4);
  if (timePref === 'evening')   return DEPARTURE_SLOTS.filter(t => t >= '17:00').slice(0, 4);
  return [DEPARTURE_SLOTS[2], DEPARTURE_SLOTS[5], DEPARTURE_SLOTS[8]];
}

function classMultiplier(classPref?: string): number {
  switch (classPref) {
    case 'business':
    case 'first':   return 1.8;
    case 'luxury':  return 3.5;
    default:        return 1.0;
  }
}

function buildMockServices(
  origin: string,
  destination: string,
  date: string,
  region: Region,
  classPref?: string,
  timePref?: string,
): TrainService[] {
  const baseFare   = estimateGlobalFare(origin, destination);
  const duration   = globalDuration(origin, destination);
  const operator   = globalOperator(origin, destination, region);
  const slots      = pickSlots(timePref);
  const multiplier = classMultiplier(classPref);

  return slots.slice(0, 3).map((dep, i) => ({
    departureTime:    dep,
    arrivalTime:      addMinutes(dep, duration),
    operator,
    serviceUid:       `GR${date.replace(/\//g, '')}${i}`,
    destination,
    estimatedFareGbp: Math.round(baseFare * multiplier * (0.9 + i * 0.12)),
    platform:         undefined,
  }));
}

// ── Live G2Rail API ────────────────────────────────────────────────────────

async function callG2RailApi(
  apiKey: string,
  origin: string,
  destination: string,
  date: string,
  classPref?: string,
): Promise<TrainService[] | null> {
  try {
    const resp = await fetch('https://api.g2rail.com/v2/search', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        origin:      origin,
        destination: destination,
        date:        date.replace(/\//g, '-'),
        passengers:  [{ type: 'ADULT', count: 1 }],
        cabin:       classPref === 'first' || classPref === 'business' ? 'BUSINESS' : 'STANDARD',
      }),
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as any;
    const journeys = data?.journeys ?? data?.results ?? [];
    if (!Array.isArray(journeys) || journeys.length === 0) return null;

    return journeys.slice(0, 4).map((j: any, i: number) => {
      const dep  = (j.departureTime ?? j.departure ?? '').slice(11, 16) || DEPARTURE_SLOTS[i];
      const arr  = (j.arrivalTime   ?? j.arrival   ?? '').slice(11, 16) || addMinutes(dep, 180);
      const fare = j.price?.amount ?? j.fare ?? j.lowestFare ?? 0;
      return {
        departureTime:    dep,
        arrivalTime:      arr,
        operator:         j.operator?.name ?? j.carrier ?? 'Rail',
        serviceUid:       j.id ?? `G2R${i}`,
        destination,
        estimatedFareGbp: Math.round(Number(fare)),
        platform:         j.platform ?? undefined,
      };
    });
  } catch {
    return null;
  }
}

// ── Live 12Go API (SE Asia) ────────────────────────────────────────────────

async function call12GoApi(
  apiKey: string,
  origin: string,
  destination: string,
  date: string,
): Promise<TrainService[] | null> {
  try {
    const params = new URLSearchParams({
      origin:      origin,
      destination: destination,
      date:        date.replace(/\//g, '-'),
      transport:   'train',
      currency:    'USD',
    });
    const resp = await fetch(`https://12go.asia/api/v2/search?${params}`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
      },
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as any;
    const trips = data?.trips ?? data?.routes ?? [];
    if (!Array.isArray(trips) || trips.length === 0) return null;

    return trips.slice(0, 4).map((t: any, i: number) => ({
      departureTime:    (t.departure ?? '').slice(11, 16) || DEPARTURE_SLOTS[i],
      arrivalTime:      (t.arrival   ?? '').slice(11, 16) || '',
      operator:         t.operator ?? t.carrier ?? 'Rail',
      serviceUid:       t.id ?? `12G${i}`,
      destination,
      estimatedFareGbp: Math.round(Number(t.price ?? t.fare ?? 0)),
      platform:         undefined,
    }));
  } catch {
    return null;
  }
}

// ── Date helper ────────────────────────────────────────────────────────────

function parseGlobalDate(dateStr?: string): string {
  const now = new Date();
  const fmt = (d: Date) =>
    `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
  if (!dateStr) { const d = new Date(now); d.setDate(d.getDate() + 1); return fmt(d); }
  const lower = dateStr.toLowerCase().trim();
  if (lower === 'today')    return fmt(now);
  if (lower === 'tomorrow') { const d = new Date(now); d.setDate(d.getDate() + 1); return fmt(d); }
  const iso = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `${iso[1]}/${iso[2]}/${iso[3]}`;
  return fmt(new Date(now.getTime() + 86400000));
}

// ── Currency symbol helper ──────────────────────────────────────────────────

function currencySymbol(c: Currency): string {
  switch (c) {
    case 'JPY': return '¥';
    case 'USD': return '$';
    case 'CAD': return 'CA$';
    case 'KRW': return '₩';
    case 'THB': return '฿';
    case 'SGD': return 'S$';
    case 'MYR': return 'RM';
    case 'VND': return '₫';
    case 'IDR': return 'Rp';
    case 'AUD': return 'A$';
  }
}

// ── Main export ────────────────────────────────────────────────────────────

/**
 * Query global rail services (Japan, USA, Canada, Korea, SE Asia, Australia).
 * Tries G2Rail live API (or 12Go for SE Asia) → realistic mock.
 */
export async function queryGlobalRail(
  env: Env,
  origin: string,
  destination: string,
  date?: string,
  classPref?: string,
  timePref?: string,
): Promise<GlobalRailResult> {
  const originInfo = resolveStation(origin);
  const destInfo   = resolveStation(destination);
  const regionInfo = originInfo ?? destInfo;
  const region: Region   = regionInfo?.region   ?? 'usa';
  const currency: Currency = regionInfo?.currency ?? 'USD';

  const normOrigin = originInfo?.display ?? origin;
  const normDest   = destInfo?.display   ?? destination;
  const parsedDate = parseGlobalDate(date);

  let services: TrainService[] | null = null;
  let dataSource: 'g2rail_live' | '12go_live' | 'global_scheduled' = 'global_scheduled';

  // 1. Try 12Go for SE Asia
  if (region === 'seasia' && env.TWELVEGO_API_KEY) {
    services = await call12GoApi(env.TWELVEGO_API_KEY, normOrigin, normDest, parsedDate);
    if (services && services.length > 0) dataSource = '12go_live';
  }

  // 2. Try G2Rail for everything else (or SE Asia fallback)
  if ((!services || services.length === 0) && env.G2RAIL_API_KEY) {
    services = await callG2RailApi(env.G2RAIL_API_KEY, normOrigin, normDest, parsedDate, classPref);
    if (services && services.length > 0) dataSource = 'g2rail_live';
  }

  // 3. Fall back to realistic mock
  if (!services || services.length === 0) {
    services = buildMockServices(normOrigin, normDest, parsedDate, region, classPref, timePref);
    dataSource = 'global_scheduled';
  }

  return {
    origin:         normOrigin,
    originCRS:      '',
    destination:    normDest,
    destinationCRS: '',
    date:           parsedDate,
    services,
    error:          dataSource === 'global_scheduled' ? 'advance_schedule' : undefined,
    currency,
    region,
  };
}

/**
 * Format global rail results for Claude's tool context.
 * Fares shown in local currency (stored in estimatedFareGbp).
 */
export function formatGlobalTrainsForClaude(result: GlobalRailResult): string {
  if (result.services.length === 0) {
    return `No rail services found from ${result.origin} to ${result.destination} on ${result.date}.`;
  }

  const sym   = currencySymbol(result.currency);
  const lines = result.services.map(s => {
    const arr = s.arrivalTime ? ` → ${s.arrivalTime}` : '';
    return `${s.departureTime}${arr} | ${s.operator} | ${sym}${s.estimatedFareGbp.toLocaleString()}`;
  });

  const note = result.error === 'advance_schedule'
    ? ' [Indicative schedule — live booking via G2Rail/12Go when keys set]'
    : ' [Live data]';

  const regionLabel: Record<Region, string> = {
    japan:     'Japan Rail (Shinkansen)',
    usa:       'Amtrak',
    canada:    'VIA Rail',
    korea:     'Korail KTX/SRT',
    seasia:    'SE Asia Rail',
    australia: 'Australian Rail',
  };

  return `${regionLabel[result.region]}: ${result.origin} → ${result.destination} on ${result.date}${note}\n${lines.join('\n')}`;
}
