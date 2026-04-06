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
import { Platform } from 'react-native';
export { speak, stopSpeaking } from './tts';

const BASE = process.env.EXPO_PUBLIC_API_URL ?? 'https://api.agentpay.so';
const BRO_KEY = process.env.EXPO_PUBLIC_BRO_KEY ?? '';

function missingBroKeyMessage(): string {
  return 'Ace needs a quick update before it can handle live trips. Install the latest Ace build and try again.';
}

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
  onMeter?: (level: number) => void;
};

let recordingLevelCallback: ((level: number) => void) | null = null;

function normalizeRecordingMetering(metering: number | null): number {
  if (typeof metering !== 'number' || !Number.isFinite(metering)) return 0;
  // Android AAC reports a compressed dB range (-100 to 0) vs iOS (-160 to 0).
  // iOS range widened to 65 to match the lowered -45 dB speech threshold
  // so the visual meter responds proportionally to actual speech energy.
  const range = Platform.OS === 'android' ? 70 : 65;
  const normalized = Math.max(0, Math.min(1, (metering + range) / range));
  return Math.pow(normalized, 1.35);
}

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

async function prepareAudioSessionForRecording(): Promise<void> {
  // On iOS, explicitly deactivate the current audio session (which may be
  // in .playback from a previous TTS playback) before switching to
  // .playAndRecord. Skipping this step can leave the microphone inactive
  // even though the recording appears to start correctly.
  if (Platform.OS === 'ios') {
    await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
    // Brief yield so the audio session state change propagates before
    // we re-activate with allowsRecordingIOS: true.
    await new Promise<void>((resolve) => setTimeout(resolve, 60));
    return;
  }

  // On Android, the MediaPlayer from TTS playback holds AudioFocus with
  // AUDIOFOCUS_GAIN. If we start recording immediately after playback ends,
  // the mic can be blocked or return silent frames because the audio stack
  // hasn't fully released focus back to the system.
  // Reset the audio mode to release focus before re-acquiring for recording.
  if (Platform.OS === 'android') {
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playThroughEarpieceAndroid: false,
        staysActiveInBackground: false,
      });
    } catch {
      // Non-fatal — proceed with recording attempt
    }
    // Android AudioFocus handoff is async under the hood; 80ms is enough
    // for the system to process the focus change before we claim it again.
    await new Promise<void>((resolve) => setTimeout(resolve, 80));
  }
}

export async function startRecording(options?: StartRecordingOptions): Promise<void> {
  startCancelled = false;
  clearRecordingTimers();
  recordingLevelCallback = options?.onMeter ?? null;
  recordingLevelCallback?.(0);

  const { granted } = await Audio.requestPermissionsAsync();
  if (!granted) throw new Error('Microphone permission denied.');
  if (startCancelled) return;

  await prepareAudioSessionForRecording();
  if (startCancelled) return;

  await Audio.setAudioModeAsync({
    allowsRecordingIOS: true,
    playsInSilentModeIOS: true,
    playThroughEarpieceAndroid: false,
    staysActiveInBackground: false,
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
    isMeteringEnabled: !!options?.autoStopOnSilence || !!options?.onMeter,
  });

  if (startCancelled) {
    try {
      await created.recording.stopAndUnloadAsync();
    } finally {
      recordingLevelCallback?.(0);
      recordingLevelCallback = null;
      await resetRecordingMode().catch(() => {});
    }
    return;
  }

  recording = created.recording;

  if (options?.autoStopOnSilence || options?.onMeter) {
    const silenceMs = options.silenceMs ?? 1700;
    const maxDurationMs = options.maxDurationMs ?? 12000;
    let heardSpeech = false;
    // Use 120ms on Android too — 250ms was causing sluggish silence detection
    // because the metering update could arrive 250ms after speech ended, making
    // the silence window feel 250ms longer than intended.
    created.recording.setProgressUpdateInterval(120);
    created.recording.setOnRecordingStatusUpdate((status) => {
      if (!status.isRecording || silenceCallbackFired) return;
      const metering = typeof status.metering === 'number' ? status.metering : null;
      recordingLevelCallback?.(normalizeRecordingMetering(metering));
      // expo-av on iOS reports average power (dBFS), not peak.
      // Conversational speech at arm's length averages -42 to -50 dBFS,
      // so -38 was too tight and heardSpeech never fired.
      // Android AAC metering uses a compressed range (-100→0) so needs -50.
      const speechThreshold = Platform.OS === 'android' ? -50 : -45;
      if (metering != null && metering > speechThreshold) {
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
    recordingLevelCallback?.(0);
    recordingLevelCallback = null;
    throw new Error(`Could not finish recording cleanly. ${cleanupError.message}`);
  }

  recordingLevelCallback?.(0);
  recordingLevelCallback = null;
  return uri ?? null;
}

export async function transcribeAudio(uri: string): Promise<string> {
  if (!BRO_KEY) {
    throw new Error(missingBroKeyMessage());
  }

  let info: FileSystem.FileInfo;
  try {
    info = await FileSystem.getInfoAsync(uri);
  } catch (e: any) {
    throw new Error(`Audio file check failed: ${e.message}`);
  }

  if (!info.exists) throw new Error('Audio file missing - try speaking again.');
  if ((info as FileSystem.FileInfo & { size?: number }).size === 0) {
    throw new Error('Audio file empty - try speaking again.');
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
        headers: {
          'Content-Type': 'application/json',
          ...(BRO_KEY ? { 'x-bro-key': BRO_KEY } : {}),
        },
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

  if (res.status === 401 || res.status === 403) {
    throw new Error(missingBroKeyMessage());
  }
  if (!res.ok) throw new Error(`Transcription failed (${res.status})`);
  const data = (await res.json()) as { transcript?: string; error?: string };
  if (data.error) throw new Error(`Transcription error: ${data.error}`);
  return (data.transcript ?? '').trim();
}
