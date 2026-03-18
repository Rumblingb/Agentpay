/**
 * Zustand store — global app state
 *
 * Credentials + prefs are persisted via lib/storage.ts (SecureStore / AsyncStorage).
 * The store is the in-memory runtime view; storage is the durable layer.
 */

import { create } from 'zustand';
import type { Agent, CoordinationPlan, HireResult, WalletInfo } from './api';
import type { ConciergeNeedsConfirm, TieredOptions } from './concierge';
import type { HistoryTurn } from './storage';

export type AppPhase =
  | 'idle'          // waiting for voice input
  | 'listening'     // recording
  | 'thinking'      // STT done, concierge running
  | 'choosing'      // tiered options presented — waiting for budget/middle/premium voice
  | 'confirming'    // single agent above auto-confirm limit — waiting for voice yes/no
  | 'hiring'        // hire in flight
  | 'executing'     // job in progress, polling status
  | 'done'          // job complete
  | 'error';

interface MeridianState {
  // ── Auth (loaded from SecureStore at boot) ───────────────────────────────
  agentId: string | null;
  agentKey: string | null;
  openaiKey: string | null;

  // ── User prefs (loaded from AsyncStorage at boot) ────────────────────────
  userName: string;
  autoConfirmLimitUsdc: number;
  onboarded: boolean;

  // ── Current session ───────────────────────────────────────────────────────
  phase: AppPhase;
  transcript: string;
  coordinationId: string | null;
  pendingChoice: TieredOptions | null;          // set when 3 tiered options presented
  pendingConfirm: ConciergeNeedsConfirm | null; // set when single agent needs confirm
  currentAgent: Agent | null;
  currentJob: (HireResult & { jobId: string }) | null;
  error: string | null;

  // ── Conversation history (persisted to AsyncStorage) ──────────────────────
  turns: HistoryTurn[];

  // ── Wallet ────────────────────────────────────────────────────────────────
  wallet: WalletInfo | null;

  // ── Actions ───────────────────────────────────────────────────────────────
  hydrate: (params: {
    agentId: string;
    agentKey: string;
    openaiKey: string;
    userName: string;
    autoConfirmLimitUsdc: number;
    onboarded: boolean;
    turns: HistoryTurn[];
  }) => void;

  setCredentials: (agentId: string, agentKey: string, openaiKey: string) => void;
  setPrefs: (prefs: { userName?: string; autoConfirmLimitUsdc?: number; onboarded?: boolean }) => void;
  setPhase: (phase: AppPhase) => void;
  setTranscript: (text: string) => void;
  setPendingChoice: (choice: TieredOptions | null) => void;
  setPendingConfirm: (confirm: ConciergeNeedsConfirm | null) => void;
  setCurrentAgent: (agent: Agent | null) => void;
  setCurrentJob: (job: (HireResult & { jobId: string }) | null) => void;
  setWallet: (wallet: WalletInfo) => void;
  setError: (error: string | null) => void;
  addTurn: (turn: HistoryTurn) => void;
  reset: () => void;
}

const SESSION_INITIAL = {
  phase: 'idle' as AppPhase,
  transcript: '',
  coordinationId: null,
  pendingChoice: null,
  pendingConfirm: null,
  currentAgent: null,
  currentJob: null,
  error: null,
};

export const useStore = create<MeridianState>((set) => ({
  // Auth
  agentId: null,
  agentKey: null,
  openaiKey: null,

  // Prefs
  userName: 'there',
  autoConfirmLimitUsdc: 5,
  onboarded: false,

  // Session
  ...SESSION_INITIAL,

  // History + wallet
  turns: [],
  wallet: null,

  hydrate: ({ agentId, agentKey, openaiKey, userName, autoConfirmLimitUsdc, onboarded, turns }) =>
    set({ agentId, agentKey, openaiKey, userName, autoConfirmLimitUsdc, onboarded, turns }),

  setCredentials: (agentId, agentKey, openaiKey) =>
    set({ agentId, agentKey, openaiKey }),

  setPrefs: (prefs) => set((s) => ({
    userName: prefs.userName ?? s.userName,
    autoConfirmLimitUsdc: prefs.autoConfirmLimitUsdc ?? s.autoConfirmLimitUsdc,
    onboarded: prefs.onboarded ?? s.onboarded,
  })),

  setPhase: (phase) => set({ phase }),

  setTranscript: (transcript) => set({ transcript }),

  setPendingChoice: (pendingChoice) => set({ pendingChoice }),

  setPendingConfirm: (pendingConfirm) => set({ pendingConfirm }),

  setCurrentAgent: (currentAgent) => set({ currentAgent }),

  setCurrentJob: (currentJob) => set({ currentJob }),

  setWallet: (wallet) => set({ wallet }),

  setError: (error) => set({ error, phase: error ? 'error' : 'idle' }),

  addTurn: (turn) => set((s) => ({ turns: [...s.turns, turn].slice(-50) })),

  reset: () => set(SESSION_INITIAL),
}));
