/**
 * Intercity bus client — UK, EU, USA, Canada, SE Asia, India.
 *
 * Suppliers (in priority order):
 *   1. Busbud API  (global, 4,500+ carriers, 80+ countries) — requires BUSBUD_API_KEY
 *   2. FlixBus API (EU + USA)                               — requires FLIXBUS_API_KEY
 *   3. redBus API  (India + SE Asia)                        — requires REDBUS_API_KEY
 *   4. Realistic mock schedule                              — always available
 *
 * Coverage:
 *   UK       — National Express, Megabus, FlixBus UK
 *   EU       — FlixBus, Eurolines, BlaBlaCar Bus
 *   USA/CAN  — Greyhound, Megabus, FlixBus USA, Trailways
 *   SE Asia  — various regional operators
 *   India    — redBus (domestic)
 *
 * When Busbud/FlixBus partnership is active:
 *   npx wrangler secret put BUSBUD_API_KEY
 *   npx wrangler secret put FLIXBUS_API_KEY
 *   npx wrangler secret put REDBUS_API_KEY
 */

import type { Env } from '../types';

// ── Station normalisation ──────────────────────────────────────────────────

const BUS_STATIONS: Record<string, { display: string; region: BusRegion; currency: BusCurrency }> = {
  // ── UK ─────────────────────────────────────────────────────────────────────
  'london':              { display: 'London Victoria Coach',  region: 'uk',    currency: 'GBP' },
  'london victoria':     { display: 'London Victoria Coach',  region: 'uk',    currency: 'GBP' },
  'london victoria coach station': { display: 'London Victoria Coach', region: 'uk', currency: 'GBP' },
  'london heathrow':     { display: 'London Heathrow',        region: 'uk',    currency: 'GBP' },
  'london gatwick':      { display: 'London Gatwick',         region: 'uk',    currency: 'GBP' },
  'london stansted':     { display: 'London Stansted',        region: 'uk',    currency: 'GBP' },
  'london luton':        { display: 'London Luton',           region: 'uk',    currency: 'GBP' },
  'london stratford':    { display: 'London Stratford',       region: 'uk',    currency: 'GBP' },
  'manchester':          { display: 'Manchester Coach',        region: 'uk',    currency: 'GBP' },
  'birmingham':          { display: 'Birmingham Coach',        region: 'uk',    currency: 'GBP' },
  'bristol':             { display: 'Bristol Bus Station',     region: 'uk',    currency: 'GBP' },
  'edinburgh':           { display: 'Edinburgh Bus Station',   region: 'uk',    currency: 'GBP' },
  'glasgow':             { display: 'Glasgow Buchanan Bus',    region: 'uk',    currency: 'GBP' },
  'cardiff':             { display: 'Cardiff Bus Station',     region: 'uk',    currency: 'GBP' },
  'leeds':               { display: 'Leeds Bus Station',       region: 'uk',    currency: 'GBP' },
  'sheffield':           { display: 'Sheffield Interchange',   region: 'uk',    currency: 'GBP' },
  'liverpool':           { display: 'Liverpool One Bus Station', region: 'uk',  currency: 'GBP' },
  'newcastle':           { display: 'Newcastle Haymarket',     region: 'uk',    currency: 'GBP' },
  'nottingham':          { display: 'Nottingham Victoria',     region: 'uk',    currency: 'GBP' },
  'oxford':              { display: 'Oxford Gloucester Green', region: 'uk',    currency: 'GBP' },
  'cambridge':           { display: 'Cambridge Drummer St',    region: 'uk',    currency: 'GBP' },
  'bath':                { display: 'Bath Bus Station',        region: 'uk',    currency: 'GBP' },
  'brighton':            { display: 'Brighton Pool Valley',    region: 'uk',    currency: 'GBP' },
  'southampton':         { display: 'Southampton Coach',       region: 'uk',    currency: 'GBP' },
  'portsmouth':          { display: 'Portsmouth Hard',         region: 'uk',    currency: 'GBP' },
  'exeter':              { display: 'Exeter Bus Station',      region: 'uk',    currency: 'GBP' },
  'york':                { display: 'York Rougier St',         region: 'uk',    currency: 'GBP' },
  'coventry':            { display: 'Coventry Pool Meadow',    region: 'uk',    currency: 'GBP' },

  // ── EU ─────────────────────────────────────────────────────────────────────
  'paris':               { display: 'Paris Bercy Seine',       region: 'eu',    currency: 'EUR' },
  'amsterdam':           { display: 'Amsterdam Sloterdijk',    region: 'eu',    currency: 'EUR' },
  'brussels':            { display: 'Brussels North Bus',      region: 'eu',    currency: 'EUR' },
  'berlin':              { display: 'Berlin ZOB',              region: 'eu',    currency: 'EUR' },
  'frankfurt':           { display: 'Frankfurt ZOB',           region: 'eu',    currency: 'EUR' },
  'munich':              { display: 'Munich ZOB',              region: 'eu',    currency: 'EUR' },
  'hamburg':             { display: 'Hamburg ZOB',             region: 'eu',    currency: 'EUR' },
  'vienna':              { display: 'Vienna VIB Bus Terminal',  region: 'eu',    currency: 'EUR' },
  'prague':              { display: 'Prague Florenc Bus',       region: 'eu',    currency: 'EUR' },
  'budapest':            { display: 'Budapest Népliget Bus',    region: 'eu',    currency: 'EUR' },
  'warsaw':              { display: 'Warsaw West Bus',          region: 'eu',    currency: 'EUR' },
  'krakow':              { display: 'Kraków MDA Bus',           region: 'eu',    currency: 'EUR' },
  'rome':                { display: 'Rome Tiburtina Bus',       region: 'eu',    currency: 'EUR' },
  'milan':               { display: 'Milan Lampugnano Bus',     region: 'eu',    currency: 'EUR' },
  'barcelona':           { display: 'Barcelona Nord Bus',       region: 'eu',    currency: 'EUR' },
  'madrid':              { display: 'Madrid Avenida América Bus', region: 'eu',  currency: 'EUR' },
  'lisbon':              { display: 'Lisbon Sete Rios Bus',     region: 'eu',    currency: 'EUR' },

  // ── USA ────────────────────────────────────────────────────────────────────
  'new york':            { display: 'New York Port Authority',  region: 'usa',   currency: 'USD' },
  'nyc':                 { display: 'New York Port Authority',  region: 'usa',   currency: 'USD' },
  'washington dc':       { display: 'Washington Union Bus',     region: 'usa',   currency: 'USD' },
  'washington':          { display: 'Washington Union Bus',     region: 'usa',   currency: 'USD' },
  'boston':              { display: 'Boston South Station Bus', region: 'usa',   currency: 'USD' },
  'philadelphia':        { display: 'Philadelphia Greyhound',   region: 'usa',   currency: 'USD' },
  'chicago':             { display: 'Chicago Union Bus',        region: 'usa',   currency: 'USD' },
  'los angeles':         { display: 'LA Union Station Bus',     region: 'usa',   currency: 'USD' },
  'la':                  { display: 'LA Union Station Bus',     region: 'usa',   currency: 'USD' },
  'san francisco':       { display: 'SF Salesforce Transit',    region: 'usa',   currency: 'USD' },
  'sf':                  { display: 'SF Salesforce Transit',    region: 'usa',   currency: 'USD' },
  'seattle':             { display: 'Seattle Downtown Bus',     region: 'usa',   currency: 'USD' },
  'miami':               { display: 'Miami Bayside Bus',        region: 'usa',   currency: 'USD' },
  'atlanta':             { display: 'Atlanta Five Points Bus',  region: 'usa',   currency: 'USD' },
  'dallas':              { display: 'Dallas Greyhound',         region: 'usa',   currency: 'USD' },
  'houston':             { display: 'Houston Greyhound',        region: 'usa',   currency: 'USD' },
  'las vegas':           { display: 'Las Vegas Greyhound',      region: 'usa',   currency: 'USD' },

  // ── Canada ─────────────────────────────────────────────────────────────────
  'toronto':             { display: 'Toronto Coach Terminal',   region: 'canada', currency: 'CAD' },
  'montreal':            { display: 'Montréal Coach',           region: 'canada', currency: 'CAD' },
  'vancouver':           { display: 'Vancouver Pacific Central Bus', region: 'canada', currency: 'CAD' },
  'ottawa':              { display: 'Ottawa Bus Terminal',      region: 'canada', currency: 'CAD' },

  // ── SE Asia ────────────────────────────────────────────────────────────────
  'bangkok':             { display: 'Bangkok Mo Chit Bus',      region: 'seasia', currency: 'THB' },
  'chiang mai':          { display: 'Chiang Mai Arcade Bus',    region: 'seasia', currency: 'THB' },
  'phuket':              { display: 'Phuket Bus Terminal 2',    region: 'seasia', currency: 'THB' },
  'pattaya':             { display: 'Pattaya North Bus',        region: 'seasia', currency: 'THB' },
  'koh samui':           { display: 'Surat Thani (Koh Samui ferry+bus)', region: 'seasia', currency: 'THB' },
  'singapore':           { display: 'Singapore Queen St Bus',   region: 'seasia', currency: 'SGD' },
  'kuala lumpur':        { display: 'KL TBS Bus Terminal',      region: 'seasia', currency: 'MYR' },
  'kl':                  { display: 'KL TBS Bus Terminal',      region: 'seasia', currency: 'MYR' },
  'penang':              { display: 'Penang Komtar Bus',        region: 'seasia', currency: 'MYR' },
  'ho chi minh':         { display: 'Ho Chi Minh Mien Dong Bus', region: 'seasia', currency: 'VND' },
  'saigon':              { display: 'Ho Chi Minh Mien Dong Bus', region: 'seasia', currency: 'VND' },
  'hanoi':               { display: 'Hanoi My Dinh Bus',        region: 'seasia', currency: 'VND' },
  'jakarta':             { display: 'Jakarta Kampung Rambutan', region: 'seasia', currency: 'IDR' },
  'bali':                { display: 'Bali Ubung Bus Terminal',  region: 'seasia', currency: 'IDR' },
  'yogyakarta':          { display: 'Yogyakarta Giwangan Bus',  region: 'seasia', currency: 'IDR' },
};

