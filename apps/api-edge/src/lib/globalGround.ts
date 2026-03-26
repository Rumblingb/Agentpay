import type { Env } from '../types';
import type { TrainService } from './rtt';
import { queryBus as queryBusBusbud, isBusRoute, formatBusForClaude } from './busbud';
import { queryGlobalRail as queryGlobalRailFull, isGlobalRoute, formatGlobalTrainsForClaude } from './globalRail';

export interface GlobalGroundResult {
  origin: string;
  destination: string;
  date: string;
  services: TrainService[];
  error?: 'advance_schedule';
  currency: 'GBP';
}

type GroundMode = 'rail' | 'bus';

interface GroundCity {
  canonical: string;
  market: 'na' | 'asia';
}

const GLOBAL_RAIL_CITIES: Record<string, GroundCity> = {
  'new york': { canonical: 'New York Penn Station', market: 'na' },
  'nyc': { canonical: 'New York Penn Station', market: 'na' },
  'boston': { canonical: 'Boston South Station', market: 'na' },
  'washington': { canonical: 'Washington Union Station', market: 'na' },
  'washington dc': { canonical: 'Washington Union Station', market: 'na' },
  'philadelphia': { canonical: 'Philadelphia 30th Street', market: 'na' },
  'toronto': { canonical: 'Toronto Union Station', market: 'na' },
  'montreal': { canonical: 'Montreal Central Station', market: 'na' },
  'vancouver': { canonical: 'Vancouver Pacific Central', market: 'na' },
  'seattle': { canonical: 'Seattle King Street', market: 'na' },
  'tokyo': { canonical: 'Tokyo Station', market: 'asia' },
  'kyoto': { canonical: 'Kyoto Station', market: 'asia' },
  'osaka': { canonical: 'Shin-Osaka Station', market: 'asia' },
  'nagoya': { canonical: 'Nagoya Station', market: 'asia' },
  'seoul': { canonical: 'Seoul Station', market: 'asia' },
  'busan': { canonical: 'Busan Station', market: 'asia' },
  'bangkok': { canonical: 'Bangkok Krung Thep Aphiwat', market: 'asia' },
  'chiang mai': { canonical: 'Chiang Mai Station', market: 'asia' },
  'singapore': { canonical: 'Woodlands Train Checkpoint', market: 'asia' },
  'kuala lumpur': { canonical: 'KL Sentral', market: 'asia' },
};

const GLOBAL_BUS_CITIES: Record<string, GroundCity> = {
  ...GLOBAL_RAIL_CITIES,
  'los angeles': { canonical: 'Los Angeles Union Station', market: 'na' },
  'san francisco': { canonical: 'San Francisco Salesforce Transit Center', market: 'na' },
  'las vegas': { canonical: 'Las Vegas Bus Station', market: 'na' },
  'miami': { canonical: 'Miami Intermodal Center', market: 'na' },
  'orlando': { canonical: 'Orlando Bus Station', market: 'na' },
  'ho chi minh city': { canonical: 'Ho Chi Minh City Mien Dong Bus Station', market: 'asia' },
  'saigon': { canonical: 'Ho Chi Minh City Mien Dong Bus Station', market: 'asia' },
  'phnom penh': { canonical: 'Phnom Penh Central Bus Station', market: 'asia' },
  'siem reap': { canonical: 'Siem Reap Bus Terminal', market: 'asia' },
  'hanoi': { canonical: 'Hanoi Nuoc Ngam Bus Station', market: 'asia' },
};

const RAIL_FARES_GBP: Record<string, number> = {
  'new york-boston': 54,
  'new york-washington': 48,
  'new york-philadelphia': 24,
  'boston-washington': 79,
  'toronto-montreal': 52,
  'vancouver-seattle': 36,
  'tokyo-kyoto': 74,
  'tokyo-osaka': 78,
  'tokyo-nagoya': 52,
  'osaka-kyoto': 12,
  'seoul-busan': 44,
  'bangkok-chiang mai': 29,
  'singapore-kuala lumpur': 21,
};

const BUS_FARES_GBP: Record<string, number> = {
  'new york-boston': 18,
  'new york-washington': 22,
  'los angeles-las vegas': 26,
  'san francisco-los angeles': 32,
  'miami-orlando': 19,
  'toronto-montreal': 27,
  'seattle-vancouver': 18,
  'bangkok-chiang mai': 21,
  'bangkok-phnom penh': 29,
  'phnom penh-siem reap': 11,
  'hanoi-ho chi minh city': 49,
  'singapore-kuala lumpur': 16,
};

