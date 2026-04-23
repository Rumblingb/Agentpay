/**
 * Zustand store - global app state
 *
 * Credentials + prefs are persisted via lib/storage.ts (SecureStore / AsyncStorage).
 * The store is the in-memory runtime view; storage is the durable layer.
 */

import { create } from 'zustand';
import type { Agent, HireResult, WalletInfo, PaymentMethod } from './api';
import type { HistoryTurn } from './storage';

export type AppPhase =
  | 'idle'
  | 'listening'
  | 'thinking'
  | 'confirming'
  | 'hiring'
  | 'executing'
  | 'done'
  | 'error';

interface MeridianState {
  // Auth
  agentId: string | null;
  agentKey: string | null;

  // User prefs
  userName: string;
  autoConfirmLimitUsdc: number;
  onboarded: boolean;
  currencySymbol: string;
  currencyCode: string;
  homeStation: string | null;
  workStation: string | null;

  // Current session
  phase: AppPhase;
  transcript: string;
  currentAgent: Agent | null;
  currentJob: (HireResult & { jobId: string }) | null;
  error: string | null;

  // Conversation history
  turns: HistoryTurn[];

  // Wallet
  wallet: WalletInfo | null;

  // Saved payment methods (Stripe cards)
  paymentMethods: PaymentMethod[];

  // Actions
  hydrate: (params: {
    agentId: string;
    agentKey: string;
    userName: string;
    autoConfirmLimitUsdc: number;
    onboarded: boolean;
    turns: HistoryTurn[];
    homeStation?: string | null;
    workStation?: string | null;
  }) => void;

  setCredentials: (agentId: string, agentKey: string) => void;
  setPrefs: (prefs: {
    userName?: string;
    autoConfirmLimitUsdc?: number;
    onboarded?: boolean;
    homeStation?: string | null;
    workStation?: string | null;
  }) => void;
  setCurrency: (symbol: string, code: string) => void;
  setPhase: (phase: AppPhase) => void;
  setTranscript: (text: string) => void;
  setCurrentAgent: (agent: Agent | null) => void;
  setCurrentJob: (job: (HireResult & { jobId: string }) | null) => void;
  setWallet: (wallet: WalletInfo) => void;
  setPaymentMethods: (methods: PaymentMethod[]) => void;
  setError: (error: string | null) => void;
  addTurn: (turn: HistoryTurn) => void;
  clearTurns: () => void;
  reset: () => void;
}

const SESSION_INITIAL = {
  phase: 'idle' as AppPhase,
  transcript: '',
  currentAgent: null,
  currentJob: null,
  error: null,
  turns: [] as HistoryTurn[],
};

export const useStore = create<MeridianState>((set) => ({
  // Auth
  agentId: null,
  agentKey: null,

  // Prefs
  userName: 'there',
  autoConfirmLimitUsdc: 5,
  onboarded: false,
  currencySymbol: '\u00A3',
  currencyCode: 'GBP',
  homeStation: null,
  workStation: null,

  // Session
  ...SESSION_INITIAL,

  // History + wallet
  turns: [],
  wallet: null,
  paymentMethods: [],

  hydrate: ({ agentId, agentKey, userName, autoConfirmLimitUsdc, onboarded, turns, homeStation, workStation }) =>
    set({
      agentId,
      agentKey,
      userName,
      autoConfirmLimitUsdc,
      onboarded,
      turns,
      homeStation: homeStation ?? null,
      workStation: workStation ?? null,
    }),

  setCurrency: (currencySymbol, currencyCode) => set({ currencySymbol, currencyCode }),

  setCredentials: (agentId, agentKey) => set({ agentId, agentKey }),

  setPrefs: (prefs) =>
    set((s) => ({
      userName: prefs.userName ?? s.userName,
      autoConfirmLimitUsdc: prefs.autoConfirmLimitUsdc ?? s.autoConfirmLimitUsdc,
      onboarded: prefs.onboarded ?? s.onboarded,
      homeStation: 'homeStation' in prefs ? (prefs.homeStation ?? null) : s.homeStation,
      workStation: 'workStation' in prefs ? (prefs.workStation ?? null) : s.workStation,
    })),

  setPhase: (phase) => set({ phase }),

  setTranscript: (transcript) => set({ transcript }),

  setCurrentAgent: (currentAgent) => set({ currentAgent }),

  setCurrentJob: (currentJob) => set({ currentJob }),

  setWallet: (wallet) => set({ wallet }),

  setPaymentMethods: (paymentMethods) => set({ paymentMethods }),

  setError: (error) => set({ error, phase: error ? 'error' : 'idle' }),

  addTurn: (turn) => set((s) => ({ turns: [...s.turns, turn].slice(-50) })),

  clearTurns: () => set({ turns: [] }),

  reset: () => set({ ...SESSION_INITIAL, wallet: null, paymentMethods: [] }),
}));