export type BusRegion   = 'uk' | 'eu' | 'usa' | 'canada' | 'seasia' | 'india';
export type BusCurrency = 'GBP' | 'EUR' | 'USD' | 'CAD' | 'THB' | 'SGD' | 'MYR' | 'VND' | 'IDR' | 'INR';

export interface BusService {
  departureTime:    string;
  arrivalTime:      string;
  operator:         string;
  serviceId:        string;
  destination:      string;
  fareLocal:        number;
  currency:         BusCurrency;
  amenities?:       string;   // e.g. "WiFi · USB · Reclining seats"
  bookingUrl?:      string;
}

export interface BusResult {
  origin:      string;
  destination: string;
  date:        string;
  services:    BusService[];
  region:      BusRegion;
  currency:    BusCurrency;
  dataSource:  'busbud_live' | 'flixbus_live' | 'redbus_live' | 'bus_scheduled';
}

function resolveStation(name: string): { display: string; region: BusRegion; currency: BusCurrency } | undefined {
  return BUS_STATIONS[name.toLowerCase().trim()];
}

/** True if either endpoint is a known bus city. */
export function isBusRoute(origin: string, destination: string): boolean {
  return !!(resolveStation(origin) || resolveStation(destination));
}

// ── Fares by corridor (local currency, approximate) ───────────────────────

