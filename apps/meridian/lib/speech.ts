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
import * as FileSystem from 'expo-file-system';
export { speak, stopSpeaking } from './tts';

const BASE = process.env.EXPO_PUBLIC_API_URL ?? 'https://api.agentpay.so';

// ── Recording ─────────────────────────────────────────────────────────────────

let _recording: Audio.Recording | null = null;

export async function startRecording(): Promise<void> {
  const { granted } = await Audio.requestPermissionsAsync();
  if (!granted) throw new Error('Microphone permission denied.');

  await Audio.setAudioModeAsync({
    allowsRecordingIOS: true,
    playsInSilentModeIOS: true,
  });

  const { recording } = await Audio.Recording.createAsync(
    Audio.RecordingOptionsPresets.HIGH_QUALITY,
  );
  _recording = recording;
}

export async function stopRecording(): Promise<string | null> {
  if (!_recording) return null;
  await _recording.stopAndUnloadAsync();
  const uri = _recording.getURI();
  _recording = null;
  await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
  return uri ?? null;
}

// ── Transcription ─────────────────────────────────────────────────────────────

export async function transcribeAudio(uri: string): Promise<string> {
  const base64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });

  // Build a Blob from base64 so we can send as multipart
  const dataUri = `data:audio/m4a;base64,${base64}`;
  const blob = await fetch(dataUri).then(r => r.blob());

  const form = new FormData();
  form.append('audio', blob as any, 'audio.m4a');

  const res = await fetch(`${BASE}/api/voice/transcribe`, {
    method: 'POST',
    body: form,
  });

  if (!res.ok) throw new Error(`Transcription failed (${res.status})`);
  const data = await res.json();
  return (data.transcript as string).trim();
}
