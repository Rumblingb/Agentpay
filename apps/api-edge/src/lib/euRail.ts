/**
 * EU Rail client — covers cross-border and domestic European train routes.
 *
 * Suppliers (in priority order):
 *   1. Rail Europe API  (live booking, 200+ operators) — requires RAIL_EUROPE_API_KEY
 *   2. Trainline Partner API (live, 45 countries)      — requires TRAINLINE_API_KEY
 *   3. Realistic mock schedule                         — always available, planning only
 *
 * Coverage:
 *   Eurostar   — London ↔ Paris / Brussels / Amsterdam
 *   TGV        — France domestic + cross-border (Paris ↔ Lyon / Marseille / Barcelona)
 *   Thalys/ES  — Paris ↔ Brussels ↔ Amsterdam
 *   ICE        — Germany (Frankfurt ↔ Berlin / Hamburg / Munich, cross-border)
 *   Frecciarossa — Italy (Rome ↔ Milan ↔ Florence / Venice)
 *   AVE        — Spain (Madrid ↔ Barcelona / Seville / Valencia)
 *   Railjet    — Austria / Czech (Vienna ↔ Prague / Munich)
 *   SBB        — Switzerland (Zurich ↔ Geneva / Basel / Bern)
 *
 * When Rail Europe partnership is active:
 *   npx wrangler secret put RAIL_EUROPE_API_KEY
 *   npx wrangler secret put TRAINLINE_API_KEY
 */

import type { Env } from '../types';
import type { RttQueryResult, TrainService } from './rtt';

// ── EU station name normalisation ──────────────────────────────────────────