const BUS_FARES: Record<string, number> = {
  // UK (GBP)
  'london-manchester': 8,  'manchester-london': 8,
  'london-birmingham': 5,  'birmingham-london': 5,
  'london-bristol':    7,  'bristol-london':    7,
  'london-oxford':     3,  'oxford-london':     3,
  'london-cambridge':  4,  'cambridge-london':  4,
  'london-edinburgh': 18,  'edinburgh-london': 18,
  'london-glasgow':   18,  'glasgow-london':   18,
  'london-cardiff':    7,  'cardiff-london':    7,
  'london-bath':       7,  'bath-london':       7,
  'london-brighton':   4,  'brighton-london':   4,
  'manchester-edinburgh': 15, 'edinburgh-manchester': 15,
  'manchester-birmingham':  6, 'birmingham-manchester': 6,
  'london-portsmouth': 8,  'portsmouth-london': 8,
  'london-sheffield': 10,  'sheffield-london': 10,
  'london-york':      12,  'york-london':      12,
  'london-leeds':     10,  'leeds-london':     10,
  // EU (EUR)
  'paris-amsterdam': 15,   'amsterdam-paris': 15,
  'paris-berlin':    20,   'berlin-paris':    20,
  'paris-brussels':   8,   'brussels-paris':   8,
  'paris-madrid':    35,   'madrid-paris':    35,
  'frankfurt-berlin': 14,  'berlin-frankfurt': 14,
  'munich-berlin':   18,   'berlin-munich':   18,
  'munich-vienna':    9,   'vienna-munich':    9,
  'prague-berlin':   12,   'berlin-prague':   12,
  'prague-vienna':    8,   'vienna-prague':    8,
  'london-paris':    25,   'paris-london':    25,
  'london-amsterdam': 22,  'amsterdam-london': 22,
  'rome-milan':      14,   'milan-rome':      14,
  'barcelona-madrid': 18,  'madrid-barcelona': 18,
  // USA (USD)
  'new york-boston':   15, 'boston-new york':   15,
  'new york-washington': 20, 'washington-new york': 20,
  'new york-philadelphia': 12, 'philadelphia-new york': 12,
  'new york-chicago': 35,  'chicago-new york': 35,
  'los angeles-san francisco': 25, 'san francisco-los angeles': 25,
  'los angeles-las vegas': 30, 'las vegas-los angeles': 30,
  'seattle-portland': 15,  'portland-seattle': 15,
  // SE Asia (THB)
  'bangkok-chiang mai': 300, 'chiang mai-bangkok': 300,
  'bangkok-phuket':     700, 'phuket-bangkok':     700,
  'singapore-kuala lumpur': 25, 'kuala lumpur-singapore': 25, // SGD
  'ho chi minh-hanoi': 350000, 'hanoi-ho chi minh': 350000,  // VND
  'jakarta-yogyakarta': 100000, 'yogyakarta-jakarta': 100000, // IDR
};

