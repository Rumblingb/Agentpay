/**
 * Zustand store — global app state
 */

import { create } from 'zustand';
import type { Agent, CoordinationPlan, HireResult, WalletInfo } from './api';

export type AppPhase =
  | 'idle'        // waiting for voice input
  | 'listening'   // recording
  | 'thinking'    // STT done, calling IntentCoordinator
  | 'confirming'  // showing intent + agent, waiting for user approval
  | 'hiring'      // POST /marketplace/hire in flight
  | 'executing'   // job in progress, polling status
  | 'done'        // job complete
  | 'error';

interface ConversationTurn {
  role: 'user' | 'agent';
  text: string;
  timestamp: number;
}

interface MeridianState {
  // Auth
  agentId: string | null;
  agentKey: string | null;
  openaiKey: string | null;

  // Current session
  phase: AppPhase;
  transcript: string;
  coordinationId: string | null;
  plan: CoordinationPlan | null;
  selectedAgent: Agent | null;
  currentJob: (HireResult & { jobId: string }) | null;
  error: string | null;

  // Conversation history
  turns: ConversationTurn[];

  // Wallet
  wallet: WalletInfo | null;

  // Actions
  setCredentials: (agentId: string, agentKey: string, openaiKey: string) => void;
  setPhase: (phase: AppPhase) => void;
  setTranscript: (text: string) => void;
  setPlan: (coordinationId: string, plan: CoordinationPlan) => void;
  selectAgent: (agent: Agent) => void;
  setCurrentJob: (job: HireResult & { jobId: string }) => void;
  setWallet: (wallet: WalletInfo) => void;
  setError: (error: string | null) => void;
  addTurn: (role: 'user' | 'agent', text: string) => void;
  reset: () => void;
}

const INITIAL: Pick<
  MeridianState,
  'phase' | 'transcript' | 'coordinationId' | 'plan' | 'selectedAgent' | 'currentJob' | 'error' | 'turns'
> = {
  phase: 'idle',
  transcript: '',
  coordinationId: null,
  plan: null,
  selectedAgent: null,
  currentJob: null,
  error: null,
  turns: [],
};

export const useStore = create<MeridianState>((set) => ({
  agentId: null,
  agentKey: null,
  openaiKey: null,
  wallet: null,
  ...INITIAL,

  setCredentials: (agentId, agentKey, openaiKey) =>
    set({ agentId, agentKey, openaiKey }),

  setPhase: (phase) => set({ phase }),

  setTranscript: (transcript) => set({ transcript }),

  setPlan: (coordinationId, plan) => set({ coordinationId, plan }),

  selectAgent: (selectedAgent) => set({ selectedAgent }),

  setCurrentJob: (currentJob) => set({ currentJob }),

  setWallet: (wallet) => set({ wallet }),

  setError: (error) => set({ error, phase: error ? 'error' : 'idle' }),

  addTurn: (role, text) =>
    set((s) => ({
      turns: [...s.turns, { role, text, timestamp: Date.now() }],
    })),

  reset: () => set(INITIAL),
}));