const EU_STATIONS: Record<string, string> = {
  // France
  'paris':                     'Paris Gare du Nord',
  'paris gare du nord':        'Paris Gare du Nord',
  'paris nord':                'Paris Gare du Nord',
  'paris gare de lyon':        'Paris Gare de Lyon',
  'paris lyon':                'Paris Gare de Lyon',
  'paris montparnasse':        'Paris Montparnasse',
  'lyon':                      'Lyon Part-Dieu',
  'lyon part-dieu':            'Lyon Part-Dieu',
  'marseille':                 'Marseille St-Charles',
  'marseille st-charles':      'Marseille St-Charles',
  'bordeaux':                  'Bordeaux St-Jean',
  'toulouse':                  'Toulouse Matabiau',
  'nice':                      'Nice Ville',
  'strasbourg':                'Strasbourg',
  'lille':                     'Lille Flandres',
  'rennes':                    'Rennes',
  'nantes':                    'Nantes',
  'montpellier':               'Montpellier Saint-Roch',

  // Belgium
  'brussels':                  'Brussels Midi',
  'brussels midi':             'Brussels Midi',
  'brussels south':            'Brussels Midi',
  'bruxelles':                 'Brussels Midi',
  'bruges':                    'Bruges',
  'ghent':                     'Ghent Sint-Pieters',
  'antwerp':                   'Antwerp Central',

  // Netherlands
  'amsterdam':                 'Amsterdam Centraal',
  'amsterdam centraal':        'Amsterdam Centraal',
  'rotterdam':                 'Rotterdam Centraal',
  'the hague':                 "Den Haag Centraal",
  'den haag':                  "Den Haag Centraal",
  'utrecht':                   'Utrecht Centraal',
  'eindhoven':                 'Eindhoven',

  // Germany
  'berlin':                    'Berlin Hauptbahnhof',
  'berlin hauptbahnhof':       'Berlin Hauptbahnhof',
  'berlin hbf':                'Berlin Hauptbahnhof',
  'frankfurt':                 'Frankfurt (Main) Hbf',
  'frankfurt am main':         'Frankfurt (Main) Hbf',
  'munich':                    'München Hauptbahnhof',
  'münchen':                   'München Hauptbahnhof',
  'hamburg':                   'Hamburg Hauptbahnhof',
  'cologne':                   'Köln Hauptbahnhof',
  'köln':                      'Köln Hauptbahnhof',
  'koeln':                     'Köln Hauptbahnhof',
  'düsseldorf':                'Düsseldorf Hauptbahnhof',
  'dusseldorf':                'Düsseldorf Hauptbahnhof',
  'stuttgart':                 'Stuttgart Hauptbahnhof',
  'nuremberg':                 'Nürnberg Hauptbahnhof',
  'nürnberg':                  'Nürnberg Hauptbahnhof',
  'hannover':                  'Hannover Hauptbahnhof',
  'dortmund':                  'Dortmund Hauptbahnhof',

  // Austria
  'vienna':                    'Wien Hauptbahnhof',
  'wien':                      'Wien Hauptbahnhof',
  'salzburg':                  'Salzburg Hauptbahnhof',
  'innsbruck':                 'Innsbruck Hauptbahnhof',
  'graz':                      'Graz Hauptbahnhof',

  // Switzerland
  'zurich':                    'Zürich Hauptbahnhof',
  'zürich':                    'Zürich Hauptbahnhof',
  'geneva':                    'Genève Cornavin',
  'genève':                    'Genève Cornavin',
  'basel':                     'Basel SBB',
  'bern':                      'Bern',
  'lausanne':                  'Lausanne',
  'lucerne':                   'Luzern',

  // Italy
  'rome':                      'Roma Termini',
  'roma':                      'Roma Termini',
  'rome termini':              'Roma Termini',
  'milan':                     'Milano Centrale',
  'milano':                    'Milano Centrale',
  'florence':                  'Firenze Santa Maria Novella',
  'firenze':                   'Firenze Santa Maria Novella',
  'venice':                    'Venezia Santa Lucia',
  'venezia':                   'Venezia Santa Lucia',
  'naples':                    'Napoli Centrale',
  'napoli':                    'Napoli Centrale',
  'bologna':                   'Bologna Centrale',
  'turin':                     'Torino Porta Nuova',
  'torino':                    'Torino Porta Nuova',
  'genoa':                     'Genova Piazza Principe',

  // Spain
  'madrid':                    'Madrid Atocha',
  'madrid atocha':             'Madrid Atocha',
  'barcelona':                 'Barcelona Sants',
  'barcelona sants':           'Barcelona Sants',
  'seville':                   'Sevilla Santa Justa',
  'sevilla':                   'Sevilla Santa Justa',
  'valencia':                  'Valencia Nord',
  'bilbao':                    'Bilbao Abando',
  'zaragoza':                  'Zaragoza Delicias',
  'malaga':                    'Málaga María Zambrano',

  // Czech Republic
  'prague':                    'Praha Hlavní Nádraží',
  'praha':                     'Praha Hlavní Nádraží',
  'brno':                      'Brno Hlavní Nádraží',

  // Poland
  'warsaw':                    'Warszawa Centralna',
  'warsaw centralna':          'Warszawa Centralna',
  'krakow':                    'Kraków Główny',
  'kraków':                    'Kraków Główny',
  'gdansk':                    'Gdańsk Główny',
  'wroclaw':                   'Wrocław Główny',

  // Denmark / Scandinavia
  'copenhagen':                'København H',
  'københavn':                 'København H',
  'oslo':                      'Oslo S',
  'stockholm':                 'Stockholm Central',
  'gothenburg':                'Göteborg Central',

  // Portugal
  'lisbon':                    'Lisboa Santa Apolónia',
  'porto':                     'Porto Campanhã',
};

export function normaliseEuStation(name: string): string {
  const key = name.toLowerCase().trim();
  return EU_STATIONS[key] ?? name;
}

/** True if either origin or destination is a known EU city (not UK, not India). */
export function isEuRoute(origin: string, destination: string): boolean {
  const originKey  = origin.toLowerCase().trim();
  const destKey    = destination.toLowerCase().trim();
  return (originKey in EU_STATIONS) || (destKey in EU_STATIONS);
}

// ── Typical fares by corridor (EUR, approximate advance) ──────────────────