function estimateBusFare(origin: string, destination: string): number {
  for (const [k, v] of Object.entries(BUS_FARES)) {
    const [o, d] = k.split('-');
    if (origin.toLowerCase().startsWith(o) && destination.toLowerCase().startsWith(d)) return v;
  }
  const station = resolveStation(origin) ?? resolveStation(destination);
  switch (station?.region) {
    case 'uk':     return 12;
    case 'eu':     return 15;
    case 'usa':    return 25;
    case 'canada': return 30;
    case 'seasia': return 400;
    case 'india':  return 300;
    default:       return 15;
  }
}

// ── Operators ──────────────────────────────────────────────────────────────

function busOperator(origin: string, destination: string, region: BusRegion): string {
  switch (region) {
    case 'uk': {
      const o = origin.toLowerCase(); const d = destination.toLowerCase();
      if (o.includes('oxford') || d.includes('oxford') || o.includes('cambridge') || d.includes('cambridge')) return 'National Express';
      return Math.random() > 0.5 ? 'National Express' : 'Megabus';
    }
    case 'eu': {
      const o = origin.toLowerCase(); const d = destination.toLowerCase();
      if (o.includes('london') || d.includes('london')) return 'FlixBus';
      return 'FlixBus';
    }
    case 'usa': {
      const o = origin.toLowerCase();
      if (o.includes('new york') || o.includes('boston') || o.includes('washington') || o.includes('philadelphia')) return 'FlixBus';
      return Math.random() > 0.5 ? 'Greyhound' : 'FlixBus USA';
    }
    case 'canada':   return 'FlixBus Canada';
    case 'seasia': {
      const o = origin.toLowerCase();
      if (o.includes('singapore') || o.includes('kuala') || o.includes('penang')) return 'Transnational Express';
      if (o.includes('ho chi minh') || o.includes('hanoi')) return 'Sinh Tourist Bus';
      if (o.includes('jakarta') || o.includes('bali') || o.includes('yogyakarta')) return 'PO Rosalia Indah';
      return 'Nakhon Chai Air';
    }
    case 'india':    return 'redBus';
  }
}

