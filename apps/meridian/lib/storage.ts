/**
 * storage.ts — persistent credential + preference store
 *
 * Credentials (agentId, agentKey) → expo-secure-store (encrypted)
 * Preferences (userName, autoConfirmLimit) → AsyncStorage
 * Conversation history → AsyncStorage (last 50 turns)
 */

import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ── Keys ──────────────────────────────────────────────────────────────────────

const KEYS = {
  agentId:          'meridian.agentId',
  agentKey:         'meridian.agentKey',
  prefs:            'meridian.prefs',
  history:          'meridian.history',
  activeTrip:       'meridian.activeTrip',
  trips:            'meridian.trips',
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
}

export interface HistoryTurn {
  role: 'user' | 'meridian';
  text: string;
  ts: number;
}

export interface ActiveTrip {
  intentId: string;
  jobId?: string | null;
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
  updatedAt: string;
}

export interface TripEntry {
  intentId: string;
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
  savedAt: string;
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
  await AsyncStorage.setItem(KEYS.prefs, JSON.stringify({ ...current, ...prefs }));
}

// ── Conversation history ──────────────────────────────────────────────────────

const MAX_HISTORY = 50;

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
    const raw = await AsyncStorage.getItem(KEYS.activeTrip);
    return raw ? (JSON.parse(raw) as ActiveTrip) : null;
  } catch {
    return null;
  }
}

export async function saveActiveTrip(trip: ActiveTrip): Promise<void> {
  await AsyncStorage.setItem(KEYS.activeTrip, JSON.stringify(trip));
}

export async function clearActiveTrip(): Promise<void> {
  await AsyncStorage.removeItem(KEYS.activeTrip);
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