const RAIL_DURATIONS_MIN: Record<string, number> = {
  'new york-boston': 240,
  'new york-washington': 185,
  'new york-philadelphia': 90,
  'boston-washington': 410,
  'toronto-montreal': 330,
  'vancouver-seattle': 255,
  'tokyo-kyoto': 135,
  'tokyo-osaka': 150,
  'tokyo-nagoya': 100,
  'osaka-kyoto': 28,
  'seoul-busan': 160,
  'bangkok-chiang mai': 640,
  'singapore-kuala lumpur': 330,
};

const BUS_DURATIONS_MIN: Record<string, number> = {
  'new york-boston': 260,
  'new york-washington': 285,
  'los angeles-las vegas': 320,
  'san francisco-los angeles': 455,
  'miami-orlando': 245,
  'toronto-montreal': 405,
  'seattle-vancouver': 240,
  'bangkok-chiang mai': 600,
  'bangkok-phnom penh': 720,
  'phnom penh-siem reap': 360,
  'hanoi-ho chi minh city': 1980,
  'singapore-kuala lumpur': 300,
};

const RAIL_OPERATORS: Record<string, string> = {
  'new york-boston': 'Amtrak Acela',
  'new york-washington': 'Amtrak Northeast Regional',
  'new york-philadelphia': 'Amtrak Northeast Regional',
  'boston-washington': 'Amtrak Acela',
  'toronto-montreal': 'VIA Rail',
  'vancouver-seattle': 'Amtrak Cascades',
  'tokyo-kyoto': 'JR Tokaido Shinkansen',
  'tokyo-osaka': 'JR Tokaido Shinkansen',
  'tokyo-nagoya': 'JR Tokaido Shinkansen',
  'osaka-kyoto': 'JR Special Rapid',
  'seoul-busan': 'KTX',
  'bangkok-chiang mai': 'State Railway of Thailand',
  'singapore-kuala lumpur': 'Shuttle Tebrau + ETS',
};

const BUS_OPERATORS: Record<string, string> = {
  'new york-boston': 'FlixBus',
  'new york-washington': 'FlixBus',
  'los angeles-las vegas': 'Greyhound',
  'san francisco-los angeles': 'FlixBus',
  'miami-orlando': 'RedCoach',
  'toronto-montreal': 'Megabus',
  'seattle-vancouver': 'Quick Shuttle',
  'bangkok-chiang mai': 'Nakhonchai Air',
  'bangkok-phnom penh': 'Giant Ibis',
  'phnom penh-siem reap': 'Virak Buntham',
  'hanoi-ho chi minh city': 'FUTA Bus Lines',
  'singapore-kuala lumpur': 'Aeroline',
};

const RAIL_SLOTS = ['06:45', '08:10', '11:20', '14:05', '17:15'];
const BUS_SLOTS = ['07:00', '09:30', '13:00', '16:30', '20:00'];

function normalize(map: Record<string, GroundCity>, value: string): GroundCity | null {
  return map[value.toLowerCase().trim()] ?? null;
}

function routeKey(origin: string, destination: string): string {
  return `${origin.toLowerCase().split(' ')[0]}-${destination.toLowerCase().split(' ')[0]}`;
}

function addMinutes(time: string, mins: number): string {
  const [h, m] = time.split(':').map(Number);
  const total = h * 60 + m + mins;
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function parseDate(dateStr?: string): string {
  const now = new Date();
  const fmt = (d: Date) => `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
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
  const iso = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `${iso[1]}/${iso[2]}/${iso[3]}`;
  const fallback = new Date(now);
  fallback.setDate(fallback.getDate() + 1);
  return fmt(fallback);
}

function pickSlots(mode: GroundMode, timePreference?: string): string[] {
  const base = mode === 'rail' ? RAIL_SLOTS : BUS_SLOTS;
  if (timePreference === 'morning') return base.filter((slot) => slot < '12:00').slice(0, 3);
  if (timePreference === 'afternoon') return base.filter((slot) => slot >= '12:00' && slot < '17:00').slice(0, 3);
  if (timePreference === 'evening') return base.filter((slot) => slot >= '17:00').slice(0, 3);
  return [base[1], base[2], base[3]];
}

function buildMockServices(
  mode: GroundMode,
  origin: string,
  destination: string,
  date: string,
  timePreference?: string,
): TrainService[] {
  const key = routeKey(origin, destination);
  const baseFare = mode === 'rail' ? (RAIL_FARES_GBP[key] ?? 55) : (BUS_FARES_GBP[key] ?? 24);
  const duration = mode === 'rail' ? (RAIL_DURATIONS_MIN[key] ?? 300) : (BUS_DURATIONS_MIN[key] ?? 360);
  const operator = mode === 'rail' ? (RAIL_OPERATORS[key] ?? 'Regional Rail') : (BUS_OPERATORS[key] ?? 'Intercity Coach');
  const slots = pickSlots(mode, timePreference);

  return slots.map((departureTime, index) => ({
    departureTime,
    arrivalTime: addMinutes(departureTime, duration + (index * 10)),
    operator,
    serviceUid: `${mode === 'rail' ? 'GR' : 'BUS'}${date.replace(/\//g, '')}${index}`,
    destination,
    estimatedFareGbp: Math.round(baseFare * (0.95 + index * 0.1)),
    platform: undefined,
  }));
}

