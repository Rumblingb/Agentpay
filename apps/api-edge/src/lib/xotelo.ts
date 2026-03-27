/**
 * Xotelo hotel price aggregator client.
 *
 * Xotelo is a FREE hotel price aggregator — no API key required.
 * REST endpoint: https://data.xotelo.com/api/rates?hotel_key=<key>&chk_in=YYYY-MM-DD&chk_out=YYYY-MM-DD
 *
 * Strategy:
 *   1. Live Xotelo call — when hotel_key is known for that city
 *   2. Realistic mock data — always available, planning only
 *
 * Cities covered:
 *   London, Paris, Tokyo, New York, Bangkok, Singapore, Rome, Barcelona,
 *   Amsterdam, Sydney, Dubai, Bali, Berlin, Amsterdam, Istanbul, Prague
 */

// ── Public HotelOption type (used by concierge confirm flow) ──────────────

/**
 * A single hotel option returned from searchHotels / formatted for Claude.
 * Intentionally lightweight — used by the concierge confirm flow.
 */
export interface HotelOption {
  name: string;
  city: string;
  checkIn: string;
  checkOut: string;
  pricePerNight: number;
  currency: string;
  /** Deep-link to Booking.com/Expedia/etc for this property (when Xotelo returns one) */
  bookingUrl?: string;
  /** Xotelo hotel_key for this property */
  hotelId?: string;
}

// ── Currency → GBP conversion (approximate, for hire layer normalisation) ──
// Display rates are shown in local currency; GBP equivalent used for escrow.

const CURRENCY_TO_GBP: Record<string, number> = {
  GBP: 1.00,
  EUR: 0.85,
  USD: 0.79,
  AUD: 0.51,
  JPY: 0.0052,   // 1 GBP ≈ 192 JPY
  THB: 0.022,    // 1 GBP ≈ 45 THB
  SGD: 0.58,
  AED: 0.22,     // 1 GBP ≈ 4.6 AED
  IDR: 0.000047, // 1 GBP ≈ 21,000 IDR (Bali)
  TRY: 0.024,    // 1 GBP ≈ 42 TRY
  CZK: 0.034,    // 1 GBP ≈ 29 CZK
};

function toGbp(amount: number, currency: string): number {
  const rate = CURRENCY_TO_GBP[currency.toUpperCase()] ?? 0.79;
  return Math.max(1, Math.round(amount * rate));
}

// ── City normalisation ──────────────────────────────────────────────────────

const CITY_ALIASES: Record<string, string> = {
  // English variants → canonical key used in CITY_DATA
  'london':            'london',
  'london uk':         'london',
  'paris':             'paris',
  'paris france':      'paris',
  'tokyo':             'tokyo',
  'new york':          'new_york',
  'new york city':     'new_york',
  'nyc':               'new_york',
  'ny':                'new_york',
  'bangkok':           'bangkok',
  'bkk':               'bangkok',
  'singapore':         'singapore',
  'rome':              'rome',
  'roma':              'rome',
  'barcelona':         'barcelona',
  'amsterdam':         'amsterdam',
  'sydney':            'sydney',
  'dubai':             'dubai',
  'bali':              'bali',
  'ubud':              'bali',
  'seminyak':          'bali',
  'kuta':              'bali',
  'berlin':            'berlin',
  'istanbul':          'istanbul',
  'prague':            'prague',
  'praha':             'prague',
};

export function normaliseCity(name: string): string {
  const key = name.toLowerCase().trim();
  return CITY_ALIASES[key] ?? key.replace(/\s+/g, '_');
}

// ── Mock hotel data ─────────────────────────────────────────────────────────

export interface HotelMock {
  name: string;
  area: string;
  stars: number;
  ratePerNight: number;
  currency: string;
  /** Xotelo hotel_key — populated for hotels Xotelo can price live */
  xoteloKey?: string;
}

