/**
 * Duffel Flights client — REST, edge-compatible, no Node SDK.
 *
 * Flow (two-phase, mirrors the train booking pattern):
 *   Phase 1 (search):  createOfferRequest → listOffers → return top 3
 *   Phase 2 (book):    createOrder with best offerId + passenger details
 *
 * Docs: https://duffel.com/docs/api/v2
 * Auth: Authorization: Bearer <DUFFEL_API_KEY>, Duffel-Version: v2
 *
 * Test mode: key prefix `duffel_test_` → sandbox, no real tickets
 * Prod mode:  key prefix `duffel_live_` → live bookings
 *
 * Set via: npx wrangler secret put DUFFEL_API_KEY
 */

const DUFFEL_BASE = 'https://api.duffel.com';
const DUFFEL_VERSION = 'v2';

function duffelHeaders(apiKey: string) {
  return {
    'Authorization':  `Bearer ${apiKey}`,
    'Duffel-Version': DUFFEL_VERSION,
    'Content-Type':   'application/json',
    'Accept':         'application/json',
  };
}

// ── Types ──────────────────────────────────────────────────────────────────

export interface FlightSearchParams {
  /** IATA airport code or city name — will be resolved to IATA */
  origin: string;
  destination: string;
  departureDate: string;          // YYYY-MM-DD
  returnDate?: string;            // YYYY-MM-DD for round trip
  passengers?: number;            // default 1
  cabinClass?: 'economy' | 'premium_economy' | 'business' | 'first';
}

export interface FlightOffer {
  offerId:         string;
  offerExpiresAt:  string;        // ISO timestamp — short TTL, typically 15–60 min
  totalAmount:     number;
  currency:        string;
  /** e.g. "British Airways" */
  carrier:         string;
  /** e.g. "BA2614" */
  flightNumber:    string;
  origin:          string;        // IATA e.g. "LHR"
  destination:     string;        // IATA e.g. "FCO"
  departureAt:     string;        // ISO
  arrivalAt:       string;        // ISO
  durationMinutes: number;
  stops:           number;        // 0 = direct
  cabinClass:      string;
  /** Formatted string for Claude narration */
  label:           string;
  /** True when this is a return trip */
  isReturn:        boolean;
  /** Return leg info (if round trip) */
  returnDepartureAt?: string;
  returnArrivalAt?:   string;
  returnCarrier?:     string;
  returnFlightNumber?: string;
}

export interface FlightOrder {
  orderId:          string;
  bookingReference: string;       // PNR — e.g. "ABC123"
  totalAmount:      number;
  currency:         string;
  carrier:          string;
  flightNumber:     string;
  origin:           string;
  destination:      string;
  departureAt:      string;
  arrivalAt:        string;
  passengerName:    string;
}

export interface DuffelPassenger {
  title?:        'mr' | 'ms' | 'mrs' | 'miss' | 'dr';
  given_name:    string;
  family_name:   string;
  email:         string;
  phone_number?: string;         // E.164 e.g. "+447700900000"
  born_on?:      string;         // YYYY-MM-DD — required for international
  gender?:       'm' | 'f';
  identity_documents?: Array<{
    unique_identifier: string;   // passport number
    issuing_country_code: string; // ISO alpha-2
    expires_on:  string;         // YYYY-MM-DD
    type:        'passport' | 'national_identity_card' | 'driving_licence';
  }>;
}

// ── IATA city → airport code resolution ───────────────────────────────────
// Common city names that need mapping — Duffel accepts IATA codes for origins/destinations