const EU_FARES: Record<string, number> = {
  // Eurostar
  'london-paris':         69, 'paris-london':         69,
  'london-brussels':      55, 'brussels-london':      55,
  'london-amsterdam':     59, 'amsterdam-london':     59,

  // France domestic (TGV)
  'paris-lyon':           25, 'lyon-paris':           25,
  'paris-marseille':      35, 'marseille-paris':      35,
  'paris-bordeaux':       28, 'bordeaux-paris':       28,
  'paris-toulouse':       32, 'toulouse-paris':       32,
  'paris-nice':           45, 'nice-paris':           45,
  'paris-strasbourg':     22, 'strasbourg-paris':     22,
  'paris-lille':          18, 'lille-paris':          18,
  'paris-barcelona':      55, 'barcelona-paris':      55,
  'lyon-marseille':       20, 'marseille-lyon':       20,
  'lyon-barcelona':       35, 'barcelona-lyon':       35,

  // Belgium / Netherlands
  'brussels-amsterdam':   20, 'amsterdam-brussels':   20,
  'paris-amsterdam':      35, 'amsterdam-paris':      35,
  'paris-brussels':       22, 'brussels-paris':       22,
  'amsterdam-rotterdam':   8, 'rotterdam-amsterdam':   8,

  // Germany (ICE)
  'frankfurt-berlin':     30, 'berlin-frankfurt':     30,
  'frankfurt-munich':     25, 'munich-frankfurt':     25,
  'frankfurt-hamburg':    29, 'hamburg-frankfurt':    29,
  'berlin-hamburg':       19, 'hamburg-berlin':       19,
  'berlin-munich':        35, 'munich-berlin':        35,
  'munich-vienna':        30, 'vienna-munich':        30,
  'cologne-berlin':       25, 'berlin-cologne':       25,
  'cologne-frankfurt':    15, 'frankfurt-cologne':    15,
  'amsterdam-cologne':    19, 'cologne-amsterdam':    19,
  'amsterdam-frankfurt':  25, 'frankfurt-amsterdam':  25,
  'brussels-frankfurt':   22, 'frankfurt-brussels':   22,

  // Austria / Switzerland / Czech
  'vienna-salzburg':      18, 'salzburg-vienna':      18,
  'vienna-prague':        22, 'prague-vienna':        22,
  'zurich-geneva':        22, 'geneva-zurich':        22,
  'zurich-basel':         12, 'basel-zurich':         12,
  'zurich-milan':         28, 'milan-zurich':         28,
  'zurich-munich':        25, 'munich-zurich':        25,
  'munich-salzburg':      15, 'salzburg-munich':      15,
  'prague-berlin':        25, 'berlin-prague':        25,

  // Italy (Frecciarossa / Italo)
  'rome-milan':           25, 'milan-rome':           25,
  'rome-florence':        19, 'florence-rome':        19,
  'rome-naples':          15, 'naples-rome':          15,
  'milan-florence':       15, 'florence-milan':       15,
  'milan-venice':         15, 'venice-milan':         15,
  'milan-bologna':        12, 'bologna-milan':        12,
  'milan-turin':          10, 'turin-milan':          10,
  'florence-bologna':      8, 'bologna-florence':      8,

  // Spain (AVE / Renfe)
  'madrid-barcelona':     25, 'barcelona-madrid':     25,
  'madrid-seville':       28, 'seville-madrid':       28,
  'madrid-valencia':      20, 'valencia-madrid':      20,
  'madrid-malaga':        22, 'malaga-madrid':        22,
  'madrid-bilbao':        18, 'bilbao-madrid':        18,
  'barcelona-valencia':   18, 'valencia-barcelona':   18,

  // Scandinavia
  'stockholm-gothenburg': 15, 'gothenburg-stockholm': 15,
  'copenhagen-stockholm': 38, 'stockholm-copenhagen': 38,
  'oslo-stockholm':       35, 'stockholm-oslo':       35,
};

function estimateEuFare(origin: string, destination: string): number {
  const key = `${origin.toLowerCase().split(' ')[0]}-${destination.toLowerCase().split(' ')[0]}`;
  return EU_FARES[key] ?? 45;
}

// ── Operators by corridor ──────────────────────────────────────────────────

