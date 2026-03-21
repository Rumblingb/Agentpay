/**
 * speech.ts — STT via server-side Whisper proxy
 *
 * Audio is recorded locally then POSTed to /api/voice/transcribe on the
 * AgentPay API server, which calls OpenAI Whisper server-side.
 * No OpenAI key needed in the app.
 *
 * Upload strategy: read the file as base64 via expo-file-system and send
 * as JSON. This avoids React Native's broken FormData multipart upload on
 * Android (throws "Network request failed" for local file URIs on many
 * Android versions).
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
  // 1. Verify the file exists and has content before trying to upload.
  let info: FileSystem.FileInfo;
  try {
    info = await FileSystem.getInfoAsync(uri);
  } catch (e: any) {
    throw new Error(`Audio file check failed: ${e.message}`);
  }
  if (!info.exists) throw new Error('Audio file missing — try holding longer.');
  if ((info as any).size === 0) throw new Error('Audio file empty — try holding longer.');

  // 2. Read as base64 — avoids RN FormData multipart bug on Android where
  //    fetch() throws "Network request failed" for local file:// URIs.
  let base64Audio: string;
  try {
    base64Audio = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
  } catch (e: any) {
    throw new Error(`Failed to read audio: ${e.message}`);
  }

  // 3. POST base64 JSON to the server-side Whisper proxy.
  let res: Response;
  try {
    res = await fetch(`${BASE}/api/voice/transcribe`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ audio: base64Audio, mimeType: 'audio/m4a' }),
      signal:  AbortSignal.timeout(30_000),
    });
  } catch (e: any) {
    const msg = (e.message ?? '').toLowerCase();
    if (msg.includes('timeout') || msg.includes('abort')) {
      throw new Error('Voice service timed out — try again.');
    }
    throw new Error(`Network error: ${e.message}`);
  }

  if (!res.ok) throw new Error(`Transcription failed (${res.status})`);
  const data = await res.json() as { transcript?: string; error?: string };
  if (data.error) throw new Error(`Transcription error: ${data.error}`);
  return (data.transcript ?? '').trim();
}
