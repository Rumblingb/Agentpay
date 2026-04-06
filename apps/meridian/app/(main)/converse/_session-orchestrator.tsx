/**
 * _session-orchestrator — turn history and active intent management.
 *
 * Manages:
 *   - conversation turn history
 *   - active trip context
 *   - journey session continuity
 *   - route memory
 *
 * Used by: converse/index.tsx
 */

import { useCallback, useRef, useState } from 'react';
import { appendHistory, loadActiveTrip, loadCurrentJourneySession, saveJourneySession, type ActiveTrip } from '../../../lib/storage';
import { shouldPreferJourney } from '../../../lib/journeyRouting';
import { router } from 'expo-router';
import type { ConciergePlanItem } from '../../../lib/concierge';

export type Turn = {
  role: 'user' | 'ace'
  text: string
  ts: number
}

export type SessionState = {
  turns: Turn[]
  activeTrip: ActiveTrip | null
  isLoading: boolean
}

export type SessionControls = {
  state: SessionState
  addUserTurn: (text: string) => void
  addAceTurn: (text: string) => void
  setActiveTrip: (trip: ActiveTrip | null) => void
  resumeJourneyIfLive: () => Promise<boolean>
  reset: () => void
}

/**
 * useSessionOrchestrator — hook that manages conversation turns and live journey
 * continuity for the Ace converse screen.
 */
export function useSessionOrchestrator(): SessionControls {
  const [state, setState] = useState<SessionState>({
    turns: [],
    activeTrip: null,
    isLoading: false,
  });

  const addUserTurn = useCallback((text: string) => {
    const turn: Turn = { role: 'user', text, ts: Date.now() };
    setState((s) => ({ ...s, turns: [...s.turns, turn] }));
    appendHistory({ type: 'user', content: text }).catch(() => null);
  }, []);

  const addAceTurn = useCallback((text: string) => {
    const turn: Turn = { role: 'ace', text, ts: Date.now() };
    setState((s) => ({ ...s, turns: [...s.turns, turn] }));
    appendHistory({ type: 'ace', content: text }).catch(() => null);
  }, []);

  const setActiveTrip = useCallback((trip: ActiveTrip | null) => {
    setState((s) => ({ ...s, activeTrip: trip }));
  }, []);

  const resumeJourneyIfLive = useCallback(async (): Promise<boolean> => {
    try {
      const liveJourney = await loadCurrentJourneySession();
      if (liveJourney && shouldPreferJourney(liveJourney)) {
        router.replace({
          pathname: '/(main)/journey/[intentId]',
          params: { intentId: liveJourney.intentId },
        });
        return true;
      }
      const trip = await loadActiveTrip();
      if (trip) {
        setState((s) => ({ ...s, activeTrip: trip }));
      }
      return false;
    } catch {
      return false;
    }
  }, []);

  const reset = useCallback(() => {
    setState({ turns: [], activeTrip: null, isLoading: false });
  }, []);

  return { state, addUserTurn, addAceTurn, setActiveTrip, resumeJourneyIfLive, reset };
}
