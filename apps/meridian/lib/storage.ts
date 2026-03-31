/**
 * storage.ts — persistent credential + preference store
 *
 * Credentials (agentId, agentKey) → expo-secure-store (encrypted)
 * Preferences (userName, autoConfirmLimit) → AsyncStorage
 * Conversation history → AsyncStorage (last 50 turns)
 */

import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { TripContext } from '../../../packages/bro-trip/index';

// ── Keys ──────────────────────────────────────────────────────────────────────

const KEYS = {
  agentId:          'meridian.agentId',
  agentKey:         'meridian.agentKey',
  prefs:            'meridian.prefs',
  history:          'meridian.history',
  activeTrip:       'meridian.activeTrip',
  currentJourney:   'meridian.currentJourney',
  journeySessions:  'meridian.journeySessions',
  trips:            'meridian.trips',
  routeMemories:    'meridian.routeMemories',
  legacyTrips:      'bro.trips',
} as const;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface StoredCredentials {
  agentId: string;
  agentKey: string;
}

export interface StoredPrefs {
  userName: string;
  autoConfirmLimitUsdc: number; // auto-hire below this; voice-confirm above
  onboarded: boolean;
  homeStation?: string;         // "Derby", "London St Pancras", etc.
  workStation?: string;
}

export interface HistoryTurn {
  role: 'user' | 'meridian';
  text: string;
  ts: number;
}

export interface ActiveTrip {
  intentId: string;
  jobId?: string | null;
  journeyId?: string | null;
  status: 'securing' | 'ticketed' | 'attention';
  title: string;
  fromStation?: string | null;
  toStation?: string | null;
  departureTime?: string | null;
  platform?: string | null;
  operator?: string | null;
  bookingRef?: string | null;
  finalLegSummary?: string | null;
  fiatAmount?: number | null;
  currencySymbol?: string | null;
  currencyCode?: string | null;
  tripContext?: TripContext | null;
  shareToken?: string | null;
  walletPassUrl?: string | null;
  arrivalTime?: string | null;
  updatedAt: string;
}

export interface JourneySession {
  intentId: string;
  jobId?: string | null;
  journeyId?: string | null;
  title: string;
  state: 'planning' | 'securing' | 'payment_pending' | 'ticketed' | 'in_transit' | 'arriving' | 'attention';
  bookingState?: TripContext['watchState'] extends infer T ? T extends { bookingState?: infer B } ? B : never : never;
  fromStation?: string | null;
  toStation?: string | null;
  departureTime?: string | null;
  departureDatetime?: string | null;
  arrivalTime?: string | null;
  platform?: string | null;
  operator?: string | null;
  bookingRef?: string | null;
  finalLegSummary?: string | null;
  fiatAmount?: number | null;
  currencySymbol?: string | null;
  currencyCode?: string | null;
  tripContext?: TripContext | null;
  shareToken?: string | null;
  walletPassUrl?: string | null;
  walletLastOpenedAt?: string | null;
  rerouteOfferTitle?: string | null;
  rerouteOfferBody?: string | null;
  rerouteOfferTranscript?: string | null;
  supportState?: 'none' | 'available' | 'requested';
  lastEventKey?: string | null;
  lastEventAt?: string | null;
  updatedAt: string;
}

export interface TripEntry {
  intentId: string;
  title?: string | null;
  bookingRef: string | null;
  fromStation: string | null;
  toStation: string | null;
  departureTime: string | null;
  platform: string | null;
  operator: string | null;
  amount: string | number;
  currency: string;
  fiatAmount?: number | null;
  currencySymbol?: string | null;
  currencyCode?: string | null;
  tripContext?: TripContext | null;
  shareToken?: string | null;
  savedAt: string;
}

export interface RouteMemory {
  routeKey: string;
  origin: string;
  destination: string;
  count: number;
  lastBookedAt: string;
  lastDepartureTime?: string | null;
  lastTravelDate?: string | null;
  typicalFareGbp?: number | null;
  weekdays: number[];
  minutesOfDay?: number | null;
}