function euOperator(origin: string, destination: string): string {
  const o = origin.toLowerCase();
  const d = destination.toLowerCase();

  if (o.includes('london') || d.includes('london'))     return 'Eurostar';
  if ((o.includes('paris') || d.includes('paris')) && (o.includes('amsterdam') || d.includes('amsterdam') || o.includes('brussels') || d.includes('brussels'))) return 'Eurostar International';
  if (o.includes('paris') || d.includes('paris'))       return 'SNCF TGV Inouï';
  if (o.includes('madrid') || d.includes('madrid') || o.includes('barcelona') || d.includes('barcelona') || o.includes('seville') || d.includes('seville')) return 'Renfe AVE';
  if (o.includes('rome') || d.includes('rome') || o.includes('milan') || d.includes('milan') || o.includes('florence') || d.includes('florence') || o.includes('naples') || d.includes('naples')) return 'Trenitalia Frecciarossa';
  if (o.includes('zürich') || d.includes('zürich') || o.includes('zurich') || d.includes('zurich') || o.includes('geneva') || d.includes('geneva') || o.includes('basel') || d.includes('basel')) return 'SBB';
  if (o.includes('vienna') || d.includes('vienna') || o.includes('wien') || d.includes('wien') || o.includes('salzburg') || d.includes('salzburg')) return 'ÖBB Railjet';
  if (o.includes('prague') || d.includes('prague') || o.includes('brno') || d.includes('brno')) return 'Czech Railways';
  if (o.includes('stockholm') || d.includes('stockholm') || o.includes('gothenburg') || d.includes('gothenburg') || o.includes('oslo') || d.includes('oslo') || o.includes('copenhagen') || d.includes('copenhagen')) return 'SJ / NSB';
  // Default Germany / cross-border
  return 'Deutsche Bahn ICE';
}

// ── Journey durations by city pair (minutes, approximate) ────────────────

const EU_DURATIONS: Record<string, number> = {
  'london-paris': 135, 'paris-london': 135,
  'london-brussels': 120, 'brussels-london': 120,
  'london-amsterdam': 232, 'amsterdam-london': 232,
  'paris-lyon': 125, 'lyon-paris': 125,
  'paris-marseille': 200, 'marseille-paris': 200,
  'paris-bordeaux': 135, 'bordeaux-paris': 135,
  'paris-toulouse': 250, 'toulouse-paris': 250,
  'paris-nice': 345, 'nice-paris': 345,
  'paris-strasbourg': 115, 'strasbourg-paris': 115,
  'paris-lille': 65, 'lille-paris': 65,
  'paris-barcelona': 390, 'barcelona-paris': 390,
  'paris-amsterdam': 200, 'amsterdam-paris': 200,
  'paris-brussels': 82, 'brussels-paris': 82,
  'brussels-amsterdam': 115, 'amsterdam-brussels': 115,
  'frankfurt-berlin': 245, 'berlin-frankfurt': 245,
  'frankfurt-munich': 210, 'munich-frankfurt': 210,
  'berlin-munich': 280, 'munich-berlin': 280,
  'berlin-hamburg': 95, 'hamburg-berlin': 95,
  'munich-vienna': 245, 'vienna-munich': 245,
  'rome-milan': 180, 'milan-rome': 180,
  'rome-florence': 95, 'florence-rome': 95,
  'rome-naples': 70, 'naples-rome': 70,
  'milan-venice': 140, 'venice-milan': 140,
  'madrid-barcelona': 150, 'barcelona-madrid': 150,
  'madrid-seville': 150, 'seville-madrid': 150,
  'zurich-geneva': 165, 'geneva-zurich': 165,
  'zurich-milan': 210, 'milan-zurich': 210,
  'vienna-prague': 245, 'prague-vienna': 245,
  'stockholm-gothenburg': 200, 'gothenburg-stockholm': 200,
  'copenhagen-stockholm': 310, 'stockholm-copenhagen': 310,
};

function euDuration(origin: string, destination: string): number {
  const key = `${origin.toLowerCase().split(' ')[0]}-${destination.toLowerCase().split(' ')[0]}`;
  return EU_DURATIONS[key] ?? 180;
}

// ── Mock schedule generator ────────────────────────────────────────────────

const DEPARTURE_SLOTS = ['06:30', '07:04', '08:22', '09:31', '10:34', '11:58', '12:34', '13:15', '14:04', '15:30', '16:31', '17:45', '18:31', '19:10', '20:22'];

