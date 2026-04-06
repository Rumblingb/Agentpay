/**
 * _voice-runtime — mic state machine for the Ace converse screen.
 *
 * Manages: idle → listening → transcribing → thinking → speaking → idle
 *
 * Used by: converse/index.tsx
 */

import React, { useCallback, useRef, useState } from 'react';
import { startRecording, stopRecording, transcribeAudio } from '../../../lib/speech';
import { speakBro, cancelSpeech } from '../../../lib/tts';

export type VoicePhase =
  | 'idle'
  | 'listening'
  | 'transcribing'
  | 'thinking'
  | 'speaking'
  | 'error'

export type VoiceRuntimeState = {
  phase: VoicePhase
  transcript: string | null
  error: string | null
}

export type VoiceRuntimeCallbacks = {
  onTranscript: (text: string) => void
  onError: (message: string) => void
}

export type VoiceRuntimeControls = {
  state: VoiceRuntimeState
  startListening: () => Promise<void>
  stopListening: () => Promise<string | null>
  speakNarration: (text: string) => Promise<void>
  cancelNarration: () => void
  reset: () => void
}

/**
 * useVoiceRuntime — hook that owns the mic recording lifecycle.
 *
 * Callers drive the state machine by calling startListening() / stopListening()
 * and then pass the transcript to the session orchestrator.
 */
export function useVoiceRuntime(callbacks: VoiceRuntimeCallbacks): VoiceRuntimeControls {
  const [state, setState] = useState<VoiceRuntimeState>({
    phase: 'idle',
    transcript: null,
    error: null,
  });

  const recordingRef = useRef<ReturnType<typeof startRecording> | null>(null);

  const startListening = useCallback(async () => {
    try {
      setState({ phase: 'listening', transcript: null, error: null });
      recordingRef.current = startRecording() as unknown as ReturnType<typeof startRecording>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not start recording';
      setState({ phase: 'error', transcript: null, error: message });
      callbacks.onError(message);
    }
  }, [callbacks]);

  const stopListening = useCallback(async (): Promise<string | null> => {
    try {
      setState((s) => ({ ...s, phase: 'transcribing' }));
      const uri = await stopRecording();
      if (!uri) {
        setState({ phase: 'idle', transcript: null, error: null });
        return null;
      }
      const text = await transcribeAudio(uri);
      if (!text?.trim()) {
        setState({ phase: 'idle', transcript: null, error: null });
        return null;
      }
      setState({ phase: 'thinking', transcript: text, error: null });
      callbacks.onTranscript(text);
      return text;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Transcription failed';
      setState({ phase: 'error', transcript: null, error: message });
      callbacks.onError(message);
      return null;
    }
  }, [callbacks]);

  const speakNarration = useCallback(async (text: string) => {
    setState((s) => ({ ...s, phase: 'speaking' }));
    await speakBro(text).catch(() => null);
    setState((s) => ({ ...s, phase: 'idle' }));
  }, []);

  const cancelNarration = useCallback(() => {
    cancelSpeech();
    setState((s) => ({ ...s, phase: 'idle' }));
  }, []);

  const reset = useCallback(() => {
    cancelSpeech();
    setState({ phase: 'idle', transcript: null, error: null });
  }, []);

  return { state, startListening, stopListening, speakNarration, cancelNarration, reset };
}