// ── Credentials ───────────────────────────────────────────────────────────────

export async function saveCredentials(creds: StoredCredentials): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(KEYS.agentId,  creds.agentId),
    SecureStore.setItemAsync(KEYS.agentKey, creds.agentKey),
  ]);
}

export async function loadCredentials(): Promise<StoredCredentials | null> {
  const [agentId, agentKey] = await Promise.all([
    SecureStore.getItemAsync(KEYS.agentId),
    SecureStore.getItemAsync(KEYS.agentKey),
  ]);
  if (!agentId || !agentKey) return null;
  return { agentId, agentKey };
}

export async function clearCredentials(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(KEYS.agentId),
    SecureStore.deleteItemAsync(KEYS.agentKey),
  ]);
}

// ── Preferences ───────────────────────────────────────────────────────────────

const DEFAULT_PREFS: StoredPrefs = {
  userName: 'there',
  autoConfirmLimitUsdc: 5,
  onboarded: false,
};

export async function loadPrefs(): Promise<StoredPrefs> {
  try {
    const raw = await AsyncStorage.getItem(KEYS.prefs);
    if (!raw) return DEFAULT_PREFS;
    return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_PREFS;
  }
}

export async function savePrefs(prefs: Partial<StoredPrefs>): Promise<void> {
  const current = await loadPrefs();
  const next: StoredPrefs = {
    ...current,
    ...prefs,
  };

  if ('homeStation' in prefs && !prefs.homeStation) {
    delete next.homeStation;
  }
  if ('workStation' in prefs && !prefs.workStation) {
    delete next.workStation;
  }

  await AsyncStorage.setItem(KEYS.prefs, JSON.stringify(next));
}

export async function clearPrefs(): Promise<void> {
  await AsyncStorage.removeItem(KEYS.prefs);
}

// ── Conversation history ──────────────────────────────────────────────────────

const MAX_HISTORY = 50;
const ACTIVE_TRIP_STALE_MS = 15 * 60 * 1000;
const MAX_JOURNEY_SESSIONS = 30;

function deriveJourneyState(params: {
  bookingState?: JourneySession['bookingState'];
  tripContext?: TripContext | null;
  legacyStatus?: ActiveTrip['status'];
}): JourneySession['state'] {
  if (params.tripContext?.phase === 'arrived') return 'arriving';
  if (params.tripContext?.phase === 'in_transit') return 'in_transit';
  if (params.tripContext?.phase === 'attention' || params.legacyStatus === 'attention') return 'attention';
  switch (params.bookingState) {
    case 'payment_pending':
      return 'payment_pending';
    case 'issued':
      return 'ticketed';
    case 'failed':
    case 'refunded':
      return 'attention';
    case 'payment_confirmed':
    case 'securing':
      return 'securing';
    case 'planned':
    case 'priced':
      return 'planning';
    default:
      return params.legacyStatus === 'ticketed' ? 'ticketed' : 'securing';
  }
}

function journeySessionFromActiveTrip(trip: ActiveTrip): JourneySession {
  const bookingState = trip.tripContext?.watchState?.bookingState;
  return {
    intentId: trip.intentId,
    jobId: trip.jobId ?? null,
    journeyId: trip.journeyId ?? null,
    title: trip.title,
    state: deriveJourneyState({ bookingState, tripContext: trip.tripContext, legacyStatus: trip.status }),
    bookingState,
    fromStation: trip.fromStation ?? null,
    toStation: trip.toStation ?? null,
    departureTime: trip.departureTime ?? null,
    arrivalTime: trip.arrivalTime ?? null,
    platform: trip.platform ?? null,
    operator: trip.operator ?? null,
    bookingRef: trip.bookingRef ?? null,
    finalLegSummary: trip.finalLegSummary ?? null,
    fiatAmount: trip.fiatAmount ?? null,
    currencySymbol: trip.currencySymbol ?? null,
    currencyCode: trip.currencyCode ?? null,
    tripContext: trip.tripContext ?? null,
    shareToken: trip.shareToken ?? null,
    walletPassUrl: trip.walletPassUrl ?? null,
    walletLastOpenedAt: null,
    rerouteOfferTitle: null,
    rerouteOfferBody: null,
    rerouteOfferTranscript: null,
    updatedAt: trip.updatedAt,
  };
}