const CITY_DATA: Record<string, { currency: string; hotels: HotelMock[] }> = {
  london: {
    currency: 'GBP',
    hotels: [
      { name: 'Premier Inn London Southwark', area: 'Southwark', stars: 3, ratePerNight: 89,  currency: 'GBP', xoteloKey: 'g186338-d231966' },
      { name: 'citizenM London Bankside',     area: 'Bankside',  stars: 4, ratePerNight: 129, currency: 'GBP', xoteloKey: 'g186338-d2018038' },
      { name: 'Hoxton Holborn',               area: 'Holborn',   stars: 4, ratePerNight: 149, currency: 'GBP', xoteloKey: 'g186338-d2018039' },
      { name: 'The Savoy',                    area: 'Strand',    stars: 5, ratePerNight: 599, currency: 'GBP', xoteloKey: 'g186338-d193845'  },
    ],
  },
  paris: {
    currency: 'EUR',
    hotels: [
      { name: 'ibis Paris Bastille',         area: '11th arr.',     stars: 3, ratePerNight: 79,  currency: 'EUR', xoteloKey: 'g187147-d250658'  },
      { name: 'Novotel Paris Tour Eiffel',   area: '15th arr.',     stars: 4, ratePerNight: 149, currency: 'EUR', xoteloKey: 'g187147-d197552'  },
      { name: 'Hôtel du Louvre',             area: 'Louvre/Opéra',  stars: 5, ratePerNight: 299, currency: 'EUR', xoteloKey: 'g187147-d188853'  },
      { name: 'Le Bristol Paris',            area: '8th arr.',      stars: 5, ratePerNight: 890, currency: 'EUR', xoteloKey: 'g187147-d194073'  },
    ],
  },
  tokyo: {
    currency: 'JPY',
    hotels: [
      { name: 'Dormy Inn Asakusa',           area: 'Asakusa',  stars: 3, ratePerNight: 8500,  currency: 'JPY', xoteloKey: 'g298184-d1223581' },
      { name: 'APA Hotel Shinjuku-Kabukicho', area: 'Shinjuku', stars: 3, ratePerNight: 9200,  currency: 'JPY', xoteloKey: 'g298184-d1895064' },
      { name: 'Andaz Tokyo Toranomon Hills', area: 'Toranomon', stars: 5, ratePerNight: 52000, currency: 'JPY', xoteloKey: 'g298184-d6535765' },
      { name: 'Park Hyatt Tokyo',            area: 'Shinjuku',  stars: 5, ratePerNight: 65000, currency: 'JPY', xoteloKey: 'g298184-d307470'  },
    ],
  },
  new_york: {
    currency: 'USD',
    hotels: [
      { name: 'Pod 51 Hotel',              area: 'Midtown East',  stars: 3, ratePerNight: 109, currency: 'USD', xoteloKey: 'g60763-d1758572'  },
      { name: 'citizenM New York Times Square', area: 'Times Square', stars: 4, ratePerNight: 189, currency: 'USD', xoteloKey: 'g60763-d4494203' },
      { name: 'The High Line Hotel',       area: 'Chelsea',       stars: 4, ratePerNight: 289, currency: 'USD', xoteloKey: 'g60763-d3605516'  },
      { name: 'The Plaza',                 area: 'Central Park South', stars: 5, ratePerNight: 749, currency: 'USD', xoteloKey: 'g60763-d93440' },
    ],
  },
  bangkok: {
    currency: 'THB',
    hotels: [
      { name: 'ibis Bangkok Sukhumvit',    area: 'Sukhumvit',       stars: 3, ratePerNight: 900,   currency: 'THB', xoteloKey: 'g293916-d300927'  },
      { name: 'Marriott Bangkok Sukhumvit', area: 'Sukhumvit',      stars: 4, ratePerNight: 2800,  currency: 'THB', xoteloKey: 'g293916-d301399'  },
      { name: 'Rosewood Bangkok',          area: 'Ploenchit',        stars: 5, ratePerNight: 9500,  currency: 'THB', xoteloKey: 'g293916-d17588483' },
      { name: 'Mandarin Oriental Bangkok', area: 'Riverside',        stars: 5, ratePerNight: 18000, currency: 'THB', xoteloKey: 'g293916-d300929'  },
    ],
  },
  singapore: {
    currency: 'SGD',
    hotels: [
      { name: 'Hotel 81 Bugis',            area: 'Bugis',         stars: 2, ratePerNight: 79,  currency: 'SGD', xoteloKey: 'g294265-d301400' },
      { name: 'Hotel Indigo Singapore Katong', area: 'East Coast', stars: 4, ratePerNight: 189, currency: 'SGD', xoteloKey: 'g294265-d3241637' },
      { name: 'Marina Bay Sands',          area: 'Marina Bay',    stars: 5, ratePerNight: 459, currency: 'SGD', xoteloKey: 'g294265-d1840986' },
      { name: 'Capella Singapore',         area: 'Sentosa',       stars: 5, ratePerNight: 890, currency: 'SGD', xoteloKey: 'g294265-d676064'  },
    ],
  },
  rome: {
    currency: 'EUR',
    hotels: [
      { name: 'Generator Rome',            area: 'Termini',        stars: 3, ratePerNight: 69,  currency: 'EUR', xoteloKey: 'g187791-d12210718' },
      { name: 'Hotel Artemide',            area: 'Via Nazionale',  stars: 4, ratePerNight: 129, currency: 'EUR', xoteloKey: 'g187791-d228161'  },
      { name: 'Palazzo Manfredi',          area: 'Colosseum',      stars: 5, ratePerNight: 449, currency: 'EUR', xoteloKey: 'g187791-d1035029' },
      { name: 'Hotel Eden Rome',           area: 'Via Veneto',     stars: 5, ratePerNight: 699, currency: 'EUR', xoteloKey: 'g187791-d191882'  },
    ],
  },
  barcelona: {
    currency: 'EUR',
    hotels: [
      { name: 'Barceló Raval',             area: 'El Raval',       stars: 4, ratePerNight: 99,  currency: 'EUR', xoteloKey: 'g187497-d575810'  },
      { name: 'Pullman Barcelona Skipper', area: 'Barceloneta',    stars: 4, ratePerNight: 149, currency: 'EUR', xoteloKey: 'g187497-d1031831' },
      { name: 'Hotel Arts Barcelona',      area: 'Port Olímpic',   stars: 5, ratePerNight: 379, currency: 'EUR', xoteloKey: 'g187497-d229659'  },
      { name: 'W Barcelona',               area: 'Barceloneta',    stars: 5, ratePerNight: 499, currency: 'EUR', xoteloKey: 'g187497-d1504041' },
    ],
  },
  amsterdam: {
    currency: 'EUR',
    hotels: [
      { name: 'ibis Amsterdam Centre',     area: 'Centrum',        stars: 3, ratePerNight: 99,  currency: 'EUR', xoteloKey: 'g188590-d197528'  },
      { name: 'citizenM Amsterdam South', area: 'South',           stars: 4, ratePerNight: 139, currency: 'EUR', xoteloKey: 'g188590-d2397384' },
      { name: 'Pulitzer Amsterdam',        area: 'Jordaan',         stars: 5, ratePerNight: 349, currency: 'EUR', xoteloKey: 'g188590-d195163'  },
      { name: 'Conservatorium Hotel',      area: 'Museum Quarter',  stars: 5, ratePerNight: 499, currency: 'EUR', xoteloKey: 'g188590-d3637517' },
    ],
  },
  sydney: {
    currency: 'AUD',
    hotels: [
      { name: 'ibis Sydney King Street Wharf', area: 'Darling Harbour', stars: 3, ratePerNight: 149, currency: 'AUD', xoteloKey: 'g255060-d2241523' },
      { name: 'Ovolo Woolloomooloo',        area: 'Woolloomooloo',  stars: 4, ratePerNight: 249, currency: 'AUD', xoteloKey: 'g255060-d4390553' },
      { name: 'Park Hyatt Sydney',          area: 'The Rocks',      stars: 5, ratePerNight: 699, currency: 'AUD', xoteloKey: 'g255060-d308673'  },
      { name: 'Quay Grand Suites',          area: 'Circular Quay',  stars: 5, ratePerNight: 549, currency: 'AUD', xoteloKey: 'g255060-d308677'  },
    ],
  },
  dubai: {
    currency: 'AED',
    hotels: [
      { name: 'Premier Inn Dubai Ibn Battuta Mall', area: 'Jebel Ali', stars: 3, ratePerNight: 280,  currency: 'AED', xoteloKey: 'g295424-d1066792' },
      { name: 'JW Marriott Marquis Dubai', area: 'Business Bay',   stars: 5, ratePerNight: 1100, currency: 'AED', xoteloKey: 'g295424-d2278775' },
      { name: 'Atlantis The Palm',         area: 'Palm Jumeirah',  stars: 5, ratePerNight: 1800, currency: 'AED', xoteloKey: 'g295424-d504028'  },
      { name: 'Burj Al Arab',              area: 'Jumeirah',       stars: 5, ratePerNight: 7200, currency: 'AED', xoteloKey: 'g295424-d117411'  },
    ],
  },
  bali: {
    currency: 'IDR',
    hotels: [
      { name: 'Kuta Paradiso Hotel',        area: 'Kuta',           stars: 3, ratePerNight: 350000,  currency: 'IDR', xoteloKey: 'g297694-d302207'  },
      { name: 'Alaya Resort Ubud',          area: 'Ubud',           stars: 4, ratePerNight: 950000,  currency: 'IDR', xoteloKey: 'g297694-d1219765' },
      { name: 'Four Seasons Jimbaran Bay',  area: 'Jimbaran',       stars: 5, ratePerNight: 4200000, currency: 'IDR', xoteloKey: 'g297697-d306262'  },
      { name: 'Bulgari Resort Bali',        area: 'Uluwatu',        stars: 5, ratePerNight: 6800000, currency: 'IDR', xoteloKey: 'g6838438-d506847' },
    ],
  },
  berlin: {
    currency: 'EUR',
    hotels: [
      { name: 'Motel One Berlin-Hauptbahnhof', area: 'Hauptbahnhof', stars: 3, ratePerNight: 79,  currency: 'EUR', xoteloKey: 'g187323-d1579388' },
      { name: 'nhow Berlin',               area: 'Friedrichshain',  stars: 4, ratePerNight: 119, currency: 'EUR', xoteloKey: 'g187323-d1743684' },
      { name: 'Hotel Adlon Kempinski',     area: 'Unter den Linden', stars: 5, ratePerNight: 549, currency: 'EUR', xoteloKey: 'g187323-d199583'  },
      { name: 'Soho House Berlin',         area: 'Mitte',            stars: 5, ratePerNight: 329, currency: 'EUR', xoteloKey: 'g187323-d3609866' },
    ],
  },
  istanbul: {
    currency: 'EUR',
    hotels: [
      { name: 'City Hotel Istanbul',        area: 'Sultanahmet',    stars: 3, ratePerNight: 65,  currency: 'EUR', xoteloKey: 'g293974-d300973'  },
      { name: 'Hilton Istanbul Bomonti',    area: 'Bomonti',        stars: 5, ratePerNight: 189, currency: 'EUR', xoteloKey: 'g293974-d3626097' },
      { name: 'The Peninsula Istanbul',     area: 'Karaköy',        stars: 5, ratePerNight: 599, currency: 'EUR', xoteloKey: 'g293974-d23521741' },
      { name: 'Çırağan Palace Kempinski',  area: 'Beşiktaş',       stars: 5, ratePerNight: 799, currency: 'EUR', xoteloKey: 'g293974-d301105'  },
    ],
  },
  prague: {
    currency: 'CZK',
    hotels: [
      { name: 'Mosaic House Design Hostel', area: 'Nové Město',     stars: 3, ratePerNight: 1800, currency: 'CZK', xoteloKey: 'g274707-d1223785' },
      { name: 'Vienna House Easy Prague',   area: 'Žižkov',         stars: 4, ratePerNight: 2800, currency: 'CZK', xoteloKey: 'g274707-d3616025' },
      { name: 'Four Seasons Prague',        area: 'Staré Město',    stars: 5, ratePerNight: 9500, currency: 'CZK', xoteloKey: 'g274707-d208557'  },
      { name: 'Mandarin Oriental Prague',   area: 'Malá Strana',    stars: 5, ratePerNight: 7800, currency: 'CZK', xoteloKey: 'g274707-d208562'  },
    ],
  },
};