const CITY_TO_IATA: Record<string, string> = {
  // UK
  'london':        'LON',  // multi-airport city
  'london heathrow': 'LHR',
  'london gatwick':  'LGW',
  'london stansted': 'STN',
  'london city':     'LCY',
  'london luton':    'LTN',
  'manchester':    'MAN',
  'birmingham':    'BHX',
  'edinburgh':     'EDI',
  'glasgow':       'GLA',
  'bristol':       'BRS',
  'newcastle':     'NCL',
  'leeds bradford': 'LBA',
  'belfast':       'BFS',
  'cardiff':       'CWL',
  // Europe
  'paris':         'PAR',  // CDG + ORY
  'paris cdg':     'CDG',
  'paris orly':    'ORY',
  'amsterdam':     'AMS',
  'berlin':        'BER',
  'munich':        'MUC',
  'frankfurt':     'FRA',
  'rome':          'ROM',
  'rome fiumicino': 'FCO',
  'milan':         'MIL',
  'milan malpensa': 'MXP',
  'milan linate':  'LIN',
  'barcelona':     'BCN',
  'madrid':        'MAD',
  'lisbon':        'LIS',
  'dublin':        'DUB',
  'brussels':      'BRU',
  'vienna':        'VIE',
  'zurich':        'ZRH',
  'geneva':        'GVA',
  'stockholm':     'ARN',
  'oslo':          'OSL',
  'copenhagen':    'CPH',
  'athens':        'ATH',
  'istanbul':      'IST',
  'dubai':         'DXB',
  'abu dhabi':     'AUH',
  // USA
  'new york':      'NYC',
  'new york jfk':  'JFK',
  'new york newark': 'EWR',
  'los angeles':   'LAX',
  'san francisco': 'SFO',
  'chicago':       'ORD',
  'miami':         'MIA',
  // India
  'delhi':         'DEL',
  'mumbai':        'BOM',
  'bangalore':     'BLR',
  'chennai':       'MAA',
  'kolkata':       'CCU',
  'hyderabad':     'HYD',
};

function resolveIata(input: string): string {
  const lower = input.trim().toLowerCase();
  return CITY_TO_IATA[lower] ?? input.trim().toUpperCase();
}

// ── API helpers ────────────────────────────────────────────────────────────