function activeTripFromJourneySession(session: JourneySession): ActiveTrip {
  return {
    intentId: session.intentId,
    jobId: session.jobId ?? null,
    journeyId: session.journeyId ?? null,
    status: session.state === 'attention' ? 'attention' : session.state === 'ticketed' || session.state === 'in_transit' || session.state === 'arriving' ? 'ticketed' : 'securing',
    title: session.title,
    fromStation: session.fromStation ?? null,
    toStation: session.toStation ?? null,
    departureTime: session.departureTime ?? null,
    arrivalTime: session.arrivalTime ?? null,
    platform: session.platform ?? null,
    operator: session.operator ?? null,
    bookingRef: session.bookingRef ?? null,
    finalLegSummary: session.finalLegSummary ?? null,
    fiatAmount: session.fiatAmount ?? null,
    currencySymbol: session.currencySymbol ?? null,
    currencyCode: session.currencyCode ?? null,
    tripContext: session.tripContext ?? null,
    shareToken: session.shareToken ?? null,
    walletPassUrl: session.walletPassUrl ?? null,
    updatedAt: session.updatedAt,
  };
}

function normalizeActiveTrip(trip: ActiveTrip | null): ActiveTrip | null {
  if (!trip?.intentId || !trip?.title || !trip?.updatedAt) return null;
  const updatedAtMs = Date.parse(trip.updatedAt);
  if (Number.isNaN(updatedAtMs)) return null;

  if (trip.status === 'securing' && Date.now() - updatedAtMs > ACTIVE_TRIP_STALE_MS) {
    return {
      ...trip,
      status: 'attention',
    };
  }

  return trip;
}

function normalizeJourneySession(session: JourneySession | null): JourneySession | null {
  if (!session?.intentId || !session?.title || !session?.updatedAt) return null;
  const updatedAtMs = Date.parse(session.updatedAt);
  if (Number.isNaN(updatedAtMs)) return null;
  if ((session.state === 'securing' || session.state === 'planning' || session.state === 'payment_pending') && Date.now() - updatedAtMs > ACTIVE_TRIP_STALE_MS) {
    return {
      ...session,
      state: 'attention',
      bookingState: session.bookingState === 'issued' ? 'issued' : 'failed',
    };
  }
  return session;
}