// ── Date helpers ───────────────────────────────────────────────────────────

function parseHotelDate(dateStr?: string): string {
  const now = new Date();
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  if (!dateStr) { const d = new Date(now); d.setDate(d.getDate() + 1); return fmt(d); }
  const lower = dateStr.toLowerCase().trim();
  if (lower === 'today')    return fmt(now);
  if (lower === 'tonight')  return fmt(now);
  if (lower === 'tomorrow') { const d = new Date(now); d.setDate(d.getDate() + 1); return fmt(d); }
  // Already ISO YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  // Slash format YYYY/MM/DD
  const slash = dateStr.match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
  if (slash) return `${slash[1]}-${slash[2]}-${slash[3]}`;
  // Try native parse
  const d = new Date(dateStr);
  if (!isNaN(d.getTime())) return fmt(d);
  // Default: tomorrow
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return fmt(tomorrow);
}

function nightsBetween(checkIn: string, checkOut: string): number {
  const a = new Date(checkIn);
  const b = new Date(checkOut);
  if (isNaN(a.getTime()) || isNaN(b.getTime())) return 1;
  return Math.max(1, Math.round((b.getTime() - a.getTime()) / 86400000));
}

// ── Result type ───────────────────────────────────────────────────────────

export interface HotelResult {
  name: string;
  area: string;
  stars: number;
  ratePerNight: number;
  currency: string;
  bookingUrl?: string;
  /** Total for the stay */
  totalCost: number;
  /** GBP-equivalent of totalCost (for hire-layer escrow) */
  totalCostGbp: number;
  nights: number;
  bookingNote: string;
  /** Xotelo hotel_key when live data was fetched */
  xoteloKey?: string;
  /** True when rate came from live Xotelo API, false = mock */
  isLive: boolean;
}