function durationMins(departureAt: string, arrivalAt: string): number {
  return Math.round((new Date(arrivalAt).getTime() - new Date(departureAt).getTime()) / 60000);
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

function buildOfferLabel(offer: Omit<FlightOffer, 'label'>): string {
  const timeStr  = `${formatTime(offer.departureAt)}→${formatTime(offer.arrivalAt)}`;
  const durH     = Math.floor(offer.durationMinutes / 60);
  const durM     = offer.durationMinutes % 60;
  const durStr   = durH > 0 ? `${durH}h ${durM}m` : `${durM}m`;
  const stopStr  = offer.stops === 0 ? 'direct' : `${offer.stops} stop${offer.stops > 1 ? 's' : ''}`;
  const priceStr = `${offer.currency} ${offer.totalAmount.toFixed(0)}`;

  let label = `${offer.flightNumber} ${offer.origin}→${offer.destination} ${timeStr} · ${durStr} ${stopStr} · ${priceStr} (${offer.cabinClass}) [${offer.carrier}]`;
  if (offer.isReturn && offer.returnDepartureAt) {
    label += ` | Return ${offer.returnCarrier ?? ''} ${offer.returnFlightNumber ?? ''} ${formatTime(offer.returnDepartureAt)}→${formatTime(offer.returnArrivalAt ?? '')}`;
  }
  return label;
}

// ── Step 1: Create offer request ───────────────────────────────────────────

async function createOfferRequest(
  params: FlightSearchParams,
  apiKey: string,
): Promise<string | null> {
  const passengers = params.passengers ?? 1;
  const passengerArray = Array.from({ length: passengers }, () => ({ type: 'adult' }));

  const slices: object[] = [{
    origin:         resolveIata(params.origin),
    destination:    resolveIata(params.destination),
    departure_date: params.departureDate,
  }];

  if (params.returnDate) {
    slices.push({
      origin:         resolveIata(params.destination),
      destination:    resolveIata(params.origin),
      departure_date: params.returnDate,
    });
  }

  const body = {
    data: {
      slices,
      passengers:   passengerArray,
      cabin_class:  params.cabinClass ?? 'economy',
    },
  };

  const resp = await fetch(`${DUFFEL_BASE}/air/offer_requests`, {
    method:  'POST',
    headers: duffelHeaders(apiKey),
    body:    JSON.stringify(body),
  });

  if (!resp.ok) {
    const err = await resp.text();
    console.info(JSON.stringify({ bro: true, event: 'duffel_offer_request_error', status: resp.status, err }));
    return null;
  }

  const json = await resp.json() as { data: { id: string } };
  return json.data.id;
}

// ── Step 2: List + rank offers ────────────────────────────────────────────

async function listOffers(offerRequestId: string, apiKey: string): Promise<FlightOffer[]> {
  const resp = await fetch(
    `${DUFFEL_BASE}/air/offers?offer_request_id=${offerRequestId}&sort=total_amount&limit=20&max_connections=1`,
    { headers: duffelHeaders(apiKey) },
  );

  if (!resp.ok) {
    const err = await resp.text();
    console.info(JSON.stringify({ bro: true, event: 'duffel_list_offers_error', status: resp.status, err }));
    return [];
  }

  const json = await resp.json() as { data: any[] };
  const raw  = json.data ?? [];

  const offers: FlightOffer[] = raw.map((o: any): FlightOffer | null => {
    try {
      const outboundSlice = o.slices?.[0];
      const seg0          = outboundSlice?.segments?.[0];
      if (!seg0) return null;

      const returnSlice = o.slices?.[1];
      const rSeg0       = returnSlice?.segments?.[0];

      const offerBase: Omit<FlightOffer, 'label'> = {
        offerId:         o.id,
        offerExpiresAt:  o.expires_at ?? '',
        totalAmount:     parseFloat(o.total_amount ?? '0'),
        currency:        o.total_currency ?? 'GBP',
        carrier:         seg0.marketing_carrier?.name ?? seg0.operating_carrier?.name ?? 'Unknown',
        flightNumber:    `${seg0.marketing_carrier_flight_number ?? seg0.flight_number ?? ''}`,
        origin:          seg0.origin?.iata_code ?? '',
        destination:     seg0.destination?.iata_code ?? '',
        departureAt:     seg0.departing_at ?? '',
        arrivalAt:       seg0.arriving_at ?? '',
        durationMinutes: durationMins(seg0.departing_at ?? '', seg0.arriving_at ?? ''),
        stops:           (outboundSlice?.segments?.length ?? 1) - 1,
        cabinClass:      o.passengers?.[0]?.cabin_class ?? 'economy',
        isReturn:        !!returnSlice,
        returnDepartureAt:   rSeg0?.departing_at,
        returnArrivalAt:     rSeg0?.arriving_at,
        returnCarrier:       rSeg0?.marketing_carrier?.name,
        returnFlightNumber:  rSeg0?.marketing_carrier_flight_number,
      };

      return { ...offerBase, label: buildOfferLabel(offerBase) };
    } catch {
      return null;
    }
  }).filter((o): o is FlightOffer => o !== null);

  // Return top 3: cheapest, fastest, best airline (dedup by carrier)
  const sorted = [...offers].sort((a, b) => a.totalAmount - b.totalAmount);
  const top3: FlightOffer[] = [];
  const seenCarriers = new Set<string>();

  // 1. Cheapest
  if (sorted[0]) { top3.push(sorted[0]); seenCarriers.add(sorted[0].carrier); }

  // 2. Fastest (different carrier if possible)
  const fastest = [...offers].sort((a, b) => a.durationMinutes - b.durationMinutes)
    .find(o => !seenCarriers.has(o.carrier));
  if (fastest) { top3.push(fastest); seenCarriers.add(fastest.carrier); }

  // 3. Third option (cheapest not yet included)
  const third = sorted.find(o => !top3.includes(o));
  if (third) top3.push(third);

  return top3;
}

// ── Public: searchFlights ─────────────────────────────────────────────────

export async function searchFlights(
  params: FlightSearchParams,
  apiKey: string,
): Promise<FlightOffer[]> {
  if (!apiKey) return [];

  const requestId = await createOfferRequest(params, apiKey);
  if (!requestId) return [];

  return listOffers(requestId, apiKey);
}

// ── Public: formatFlightsForClaude ────────────────────────────────────────

export function formatFlightsForClaude(
  offers: FlightOffer[],
  origin: string,
  destination: string,
  date: string,
): string {
  if (offers.length === 0) {
    return `No flights found from ${origin} to ${destination} on ${date}. Try adjacent dates or different airports.`;
  }

  const lines: string[] = [`Flights from ${origin} to ${destination} on ${date}:`];
  offers.forEach((o, i) => {
    const dateStr = formatDate(o.departureAt);
    const durH    = Math.floor(o.durationMinutes / 60);
    const durM    = o.durationMinutes % 60;
    const durStr  = durH > 0 ? `${durH}h ${durM}m` : `${durM}m`;
    const stopStr = o.stops === 0 ? 'direct' : `${o.stops} stop${o.stops > 1 ? 's' : ''}`;
    const price   = `${o.currency} ${o.totalAmount.toFixed(0)}`;

    lines.push(
      `${i + 1}. ${o.carrier} ${o.flightNumber} · ${dateStr} · departs ${formatTime(o.departureAt)} arrives ${formatTime(o.arrivalAt)} · ${durStr} ${stopStr} · ${price} ${o.cabinClass}${
        o.isReturn ? ` (return ${o.returnCarrier} ${o.returnFlightNumber} departs ${formatTime(o.returnDepartureAt ?? '')})` : ''
      }`,
    );
  });

  lines.push(`\nBest option ID: ${offers[0]?.offerId} (use this for booking — expires ${offers[0]?.offerExpiresAt})`);
  return lines.join('\n');
}

// ── Public: createFlightOrder ─────────────────────────────────────────────

/**
 * Book a flight. Called in Phase 2 (confirmed = true).
 * Supports multiple passengers for family/group bookings.
 */
export async function createFlightOrder(
  offerId: string,
  passenger: DuffelPassenger | DuffelPassenger[],
  apiKey: string,
): Promise<FlightOrder | null> {
  const passengers = Array.isArray(passenger) ? passenger : [passenger];

  const passengerPayloads = passengers.map((p) => {
    let given  = p.given_name;
    let family = p.family_name;
    if (!family && given.includes(' ')) {
      const parts = given.trim().split(/\s+/);
      family = parts.pop() ?? '';
      given  = parts.join(' ');
    }
    const payload: Record<string, unknown> = {
      type:        'adult',
      given_name:  given,
      family_name: family,
      email:       p.email || passengers[0]?.email || '',
    };
    if (p.phone_number) payload.phone_number = p.phone_number;
    if (p.born_on)      payload.born_on = p.born_on;
    if (p.gender)       payload.gender = p.gender;
    if (p.identity_documents?.length) payload.identity_documents = p.identity_documents;
    return payload;
  });

  // For the lead passenger name in the return value
  const lead = passengerPayloads[0]!;

  const body = {
    data: {
      selected_offers: [offerId],
      passengers:      passengerPayloads,
      payments:        [{ type: 'balance', currency: 'GBP', amount: '0' }], // balance payment — AgentPay handles the real payment
    },
  };

  const resp = await fetch(`${DUFFEL_BASE}/air/orders`, {
    method:  'POST',
    headers: duffelHeaders(apiKey),
    body:    JSON.stringify(body),
  });

  if (!resp.ok) {
    const err = await resp.text();
    console.info(JSON.stringify({ bro: true, event: 'duffel_order_error', status: resp.status, offerId, err }));
    return null;
  }

  const json = await resp.json() as { data: any };
  const d    = json.data;
  const seg0 = d.slices?.[0]?.segments?.[0];

  if (!seg0) return null;

  return {
    orderId:          d.id,
    bookingReference: d.booking_reference ?? d.id,
    totalAmount:      parseFloat(d.total_amount ?? '0'),
    currency:         d.total_currency ?? 'GBP',
    carrier:          seg0.marketing_carrier?.name ?? '',
    flightNumber:     `${seg0.marketing_carrier_flight_number ?? ''}`,
    origin:           seg0.origin?.iata_code ?? '',
    destination:      seg0.destination?.iata_code ?? '',
    departureAt:      seg0.departing_at ?? '',
    arrivalAt:        seg0.arriving_at ?? '',
    passengerName:    `${String(lead.given_name)} ${String(lead.family_name)}`,
  };
}
