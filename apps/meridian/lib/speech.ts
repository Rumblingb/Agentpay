/**
 * speech.ts - STT via server-side Whisper proxy
 *
 * Audio is recorded locally then POSTed to /api/voice/transcribe on the
 * AgentPay API server, which calls OpenAI Whisper server-side.
 * No OpenAI key needed in the app.
 *
 * Upload strategy: read the file as base64 via expo-file-system and send
 * as JSON. This avoids React Native's broken FormData multipart upload on
 * Android for local file URIs.
 *
 * TTS is handled by lib/tts.ts.
 */

import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';
export { speak, stopSpeaking } from './tts';

const BASE = process.env.EXPO_PUBLIC_API_URL ?? 'https://api.agentpay.so';

async function fetchWithTimeout(input: string, init: RequestInit = {}, timeoutMs = 45_000): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

let recording: Audio.Recording | null = null;
let startCancelled = false;
let silenceTimer: ReturnType<typeof setTimeout> | null = null;
let maxTimer: ReturnType<typeof setTimeout> | null = null;
let silenceCallbackFired = false;

type StartRecordingOptions = {
  autoStopOnSilence?: boolean;
  onSilence?: () => void;
  silenceMs?: number;
  maxDurationMs?: number;
};

function clearRecordingTimers() {
  if (silenceTimer) {
    clearTimeout(silenceTimer);
    silenceTimer = null;
  }
  if (maxTimer) {
    clearTimeout(maxTimer);
    maxTimer = null;
  }
  silenceCallbackFired = false;
}

async function resetRecordingMode(): Promise<void> {
  await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
}

export async function startRecording(options?: StartRecordingOptions): Promise<void> {
  startCancelled = false;
  clearRecordingTimers();

  const { granted } = await Audio.requestPermissionsAsync();
  if (!granted) throw new Error('Microphone permission denied.');
  if (startCancelled) return;

  await Audio.setAudioModeAsync({
    allowsRecordingIOS: true,
    playsInSilentModeIOS: true,
  });

  if (startCancelled) return;

  const created = await Audio.Recording.createAsync({
    android: {
      extension: '.m4a',
      outputFormat: Audio.AndroidOutputFormat.MPEG_4,
      audioEncoder: Audio.AndroidAudioEncoder.AAC,
      sampleRate: 16000,
      numberOfChannels: 1,
      bitRate: 32000,
    },
    ios: {
      extension: '.m4a',
      outputFormat: Audio.IOSOutputFormat.MPEG4AAC,
      audioQuality: Audio.IOSAudioQuality.MEDIUM,
      sampleRate: 16000,
      numberOfChannels: 1,
      bitRate: 32000,
      linearPCMBitDepth: 16,
      linearPCMIsBigEndian: false,
      linearPCMIsFloat: false,
    },
    web: { mimeType: 'audio/webm', bitsPerSecond: 32000 },
    isMeteringEnabled: !!options?.autoStopOnSilence,
  });

  if (startCancelled) {
    try {
      await created.recording.stopAndUnloadAsync();
    } finally {
      await resetRecordingMode().catch(() => {});
    }
    return;
  }

  recording = created.recording;

  if (options?.autoStopOnSilence) {
    const silenceMs = options.silenceMs ?? 1700;
    const maxDurationMs = options.maxDurationMs ?? 12000;
    let heardSpeech = false;
    created.recording.setProgressUpdateInterval(250);
    created.recording.setOnRecordingStatusUpdate((status) => {
      if (!status.isRecording || silenceCallbackFired) return;
      const metering = typeof status.metering === 'number' ? status.metering : null;
      if (metering != null && metering > -38) {
        heardSpeech = true;
        if (silenceTimer) {
          clearTimeout(silenceTimer);
          silenceTimer = null;
        }
        return;
      }

      if (heardSpeech && !silenceTimer) {
        silenceTimer = setTimeout(() => {
          if (silenceCallbackFired) return;
          silenceCallbackFired = true;
          options.onSilence?.();
        }, silenceMs);
      }
    });

    maxTimer = setTimeout(() => {
      if (silenceCallbackFired) return;
      silenceCallbackFired = true;
      options.onSilence?.();
    }, maxDurationMs);
  }
}

export async function stopRecording(): Promise<string | null> {
  startCancelled = true;
  clearRecordingTimers();
  if (!recording) return null;
  const current = recording;
  recording = null;
  let uri: string | null = null;
  let cleanupError: Error | null = null;

  try {
    await current.stopAndUnloadAsync();
    uri = current.getURI();
  } catch (e: any) {
    cleanupError = e instanceof Error ? e : new Error(e?.message ?? 'Recording cleanup failed.');
  }

  try {
    await resetRecordingMode();
  } catch (e: any) {
    if (!cleanupError) {
      cleanupError = e instanceof Error ? e : new Error(e?.message ?? 'Audio session reset failed.');
    }
  }

  if (cleanupError) {
    throw new Error(`Could not finish recording cleanly. ${cleanupError.message}`);
  }

  return uri ?? null;
}

export async function transcribeAudio(uri: string): Promise<string> {
  let info: FileSystem.FileInfo;
  try {
    info = await FileSystem.getInfoAsync(uri);
  } catch (e: any) {
    throw new Error(`Audio file check failed: ${e.message}`);
  }

  if (!info.exists) throw new Error('Audio file missing - try holding longer.');
  if ((info as FileSystem.FileInfo & { size?: number }).size === 0) {
    throw new Error('Audio file empty - try holding longer.');
  }

  let base64Audio: string;
  try {
    base64Audio = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
  } catch (e: any) {
    throw new Error(`Failed to read audio: ${e.message}`);
  }

  let res: Response;
  try {
    res = await fetchWithTimeout(
      `${BASE}/api/voice/transcribe`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audio: base64Audio, mimeType: 'audio/m4a' }),
      },
      45_000,
    );
  } catch (e: any) {
    const msg = (e.message ?? '').toLowerCase();
    if (e.name === 'AbortError' || e.name === 'TimeoutError' || msg.includes('timeout') || msg.includes('abort')) {
      throw new Error('Voice service timed out - try again.');
    }
    throw new Error(`Voice service unreachable: ${e.message}`);
  }

  if (!res.ok) throw new Error(`Transcription failed (${res.status})`);
  const data = (await res.json()) as { transcript?: string; error?: string };
  if (data.error) throw new Error(`Transcription error: ${data.error}`);
  return (data.transcript ?? '').trim();
}