function addMinutes(time: string, mins: number): string {
  const [h, m] = time.split(':').map(Number);
  const total = h * 60 + m + mins;
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function pickTimeSlots(timePref?: string): string[] {
  if (timePref === 'morning')   return DEPARTURE_SLOTS.filter(t => t < '12:00').slice(0, 4);
  if (timePref === 'afternoon') return DEPARTURE_SLOTS.filter(t => t >= '12:00' && t < '17:00').slice(0, 4);
  if (timePref === 'evening')   return DEPARTURE_SLOTS.filter(t => t >= '17:00').slice(0, 4);
  // 'any' or undefined — spread across the day
  return [DEPARTURE_SLOTS[2], DEPARTURE_SLOTS[6], DEPARTURE_SLOTS[10], DEPARTURE_SLOTS[13]];
}

function classMultiplier(classPref?: string): number {
  switch (classPref) {
    case 'business':
    case 'first':   return 2.2;
    case 'luxury':  return 4.5;
    default:        return 1.0;
  }
}

function buildMockServices(
  origin: string,
  destination: string,
  date: string,
  classPref?: string,
  timePref?: string,
): TrainService[] {
  const baseFare  = estimateEuFare(origin, destination);
  const duration  = euDuration(origin, destination);
  const operator  = euOperator(origin, destination);
  const slots     = pickTimeSlots(timePref);
  const multiplier = classMultiplier(classPref);

  return slots.slice(0, 3).map((dep, i) => {
    // Vary fare slightly between departures (earlier = cheaper advance)
    const fare = Math.round(baseFare * multiplier * (0.9 + i * 0.15));
    return {
      departureTime:    dep,
      arrivalTime:      addMinutes(dep, duration),
      operator,
      serviceUid:       `EU${date.replace(/\//g, '')}${i}`,
      destination,
      estimatedFareGbp: fare, // stored as EUR but labelled EUR in narration
      platform:         undefined,
    };
  });
}

// ── Live Rail Europe API call ──────────────────────────────────────────────

async function callRailEuropeApi(
  apiKey: string,
  origin: string,
  destination: string,
  date: string,
  classPref?: string,
): Promise<TrainService[] | null> {
  try {
    // Rail Europe REST API v3 — search endpoint
    // Docs: https://agent.raileurope.com/api
    const params = new URLSearchParams({
      origin:      origin,
      destination: destination,
      date:        date.replace(/\//g, '-'),
      class:       classPref === 'first' || classPref === 'business' ? 'FIRST' : 'SECOND',
      passengers:  '1',
    });

    const resp = await fetch(`https://api.raileurope.com/v3/search?${params}`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
        'X-Source': 'bro-concierge',
      },
    });

    if (!resp.ok) return null;
    const data = (await resp.json()) as any;

    // Normalise Rail Europe response to TrainService shape
    const trips = data?.trips ?? data?.journeys ?? [];
    if (!Array.isArray(trips) || trips.length === 0) return null;

    return trips.slice(0, 4).map((trip: any, i: number) => {
      const dep = (trip.departureTime ?? trip.departure ?? '').slice(11, 16) || DEPARTURE_SLOTS[i];
      const arr = (trip.arrivalTime   ?? trip.arrival   ?? '').slice(11, 16) || addMinutes(dep, euDuration(origin, destination));
      const fare = trip.price?.amount ?? trip.lowestFare ?? trip.priceFrom ?? estimateEuFare(origin, destination);
      return {
        departureTime:    dep,
        arrivalTime:      arr,
        operator:         trip.operator?.name ?? trip.carrier ?? euOperator(origin, destination),
        serviceUid:       trip.id ?? trip.journeyId ?? `RE${i}`,
        destination:      destination,
        estimatedFareGbp: Math.round(Number(fare)),
        platform:         trip.departurePlatform ?? undefined,
      };
    });
  } catch {
    return null;
  }
}

// ── Live Trainline Partner API call ───────────────────────────────────────

