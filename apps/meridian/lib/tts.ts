import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';
import * as Speech from 'expo-speech';
import { trackClientEvent } from './telemetry';

const BASE = process.env.EXPO_PUBLIC_API_URL ?? 'https://api.agentpay.so';
const BRO_KEY = process.env.EXPO_PUBLIC_BRO_KEY ?? '';

let activeSound: Audio.Sound | null = null;
let activeUri: string | null = null;
let activeSpeechResolver: (() => void) | null = null;

async function fetchWithTimeout(input: string, init: RequestInit = {}, timeoutMs = 20_000): Promise<Response> {
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

async function stopActivePlayback(): Promise<void> {
  if (activeSound) {
    try {
      await activeSound.stopAsync();
      await activeSound.unloadAsync();
    } catch {}
    activeSound = null;
  }

  if (activeSpeechResolver) {
    const resolve = activeSpeechResolver;
    activeSpeechResolver = null;
    try {
      await Speech.stop();
    } catch {}
    resolve();
  }

  if (activeUri) {
    FileSystem.deleteAsync(activeUri, { idempotent: true }).catch(() => {});
    activeUri = null;
  }
}

async function requestVoiceAudio(text: string): Promise<string | null> {
  const response = await fetchWithTimeout(`${BASE}/api/voice/tts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(BRO_KEY ? { 'x-bro-key': BRO_KEY } : {}),
    },
    body: JSON.stringify({ text }),
  });

  if (response.status === 204 || !response.ok) {
    return null;
  }

  const data = await response.json().catch(() => null) as { audio?: string } | null;
  const audio = data?.audio?.trim();
  return audio ? audio : null;
}

async function playSystemVoice(text: string): Promise<void> {
  await Audio.setAudioModeAsync({
    allowsRecordingIOS: false,
    playsInSilentModeIOS: true,
    staysActiveInBackground: false,
  });

  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      if (activeSpeechResolver === finish) {
        activeSpeechResolver = null;
      }
      resolve();
    };

    activeSpeechResolver = finish;
    Speech.speak(text, {
      language: 'en-GB',
      pitch: 0.96,
      rate: 0.94,
      onDone: finish,
      onStopped: finish,
      onError: finish,
    });
  });
}

export async function speakBro(text: string): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) {
    return;
  }

  await stopActivePlayback();
  const startedAt = Date.now();

  try {
    const audioBase64 = await requestVoiceAudio(trimmed);

    if (!audioBase64) {
      void trackClientEvent({
        event: 'tts_fallback_system',
        screen: 'voice',
        metadata: {
          latencyMs: Date.now() - startedAt,
          textLength: trimmed.length,
        },
      });
      await playSystemVoice(trimmed);
      void trackClientEvent({
        event: 'tts_played',
        screen: 'voice',
        metadata: {
          provider: 'system_fallback',
          latencyMs: Date.now() - startedAt,
          textLength: trimmed.length,
        },
      });
      return;
    }

    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true,
      staysActiveInBackground: false,
    });

    const uri = `${FileSystem.cacheDirectory}ace_voice_${Date.now()}.mp3`;
    await FileSystem.writeAsStringAsync(uri, audioBase64, {
      encoding: FileSystem.EncodingType.Base64,
    });
    activeUri = uri;

    const { sound } = await Audio.Sound.createAsync(
      { uri },
      { shouldPlay: true, volume: 1.0 },
    );
    activeSound = sound;

    await new Promise<void>((resolve) => {
      sound.setOnPlaybackStatusUpdate((status) => {
        // Resolve on natural finish OR when unloaded by cancelSpeech() interrupt.
        if ((status.isLoaded && status.didJustFinish) || !status.isLoaded) {
          void stopActivePlayback().finally(resolve);
        }
      });
    });
    void trackClientEvent({
      event: 'tts_played',
      screen: 'voice',
      metadata: {
        provider: 'server',
        latencyMs: Date.now() - startedAt,
        textLength: trimmed.length,
      },
    });
  } catch (error: any) {
    await stopActivePlayback();
    void trackClientEvent({
      event: 'tts_failed',
      screen: 'voice',
      severity: 'warning',
      message: error?.message ?? 'Server voice playback failed.',
      metadata: {
        provider: 'server',
        textLength: trimmed.length,
      },
    });
    try {
      await playSystemVoice(trimmed);
      void trackClientEvent({
        event: 'tts_played',
        screen: 'voice',
        metadata: {
          provider: 'system_recovery',
          latencyMs: Date.now() - startedAt,
          textLength: trimmed.length,
        },
      });
    } catch {}
  }
}

export function cancelSpeech(): void {
  void stopActivePlayback();
}

export async function speak(text: string): Promise<void> {
  await speakBro(text);
}

export async function stopSpeaking(): Promise<void> {
  cancelSpeech();
}