// ── Live Xotelo call ──────────────────────────────────────────────────────

async function fetchXoteloRate(
  hotelKey: string,
  checkIn: string,
  checkOut: string,
): Promise<number | null> {
  try {
    const url = `https://data.xotelo.com/api/rates?hotel_key=${encodeURIComponent(hotelKey)}&chk_in=${checkIn}&chk_out=${checkOut}`;
    const resp = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'bro-concierge/1.0' },
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as any;

    // Xotelo response: { result: { rates: [{ name, rate, ... }] } }
    const rates: Array<{ rate?: number; price?: number }> = data?.result?.rates ?? [];
    if (!Array.isArray(rates) || rates.length === 0) return null;

    // Return lowest available rate across OTAs
    const amounts = rates
      .map(r => Number(r.rate ?? r.price ?? 0))
      .filter(n => n > 0);
    if (amounts.length === 0) return null;
    return Math.min(...amounts);
  } catch {
    return null;
  }
}

function buildHotelBookingUrl(params: {
  name: string;
  city: string;
  checkIn: string;
  checkOut: string;
}): string {
  const url = new URL('https://www.booking.com/searchresults.html');
  url.searchParams.set('ss', `${params.name} ${params.city}`.trim());
  url.searchParams.set('checkin', params.checkIn);
  url.searchParams.set('checkout', params.checkOut);
  url.searchParams.set('group_adults', '2');
  url.searchParams.set('no_rooms', '1');
  return url.toString();
}