export async function loadHistory(): Promise<HistoryTurn[]> {
  try {
    const raw = await AsyncStorage.getItem(KEYS.history);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export async function appendHistory(turn: HistoryTurn): Promise<void> {
  const existing = await loadHistory();
  const updated = [...existing, turn].slice(-MAX_HISTORY);
  await AsyncStorage.setItem(KEYS.history, JSON.stringify(updated));
}

export async function clearHistory(): Promise<void> {
  await AsyncStorage.removeItem(KEYS.history);
}

export async function loadActiveTrip(): Promise<ActiveTrip | null> {
  try {
    const currentJourney = await loadCurrentJourneySession();
    if (currentJourney) return activeTripFromJourneySession(currentJourney);
    const raw = await AsyncStorage.getItem(KEYS.activeTrip);
    const parsed = raw ? (JSON.parse(raw) as ActiveTrip) : null;
    const normalized = normalizeActiveTrip(parsed);
    if (raw && !normalized) {
      await AsyncStorage.removeItem(KEYS.activeTrip);
      return null;
    }
    if (normalized && JSON.stringify(normalized) !== raw) {
      await AsyncStorage.setItem(KEYS.activeTrip, JSON.stringify(normalized));
    }
    return normalized;
  } catch {
    return null;
  }
}

export async function saveActiveTrip(trip: ActiveTrip): Promise<void> {
  await saveJourneySession(journeySessionFromActiveTrip(trip));
  const normalized = normalizeActiveTrip(trip);
  if (!normalized) {
    await AsyncStorage.removeItem(KEYS.activeTrip);
    return;
  }
  await AsyncStorage.setItem(KEYS.activeTrip, JSON.stringify(normalized));
}

export async function clearActiveTrip(): Promise<void> {
  await Promise.all([
    AsyncStorage.removeItem(KEYS.activeTrip),
    AsyncStorage.removeItem(KEYS.currentJourney),
  ]);
}

export async function loadJourneySessions(): Promise<JourneySession[]> {
  try {
    const raw = await AsyncStorage.getItem(KEYS.journeySessions);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as JourneySession[];
    return parsed
      .map((item) => normalizeJourneySession(item))
      .filter(Boolean) as JourneySession[];
  } catch {
    return [];
  }
}

async function saveJourneySessions(sessions: JourneySession[]): Promise<void> {
  await AsyncStorage.setItem(KEYS.journeySessions, JSON.stringify(sessions.slice(0, MAX_JOURNEY_SESSIONS)));
}

export async function loadJourneySession(intentId: string): Promise<JourneySession | null> {
  const sessions = await loadJourneySessions();
  return sessions.find((session) => session.intentId === intentId) ?? null;
}

export async function loadCurrentJourneySession(): Promise<JourneySession | null> {
  try {
    const currentIntentId = await AsyncStorage.getItem(KEYS.currentJourney);
    if (!currentIntentId) return null;
    const session = await loadJourneySession(currentIntentId);
    if (session) return session;
    await AsyncStorage.removeItem(KEYS.currentJourney);
    return null;
  } catch {
    return null;
  }
}

export async function saveJourneySession(session: JourneySession): Promise<void> {
  const normalized = normalizeJourneySession(session);
  if (!normalized) return;
  const sessions = await loadJourneySessions();
  const next = [normalized, ...sessions.filter((item) => item.intentId !== normalized.intentId)]
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  await Promise.all([
    saveJourneySessions(next),
    AsyncStorage.setItem(KEYS.currentJourney, normalized.intentId),
  ]);
}

export async function patchJourneySession(intentId: string, patch: Partial<JourneySession>): Promise<JourneySession | null> {
  const existing = await loadJourneySession(intentId);
  if (!existing) return null;
  const merged: JourneySession = {
    ...existing,
    ...patch,
    intentId,
    updatedAt: patch.updatedAt ?? new Date().toISOString(),
  };
  await saveJourneySession(merged);
  return merged;
}

export async function clearJourneySession(intentId: string): Promise<void> {
  const sessions = await loadJourneySessions();
  const next = sessions.filter((item) => item.intentId !== intentId);
  const currentIntentId = await AsyncStorage.getItem(KEYS.currentJourney);
  await saveJourneySessions(next);
  if (currentIntentId === intentId) {
    if (next[0]) {
      await AsyncStorage.setItem(KEYS.currentJourney, next[0].intentId);
    } else {
      await AsyncStorage.removeItem(KEYS.currentJourney);
    }
  }
}

export async function loadTrips(): Promise<TripEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(KEYS.trips);
    if (raw) return JSON.parse(raw) as TripEntry[];
    const legacyRaw = await AsyncStorage.getItem(KEYS.legacyTrips);
    return legacyRaw ? (JSON.parse(legacyRaw) as TripEntry[]) : [];
  } catch {
    return [];
  }
}

export async function upsertTrip(entry: TripEntry): Promise<void> {
  const trips = await loadTrips();
  const filtered = trips.filter((trip) => trip.intentId !== entry.intentId);
  filtered.unshift(entry);
  const serialized = JSON.stringify(filtered.slice(0, 30));
  await AsyncStorage.setItem(KEYS.trips, serialized);
  await AsyncStorage.setItem(KEYS.legacyTrips, serialized);
}