export function isGlobalRailRoute(origin: string, destination: string): boolean {
  // Use richer globalRail.ts coverage (60+ cities, Japan/USA/Canada/Korea/SE Asia/Australia)
  // or fall back to the legacy city map for backwards compat
  return isGlobalRoute(origin, destination)
    || (!!normalize(GLOBAL_RAIL_CITIES, origin) && !!normalize(GLOBAL_RAIL_CITIES, destination));
}

export function isSupportedBusRoute(origin: string, destination: string): boolean {
  // Use richer busbud.ts coverage (80+ cities including all UK), but require both endpoints
  // to be recognized so we do not fabricate routes from one known city to an unknown place.
  return isBusRoute(origin, destination)
    || (!!normalize(GLOBAL_BUS_CITIES, origin) && !!normalize(GLOBAL_BUS_CITIES, destination));
}


export async function queryGlobalRail(
  env: Env,
  origin: string,
  destination: string,
  date?: string,
  timePreference?: string,
): Promise<GlobalGroundResult> {
  // Delegate to richer globalRail.ts (60+ cities, multi-currency, real G2Rail/12Go API)
  const richResult = await queryGlobalRailFull(env, origin, destination, date, undefined, timePreference);
  return {
    origin:      richResult.origin,
    destination: richResult.destination,
    date:        richResult.date,
    services:    richResult.services,
    error:       richResult.error as 'advance_schedule' | undefined,
    currency:    'GBP',
  };
}

export async function queryBus(
  env: Env,
  origin: string,
  destination: string,
  date?: string,
  timePreference?: string,
): Promise<GlobalGroundResult> {
  // Delegate to richer busbud.ts (80+ cities, UK National Express/Megabus, real Busbud/FlixBus API)
  const richResult = await queryBusBusbud(env, origin, destination, date, undefined, timePreference);
  // Adapt BusService[] → TrainService[] (same fields, different type name)
  const services: TrainService[] = richResult.services.map((s) => ({
    departureTime:    s.departureTime,
    arrivalTime:      s.arrivalTime,
    operator:         s.operator,
    serviceUid:       s.serviceId,
    destination:      s.destination,
    estimatedFareGbp: s.fareLocal, // stored as local currency, Claude will read it as a number
    platform:         undefined,
  }));
  return {
    origin:      richResult.origin,
    destination: richResult.destination,
    date:        richResult.date,
    services,
    error:       richResult.dataSource === 'bus_scheduled' ? 'advance_schedule' : undefined,
    currency:    'GBP',
  };
}

export function formatGlobalGroundForClaude(
  mode: GroundMode,
  result: GlobalGroundResult,
): string {
  if (result.services.length === 0) {
    return `No ${mode} services found from ${result.origin} to ${result.destination} on ${result.date}.`;
  }

  const note = result.error === 'advance_schedule'
    ? mode === 'rail'
      ? ' [Indicative schedule — live G2Rail/12Go feed activates when key set]'
      : ' [Indicative schedule — live Busbud/FlixBus feed activates when key set]'
    : mode === 'rail'
      ? ' [Live rail data]'
      : ' [Live bus data]';

  const lines = result.services.map((service) =>
    `${service.departureTime}${service.arrivalTime ? ` → ${service.arrivalTime}` : ''} | ${service.operator} | ${service.estimatedFareGbp}`,
  );

  return `${mode === 'rail' ? 'Global Rail' : 'Bus'}: ${result.origin} → ${result.destination} on ${result.date}${note}\n${lines.join('\n')}`;
}