// ── Search hotels ─────────────────────────────────────────────────────────

export interface SearchHotelsParams {
  city: string;
  checkIn?: string;
  checkOut?: string;
  rooms?: number;
  stars?: number;
}

export async function searchHotels(params: SearchHotelsParams): Promise<HotelResult[]> {
  const cityKey = normaliseCity(params.city);
  const cityData = CITY_DATA[cityKey];

  if (!cityData) {
    // Return empty — Claude will say "not available yet"
    return [];
  }

  const checkIn  = parseHotelDate(params.checkIn);
  const checkOut = parseHotelDate(params.checkOut ?? (() => {
    // Default: check-in + 1 night
    const d = new Date(checkIn);
    d.setDate(d.getDate() + 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })());
  const nights = nightsBetween(checkIn, checkOut);

  let hotels = [...cityData.hotels];

  // Filter by star rating if requested
  if (params.stars && params.stars >= 1 && params.stars <= 5) {
    const filtered = hotels.filter(h => h.stars === params.stars);
    if (filtered.length > 0) hotels = filtered;
  }

  // Build results — try Xotelo live for top 3 hotels only (avoid latency on all 4)
  const results: HotelResult[] = await Promise.all(
    hotels.slice(0, 4).map(async (hotel) => {
      let ratePerNight = hotel.ratePerNight;
      let isLive = false;

      if (hotel.xoteloKey) {
        const liveRate = await fetchXoteloRate(hotel.xoteloKey, checkIn, checkOut).catch(() => null);
        if (liveRate && liveRate > 0) {
          ratePerNight = Math.round(liveRate);
          isLive = true;
        }
      }

      const totalCost    = ratePerNight * nights * (params.rooms ?? 1);
      const totalCostGbp = toGbp(totalCost, hotel.currency);
      const bookingNote  = isLive
        ? `Live price from Xotelo. Book via app — ops team confirms.`
        : `Indicative rate — final price confirmed at booking.`;
      const bookingUrl = buildHotelBookingUrl({
        name: hotel.name,
        city: params.city,
        checkIn,
        checkOut,
      });

      return {
        name: hotel.name,
        area: hotel.area,
        stars: hotel.stars,
        ratePerNight,
        currency: hotel.currency,
        bookingUrl,
        totalCost,
        totalCostGbp,
        nights,
        bookingNote,
        xoteloKey: hotel.xoteloKey,
        isLive,
      };
    }),
  );

  // Sort: budget first (ascending by ratePerNight)
  return results.sort((a, b) => a.ratePerNight - b.ratePerNight);
}

// ── Format for Claude ─────────────────────────────────────────────────────

export function formatHotelsForClaude(
  results: HotelResult[],
  city: string,
  checkIn: string,
  checkOut: string,
): string {
  if (results.length === 0) {
    return `No hotels found in ${city} for those dates. Try a different city or dates.`;
  }

  const nights = results[0]?.nights ?? 1;
  const top    = results.slice(0, 3);

  const lines = top.map((h, i) => {
    const stars   = '★'.repeat(h.stars);
    const symMap: Record<string, string> = {
      GBP: '£', EUR: '€', USD: '$', JPY: '¥', THB: '฿',
      SGD: 'S$', AED: 'AED ', AUD: 'A$', IDR: 'Rp', TRY: '₺', CZK: 'Kč',
    };
    const sym       = symMap[h.currency] ?? (h.currency + ' ');
    const total     = sym + h.totalCost.toLocaleString();
    const perNight  = sym + h.ratePerNight.toLocaleString();
    const liveTag   = h.isLive ? ' [live]' : '';
    const bookTag   = h.bookingUrl ? ' [Book →]' : '';
    return `${i + 1}. ${h.name} ${stars} — ${h.area}. ${perNight}/night${liveTag}. ${nights} night${nights === 1 ? '' : 's'} = ${total}.${bookTag}`;
  });

  const source = top.some(h => h.isLive) ? '[Xotelo live prices]' : '[Indicative — book to confirm]';
  const nights_label = `${nights} night${nights === 1 ? '' : 's'}`;

  return `Hotels in ${city} — ${checkIn} to ${checkOut} (${nights_label}) ${source}\n${lines.join('\n')}`;
}

/**
 * Format a list of HotelOption items for Claude narration.
 *
 * Returns a compact numbered list like:
 *   "1. CitizenM Rome, €95/night, check-in May 5. [Book →] 2. ..."
 *
 * Accepts the lightweight HotelOption type so concierge confirm flows can
 * call this without needing a full HotelResult.
 */
export function formatHotelOptionsForClaude(hotels: HotelOption[]): string {
  if (hotels.length === 0) return 'No hotels available for those dates.';

  const symMap: Record<string, string> = {
    GBP: '£', EUR: '€', USD: '$', JPY: '¥', THB: '฿',
    SGD: 'S$', AED: 'AED ', AUD: 'A$', IDR: 'Rp', TRY: '₺', CZK: 'Kč',
  };

  return hotels
    .slice(0, 5)
    .map((h, i) => {
      const sym      = symMap[h.currency] ?? (h.currency + ' ');
      const price    = `${sym}${h.pricePerNight}/night`;
      const dateStr  = `check-in ${h.checkIn}`;
      const bookLink = h.bookingUrl ? ' [Book →]' : '';
      return `${i + 1}. ${h.name}, ${price}, ${dateStr}.${bookLink}`;
    })
    .join(' ');
}