export async function clearTrips(): Promise<void> {
  await Promise.all([
    AsyncStorage.removeItem(KEYS.trips),
    AsyncStorage.removeItem(KEYS.legacyTrips),
  ]);
}

const MAX_ROUTE_MEMORIES = 10;

function routeKey(origin: string, destination: string): string {
  return `${origin.trim().toLowerCase()}__${destination.trim().toLowerCase()}`;
}

function parseDateSafe(value?: string | null): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function extractMinutesOfDay(value?: string | null): number | null {
  if (!value) return null;
  const hhmm = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (hhmm) return Number(hhmm[1]) * 60 + Number(hhmm[2]);
  const parsed = parseDateSafe(value);
  if (!parsed) return null;
  return parsed.getHours() * 60 + parsed.getMinutes();
}

export async function loadRouteMemories(): Promise<RouteMemory[]> {
  try {
    const raw = await AsyncStorage.getItem(KEYS.routeMemories);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as RouteMemory[];
    return parsed
      .filter((item) => item.origin && item.destination && item.routeKey)
      .sort((a, b) => Date.parse(b.lastBookedAt) - Date.parse(a.lastBookedAt));
  } catch {
    return [];
  }
}

async function saveRouteMemories(memories: RouteMemory[]): Promise<void> {
  await AsyncStorage.setItem(KEYS.routeMemories, JSON.stringify(memories.slice(0, MAX_ROUTE_MEMORIES)));
}

export async function recordRouteMemory(params: {
  origin?: string | null;
  destination?: string | null;
  departureTime?: string | null;
  travelDate?: string | null;
  typicalFareGbp?: number | null;
}): Promise<RouteMemory | null> {
  const origin = params.origin?.trim();
  const destination = params.destination?.trim();
  if (!origin || !destination) return null;

  const memories = await loadRouteMemories();
  const key = routeKey(origin, destination);
  const existing = memories.find((item) => item.routeKey === key);
  const travelMoment = parseDateSafe(params.travelDate ?? params.departureTime ?? null);
  const weekday = travelMoment ? travelMoment.getDay() : null;
  const minutesOfDay = extractMinutesOfDay(params.departureTime ?? params.travelDate ?? null);

  const next: RouteMemory = {
    routeKey: key,
    origin,
    destination,
    count: (existing?.count ?? 0) + 1,
    lastBookedAt: new Date().toISOString(),
    lastDepartureTime: params.departureTime ?? existing?.lastDepartureTime ?? null,
    lastTravelDate: params.travelDate ?? existing?.lastTravelDate ?? null,
    typicalFareGbp: params.typicalFareGbp ?? existing?.typicalFareGbp ?? null,
    weekdays: Array.from(new Set([...(existing?.weekdays ?? []), ...(weekday == null ? [] : [weekday])])).slice(-3),
    minutesOfDay: minutesOfDay ?? existing?.minutesOfDay ?? null,
  };

  const merged = [next, ...memories.filter((item) => item.routeKey !== key)]
    .sort((a, b) => Date.parse(b.lastBookedAt) - Date.parse(a.lastBookedAt));
  await saveRouteMemories(merged);
  return next;
}

export function deriveProactiveRouteMemory(memories: RouteMemory[], now = new Date()): RouteMemory | null {
  const upcomingHour = now.getHours();
  const isEveningWindow = upcomingHour >= 18 && upcomingHour <= 23;
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const tomorrowWeekday = tomorrow.getDay();

  const ranked = [...memories].sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return Date.parse(b.lastBookedAt) - Date.parse(a.lastBookedAt);
  });

  return ranked.find((memory) => {
    if (memory.count < 2) return false;
    if (!isEveningWindow) return memory.count >= 3;
    return memory.weekdays.includes(tomorrowWeekday) || memory.count >= 3;
  }) ?? null;
}