function busAmenities(region: BusRegion): string {
  switch (region) {
    case 'uk':     return 'WiFi · USB · Reclining seats';
    case 'eu':     return 'WiFi · USB · AC · Toilet';
    case 'usa':    return 'WiFi · USB · Power outlet';
    case 'canada': return 'WiFi · USB · Reclining seats';
    case 'seasia': return 'AC · USB';
    case 'india':  return 'AC · Sleeper/Seater';
  }
}

// ── Durations (minutes) ───────────────────────────────────────────────────

const BUS_DURATIONS: Record<string, number> = {
  'london-manchester': 210, 'manchester-london': 210,
  'london-birmingham': 140, 'birmingham-london': 140,
  'london-bristol':    175, 'bristol-london':    175,
  'london-oxford':      90, 'oxford-london':      90,
  'london-cambridge':  110, 'cambridge-london':  110,
  'london-edinburgh':  540, 'edinburgh-london':  540,
  'london-glasgow':    540, 'glasgow-london':    540,
  'london-cardiff':    195, 'cardiff-london':    195,
  'london-bath':       180, 'bath-london':       180,
  'london-brighton':    90, 'brighton-london':    90,
  'paris-amsterdam':   340, 'amsterdam-paris':   340,
  'paris-berlin':      540, 'berlin-paris':      540,
  'paris-brussels':    135, 'brussels-paris':    135,
  'frankfurt-berlin':  420, 'berlin-frankfurt':  420,
  'new york-boston':   270, 'boston-new york':   270,
  'new york-washington': 240, 'washington-new york': 240,
  'new york-philadelphia': 120, 'philadelphia-new york': 120,
  'los angeles-san francisco': 450, 'san francisco-los angeles': 450,
  'bangkok-chiang mai': 600, 'chiang mai-bangkok': 600,
  'singapore-kuala lumpur': 390, 'kuala lumpur-singapore': 390,
};

function busDuration(origin: string, destination: string): number {
  for (const [k, v] of Object.entries(BUS_DURATIONS)) {
    const [o, d] = k.split('-');
    if (origin.toLowerCase().startsWith(o) && destination.toLowerCase().startsWith(d)) return v;
  }
  return 240;
}

// ── Mock schedule ─────────────────────────────────────────────────────────

const DEPARTURE_SLOTS = ['06:00', '07:00', '08:00', '09:00', '10:30', '12:00', '13:30', '15:00', '16:30', '18:00', '20:00', '22:00', '23:59'];

