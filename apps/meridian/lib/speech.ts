/**
 * speech.ts — STT via server-side Whisper proxy
 *
 * Audio is recorded locally then POSTed to /api/voice/transcribe on the
 * AgentPay API server, which calls OpenAI Whisper server-side.
 * No OpenAI key needed in the app.
 *
 * TTS is handled by lib/tts.ts.
 * Re-exported from here for convenience.
 */

import { Audio } from 'expo-av';
export { speak, stopSpeaking } from './tts';

const BASE = process.env.EXPO_PUBLIC_API_URL ?? 'https://api.agentpay.so';

// ── Recording ─────────────────────────────────────────────────────────────────

let _recording: Audio.Recording | null = null;
// Cancellation flag — set to true by stopRecording() to abort an in-flight startRecording()
let _startCancelled = false;

export async function startRecording(): Promise<void> {
  _startCancelled = false;

  const { granted } = await Audio.requestPermissionsAsync();
  if (!granted) throw new Error('Microphone permission denied.');

  // If cancelled while awaiting permission (user released < 600ms), bail out
  if (_startCancelled) return;

  await Audio.setAudioModeAsync({
    allowsRecordingIOS: true,
    playsInSilentModeIOS: true,
  });

  if (_startCancelled) return;

  const { recording } = await Audio.Recording.createAsync(
    Audio.RecordingOptionsPresets.HIGH_QUALITY,
  );

  if (_startCancelled) {
    // User released before recording was ready — discard immediately
    recording.stopAndUnloadAsync().catch(() => {});
    return;
  }

  _recording = recording;
}

export async function stopRecording(): Promise<string | null> {
  _startCancelled = true; // Cancel any in-flight startRecording()
  if (!_recording) return null;
  const rec = _recording;
  _recording = null;
  await rec.stopAndUnloadAsync();
  const uri = rec.getURI();
  await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
  return uri ?? null;
}

// ── Transcription ─────────────────────────────────────────────────────────────

export async function transcribeAudio(uri: string): Promise<string> {
  // React Native FormData accepts { uri, type, name } directly.
  // Never use fetch(dataUri).then(r => r.blob()) — data URI fetch is broken on Android.
  const form = new FormData();
  form.append('audio', { uri, type: 'audio/m4a', name: 'audio.m4a' } as any);

  const res = await fetch(`${BASE}/api/voice/transcribe`, {
    method: 'POST',
    body: form,
  });

  if (!res.ok) throw new Error(`Transcription failed (${res.status})`);
  const data = await res.json();
  return (data.transcript as string).trim();
}