async function callTrainlineApi(
  apiKey: string,
  origin: string,
  destination: string,
  date: string,
  classPref?: string,
): Promise<TrainService[] | null> {
  try {
    const resp = await fetch('https://api.thetrainline.com/partner/v2/search', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        passengers:  [{ type: 'ADULT' }],
        isEurail:    false,
        origin:      { name: origin },
        destination: { name: destination },
        outwardDate: date.replace(/\//g, '-'),
        journeyType: 'single',
        travelClass: classPref === 'first' || classPref === 'business' ? 'FIRST' : 'STANDARD',
      }),
    });

    if (!resp.ok) return null;
    const data = (await resp.json()) as any;

    const journeys = data?.data?.journeys ?? data?.journeys ?? [];
    if (!Array.isArray(journeys) || journeys.length === 0) return null;

    return journeys.slice(0, 4).map((j: any, i: number) => {
      const dep = (j.departureTime ?? '').slice(11, 16) || DEPARTURE_SLOTS[i];
      const arr = (j.arrivalTime   ?? '').slice(11, 16) || addMinutes(dep, euDuration(origin, destination));
      const fare = j.cheapestPrice?.amount ?? j.price ?? estimateEuFare(origin, destination);
      return {
        departureTime:    dep,
        arrivalTime:      arr,
        operator:         j.legs?.[0]?.carrier?.name ?? euOperator(origin, destination),
        serviceUid:       j.id ?? `TL${i}`,
        destination:      destination,
        estimatedFareGbp: Math.round(Number(fare)),
        platform:         j.departurePlatform ?? undefined,
      };
    });
  } catch {
    return null;
  }
}

// ── Date helpers (mirror rtt.ts parseRttDate) ──────────────────────────────

function parseEuDate(dateStr?: string): string {
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

// ── Main export ────────────────────────────────────────────────────────────

export interface EuRailResult extends RttQueryResult {
  /** ISO 4217 currency code for fares — EUR for EU routes */
  currency: 'EUR' | 'GBP';
}

/**
 * Query EU rail services.
 * Tries Rail Europe live API → Trainline live API → realistic mock.
 */
export async function queryEuRail(
  env: Env,
  origin: string,
  destination: string,
  date?: string,
  classPref?: string,
  timePref?: string,
): Promise<EuRailResult> {
  const normOrigin = normaliseEuStation(origin);
  const normDest   = normaliseEuStation(destination);
  const parsedDate = parseEuDate(date);

  let services: TrainService[] | null = null;
  let dataSource: 'rail_europe_live' | 'trainline_live' | 'eu_scheduled' = 'eu_scheduled';

  // 1. Try Rail Europe live API
  if (env.RAIL_EUROPE_API_KEY) {
    services = await callRailEuropeApi(env.RAIL_EUROPE_API_KEY, normOrigin, normDest, parsedDate, classPref);
    if (services && services.length > 0) dataSource = 'rail_europe_live';
  }

  // 2. Try Trainline Partner API
  if ((!services || services.length === 0) && env.TRAINLINE_API_KEY) {
    services = await callTrainlineApi(env.TRAINLINE_API_KEY, normOrigin, normDest, parsedDate, classPref);
    if (services && services.length > 0) dataSource = 'trainline_live';
  }

  // 3. Fall back to realistic mock schedule
  if (!services || services.length === 0) {
    services = buildMockServices(normOrigin, normDest, parsedDate, classPref, timePref);
    dataSource = 'eu_scheduled';
  }

  return {
    origin:         normOrigin,
    originCRS:      '',
    destination:    normDest,
    destinationCRS: '',
    date:           parsedDate,
    services,
    error:          dataSource === 'eu_scheduled' ? 'advance_schedule' : undefined,
    currency:       'EUR',
  };
}

/**
 * Format EU rail results for Claude's tool result context.
 * Fares are in EUR (stored in estimatedFareGbp field).
 */
export function formatEuTrainsForClaude(result: EuRailResult): string {
  if (result.services.length === 0) {
    return `No EU rail services found from ${result.origin} to ${result.destination} on ${result.date}.`;
  }

  const currency = result.currency === 'EUR' ? '€' : '£';
  const lines = result.services.map(s => {
    const arr = s.arrivalTime ? ` → ${s.arrivalTime}` : '';
    return `${s.departureTime}${arr} | ${s.operator} | ${currency}${s.estimatedFareGbp}`;
  });

  const note = result.error === 'advance_schedule'
    ? ' [Indicative schedule — book via Rail Europe/Trainline for live fares]'
    : ' [Live Rail Europe data]';

  return `EU Rail: ${result.origin} → ${result.destination} on ${result.date}${note}\n${lines.join('\n')}`;
}