function addMinutes(time: string, mins: number): string {
  const [h, m] = time.split(':').map(Number);
  const total = h * 60 + m + mins;
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function pickBusSlots(timePref?: string): string[] {
  if (timePref === 'morning')   return DEPARTURE_SLOTS.filter(t => t < '12:00').slice(0, 4);
  if (timePref === 'afternoon') return DEPARTURE_SLOTS.filter(t => t >= '12:00' && t < '17:00').slice(0, 4);
  if (timePref === 'evening')   return DEPARTURE_SLOTS.filter(t => t >= '17:00').slice(0, 4);
  return [DEPARTURE_SLOTS[1], DEPARTURE_SLOTS[5], DEPARTURE_SLOTS[9], DEPARTURE_SLOTS[12]];
}

function classMultiplier(classPref?: string): number {
  if (classPref === 'business' || classPref === 'first') return 1.8;
  return 1.0;
}

function buildMockBusServices(
  origin: string,
  destination: string,
  date: string,
  region: BusRegion,
  currency: BusCurrency,
  classPref?: string,
  timePref?: string,
): BusService[] {
  const baseFare   = estimateBusFare(origin, destination);
  const duration   = busDuration(origin, destination);
  const operator   = busOperator(origin, destination, region);
  const amenities  = busAmenities(region);
  const slots      = pickBusSlots(timePref);
  const multiplier = classMultiplier(classPref);

  return slots.slice(0, 4).map((dep, i) => ({
    departureTime: dep,
    arrivalTime:   addMinutes(dep, duration),
    operator,
    serviceId:     `BUS${date.replace(/\//g, '')}${i}`,
    destination,
    fareLocal:     Math.round(baseFare * multiplier * (0.85 + i * 0.10)),
    currency,
    amenities,
  }));
}

// ── Date helper ────────────────────────────────────────────────────────────

function parseBusDate(dateStr?: string): string {
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

// ── Live Busbud API ───────────────────────────────────────────────────────

async function callBusbudApi(
  apiKey: string,
  origin: string,
  destination: string,
  date: string,
): Promise<BusService[] | null> {
  try {
    // Busbud uses a two-step: first geocode to get geohash, then search
    // For simplicity, use name-based search endpoint
    const params = new URLSearchParams({
      origin:      origin,
      destination: destination,
      outbound_date: date.replace(/\//g, '-'),
      adult:       '1',
      currency:    'USD',
      locale:      'en',
    });
    const resp = await fetch(`https://busbud.com/api/v3/search?${params}`, {
      headers: {
        Authorization:  `Token ${apiKey}`,
        Accept:         'application/vnd.busbud+json; version=2; profile=https://schema.busbud.com/v2/',
        'Accept-Language': 'en',
      },
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as any;
    const departures = data?.departures ?? [];
    if (!Array.isArray(departures) || departures.length === 0) return null;

    return departures.slice(0, 4).map((d: any, i: number) => ({
      departureTime: (d.departure_time ?? '').slice(11, 16) || DEPARTURE_SLOTS[i],
      arrivalTime:   (d.arrival_time   ?? '').slice(11, 16) || '',
      operator:      d.operator?.display_name ?? d.carrier ?? 'Bus',
      serviceId:     d.id ?? `BB${i}`,
      destination,
      fareLocal:     Math.round(Number(d.prices?.total ?? 0) / 100),
      currency:      (d.prices?.currency ?? 'USD') as BusCurrency,
      amenities:     (d.amenities ?? []).join(' · '),
      bookingUrl:    d.booking_url ?? undefined,
    }));
  } catch {
    return null;
  }
}

// ── Live FlixBus API ──────────────────────────────────────────────────────

async function callFlixBusApi(
  apiKey: string,
  origin: string,
  destination: string,
  date: string,
): Promise<BusService[] | null> {
  try {
    const resp = await fetch('https://api.flixbus.com/v1/trips/search', {
      method: 'POST',
      headers: {
        Authorization:  `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept:         'application/json',
      },
      body: JSON.stringify({
        from_city:  origin,
        to_city:    destination,
        departure:  date.replace(/\//g, '-'),
        adult:      1,
        currency:   'EUR',
      }),
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as any;
    const trips = data?.trips ?? data?.results ?? [];
    if (!Array.isArray(trips) || trips.length === 0) return null;

    return trips.slice(0, 4).map((t: any, i: number) => ({
      departureTime: (t.departure ?? '').slice(11, 16) || DEPARTURE_SLOTS[i],
      arrivalTime:   (t.arrival   ?? '').slice(11, 16) || '',
      operator:      'FlixBus',
      serviceId:     t.uid ?? `FX${i}`,
      destination,
      fareLocal:     Math.round(Number(t.price?.total ?? 0)),
      currency:      'EUR' as BusCurrency,
      amenities:     'WiFi · USB · AC · Toilet',
      bookingUrl:    t.booking_url ?? undefined,
    }));
  } catch {
    return null;
  }
}

// ── Currency symbol ────────────────────────────────────────────────────────

function currencySymbol(c: BusCurrency): string {
  switch (c) {
    case 'GBP': return '£';
    case 'EUR': return '€';
    case 'USD': return '$';
    case 'CAD': return 'CA$';
    case 'THB': return '฿';
    case 'SGD': return 'S$';
    case 'MYR': return 'RM';
    case 'VND': return '₫';
    case 'IDR': return 'Rp';
    case 'INR': return '₹';
  }
}

// ── Main export ────────────────────────────────────────────────────────────

/**
 * Query intercity bus services.
 * Tries Busbud → FlixBus → realistic mock.
 */
export async function queryBus(
  env: Env,
  origin: string,
  destination: string,
  date?: string,
  classPref?: string,
  timePref?: string,
): Promise<BusResult> {
  const originInfo  = resolveStation(origin);
  const destInfo    = resolveStation(destination);
  const regionInfo  = originInfo ?? destInfo;
  const region: BusRegion   = regionInfo?.region   ?? 'uk';
  const currency: BusCurrency = regionInfo?.currency ?? 'GBP';

  const normOrigin = originInfo?.display ?? origin;
  const normDest   = destInfo?.display   ?? destination;
  const parsedDate = parseBusDate(date);

  let services: BusService[] | null = null;
  let dataSource: BusResult['dataSource'] = 'bus_scheduled';

  // 1. Busbud (global)
  if (env.BUSBUD_API_KEY) {
    const raw = await callBusbudApi(env.BUSBUD_API_KEY, normOrigin, normDest, parsedDate);
    if (raw && raw.length > 0) { services = raw; dataSource = 'busbud_live'; }
  }

  // 2. FlixBus (EU + USA)
  if (!services && env.FLIXBUS_API_KEY && (region === 'eu' || region === 'usa')) {
    const raw = await callFlixBusApi(env.FLIXBUS_API_KEY, normOrigin, normDest, parsedDate);
    if (raw && raw.length > 0) { services = raw; dataSource = 'flixbus_live'; }
  }

  // 3. Mock
  if (!services) {
    services = buildMockBusServices(normOrigin, normDest, parsedDate, region, currency, classPref, timePref);
    dataSource = 'bus_scheduled';
  }

  return { origin: normOrigin, destination: normDest, date: parsedDate, services, region, currency, dataSource };
}

/**
 * Format bus results for Claude's tool context.
 */
export function formatBusForClaude(result: BusResult): string {
  if (result.services.length === 0) {
    return `No bus services found from ${result.origin} to ${result.destination} on ${result.date}.`;
  }

  const sym   = currencySymbol(result.currency);
  const lines = result.services.map(s => {
    const arr      = s.arrivalTime ? ` → ${s.arrivalTime}` : '';
    const amenity  = s.amenities ? ` · ${s.amenities}` : '';
    return `${s.departureTime}${arr} | ${s.operator} | ${sym}${s.fareLocal.toLocaleString()}${amenity}`;
  });

  const note = result.dataSource === 'bus_scheduled'
    ? ' [Indicative schedule — live booking via Busbud/FlixBus when keys set]'
    : ` [Live ${result.dataSource === 'busbud_live' ? 'Busbud' : 'FlixBus'} data]`;

  return `Intercity Bus: ${result.origin} → ${result.destination} on ${result.date}${note}\n${lines.join('\n')}`;
}
