/**
 * storage.ts — persistent credential + preference store
 *
 * Credentials (agentId, agentKey, openaiKey) → expo-secure-store (encrypted)
 * Preferences (userName, autoConfirmLimit) → AsyncStorage
 * Conversation history → AsyncStorage (last 50 turns)
 */

import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ── Keys ──────────────────────────────────────────────────────────────────────

const KEYS = {
  agentId:          'meridian.agentId',
  agentKey:         'meridian.agentKey',
  openaiKey:        'meridian.openaiKey',
  prefs:            'meridian.prefs',
  history:          'meridian.history',
} as const;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface StoredCredentials {
  agentId: string;
  agentKey: string;
  openaiKey?: string; // no longer required — voice is proxied server-side
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
    SecureStore.deleteItemAsync(KEYS.openaiKey),
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
