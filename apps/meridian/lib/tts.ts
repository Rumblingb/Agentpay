import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';
import { Platform } from 'react-native';
import * as Speech from 'expo-speech';
import { trackClientEvent } from './telemetry';

const BASE = process.env.EXPO_PUBLIC_API_URL ?? 'https://api.agentpay.so';
const BRO_KEY = process.env.EXPO_PUBLIC_BRO_KEY ?? '';

let activeSound: Audio.Sound | null = null;
let activeUri: string | null = null;
let activeSpeechResolver: (() => void) | null = null;
let lastTtsEndedAt = 0;

/** Returns the timestamp of the most recent TTS completion (0 if TTS has never played). */
export function getLastTtsEndedAt(): number {
  return lastTtsEndedAt;
}

// ── Pre-load cache ──────────────────────────────────────────────────────────
// Fetches and stores audio for a specific text before speakBro is called so
// the greeting plays the moment the timer fires rather than waiting for the
// round-trip fetch.
let preloadCache: { textKey: string; uri: string } | null = null;

export async function preloadAudio(text: string): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed || !BRO_KEY) return;
  try {
    const base64 = await requestVoiceAudio(trimmed);
    if (!base64) return;
    // Clean up any previous preload file
    if (preloadCache?.uri) {
      FileSystem.deleteAsync(preloadCache.uri, { idempotent: true }).catch(() => {});
    }
    const uri = `${FileSystem.cacheDirectory}ace_preload_${Date.now()}.mp3`;
    await FileSystem.writeAsStringAsync(uri, base64, {
      encoding: FileSystem.EncodingType.Base64,
    });
    preloadCache = { textKey: trimmed, uri };
  } catch {
    // Non-fatal — speakBro fetches fresh on cache miss
  }
}
const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

interface SpeakBroOptions {
  onStart?: () => void;
  onMeter?: (level: number) => void;
}

type PlaybackAudioSample = {
  channels: Array<{ frames: number[] }>;
};

function normalizeAudioSample(sample: PlaybackAudioSample): number {
  let sum = 0;
  let count = 0;

  for (const channel of sample.channels) {
    for (let index = 0; index < channel.frames.length; index += 4) {
      const frame = channel.frames[index] ?? 0;
      sum += frame * frame;
      count += 1;
    }
  }

  if (!count) return 0;

  const rms = Math.sqrt(sum / count);
  const normalized = Math.max(0, Math.min(1, rms * 4.2));
  return Math.pow(normalized, 0.9);
}

async function fetchWithTimeout(input: string, init: RequestInit = {}, timeoutMs = 2_500): Promise<Response> {
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

  // Record that TTS just ended so speech.ts knows the audio session needs
  // a deactivate/reactivate cycle before the next recording session.
  lastTtsEndedAt = Date.now();

  // On Android, release AudioFocus explicitly after playback so the mic
  // can be claimed without contention on the next recording session.
  if (Platform.OS === 'android') {
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playThroughEarpieceAndroid: false,
        staysActiveInBackground: false,
      });
    } catch {}
  }
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let output = '';

  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index] ?? 0;
    const b = bytes[index + 1] ?? 0;
    const c = bytes[index + 2] ?? 0;
    const chunk = (a << 16) | (b << 8) | c;

    output += BASE64_ALPHABET[(chunk >> 18) & 63];
    output += BASE64_ALPHABET[(chunk >> 12) & 63];
    output += index + 1 < bytes.length ? BASE64_ALPHABET[(chunk >> 6) & 63] : '=';
    output += index + 2 < bytes.length ? BASE64_ALPHABET[chunk & 63] : '=';
  }

  return output;
}

async function requestVoiceAudio(text: string): Promise<string | null> {
  if (!BRO_KEY) {
    return null;
  }

  // ElevenLabs cold-start can take 3–6s. 8s gives enough headroom without
  // making the fallback to system TTS feel too delayed on genuine failures.
  const response = await fetchWithTimeout(`${BASE}/api/voice/tts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(BRO_KEY ? { 'x-bro-key': BRO_KEY } : {}),
    },
    body: JSON.stringify({ text }),
  }, 8_000);

  if (response.status === 204 || response.status === 503 || !response.ok) {
    return null;
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    const data = await response.json().catch(() => null) as { audio?: string } | null;
    const audio = data?.audio?.trim();
    return audio ? audio : null;
  }

  const arrayBuffer = await response.arrayBuffer().catch(() => null);
  return arrayBuffer ? arrayBufferToBase64(arrayBuffer) : null;
}

async function playSystemVoice(text: string, options?: SpeakBroOptions): Promise<void> {
  await Audio.setAudioModeAsync({
    allowsRecordingIOS: false,
    playsInSilentModeIOS: true,
    staysActiveInBackground: false,
  });

  await new Promise<void>((resolve) => {
    let settled = false;
    let pulseUp = false;
    const pulseInterval = options?.onMeter
      ? setInterval(() => {
          pulseUp = !pulseUp;
          options.onMeter?.(pulseUp ? 0.42 : 0.16);
        }, 140)
      : null;

    const finish = () => {
      if (settled) return;
      settled = true;
      if (pulseInterval) clearInterval(pulseInterval);
      options?.onMeter?.(0);
      if (activeSpeechResolver === finish) {
        activeSpeechResolver = null;
      }
      resolve();
    };

    activeSpeechResolver = finish;
    options?.onStart?.();
    // Android system TTS ignores most voice selection — lower pitch to
    // reduce the chance of a high female-sounding default voice.
    Speech.speak(text, {
      language: 'en-GB',
      pitch: Platform.OS === 'android' ? 0.78 : 0.96,
      rate: Platform.OS === 'android' ? 0.90 : 0.94,
      onDone: finish,
      onStopped: finish,
      onError: finish,
    });
  });
}

export async function speakBro(text: string, options?: SpeakBroOptions): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) {
    options?.onMeter?.(0);
    return;
  }

  await stopActivePlayback();
  const startedAt = Date.now();

  try {
    // Serve from preload cache if this exact text was pre-fetched (e.g. greeting)
    let uri: string;
    const cached = preloadCache?.textKey === trimmed ? preloadCache : null;
    if (cached) {
      preloadCache = null;
      uri = cached.uri;
    } else {
      const audioBase64 = await requestVoiceAudio(trimmed);
      if (!audioBase64) {
        // ElevenLabs unavailable — resolve silently. Premium product never
        // speaks with a robotic system voice; the face/mic state still updates.
        options?.onMeter?.(0);
        void trackClientEvent({
          event: 'tts_skipped_unavailable',
          screen: 'voice',
          metadata: { latencyMs: Date.now() - startedAt, textLength: trimmed.length },
        });
        return;
      }
      uri = `${FileSystem.cacheDirectory}ace_voice_${Date.now()}.mp3`;
      await FileSystem.writeAsStringAsync(uri, audioBase64, {
        encoding: FileSystem.EncodingType.Base64,
      });
    }

    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true,
      staysActiveInBackground: false,
      playThroughEarpieceAndroid: false,
    });

    activeUri = uri;

    const { sound } = await Audio.Sound.createAsync(
      { uri },
      {
        shouldPlay: true,
        volume: 1.0,
        androidImplementation: 'MediaPlayer',
      },
    );
    activeSound = sound;
    let playbackStarted = false;
    let meterPulseInterval: ReturnType<typeof setInterval> | null = null;

    try {
      sound.setOnAudioSampleReceived((sample) => {
        options?.onMeter?.(normalizeAudioSample(sample as PlaybackAudioSample));
      });
    } catch {
      // setOnAudioSampleReceived not supported (Android MediaPlayer).
      // Fall back to the same pulse approximation used by playSystemVoice so
      // Ace's face animates on Android during server TTS playback.
      if (options?.onMeter) {
        let pulseUp = false;
        meterPulseInterval = setInterval(() => {
          pulseUp = !pulseUp;
          options.onMeter?.(pulseUp ? 0.38 : 0.14);
        }, 140);
      }
    }

    await new Promise<void>((resolve, reject) => {
      let settled = false;

      const stopMeterPulse = () => {
        if (meterPulseInterval) {
          clearInterval(meterPulseInterval);
          meterPulseInterval = null;
        }
      };

      // Watchdog: audio must start within 1200ms of sound creation.
      // Flash model files are larger than Turbo; 600ms was too tight.
      const watchdog = setTimeout(() => {
        if (!playbackStarted && !settled) {
          settled = true;
          stopMeterPulse();
          try { sound.setOnAudioSampleReceived(null); } catch {}
          options?.onMeter?.(0);
          void stopActivePlayback().finally(() =>
            reject(new Error('TTS playback watchdog: no audio start within 1200ms')),
          );
        }
      }, 1200);

      sound.setOnPlaybackStatusUpdate((status) => {
        if (status.isLoaded && status.isPlaying && !playbackStarted) {
          playbackStarted = true;
          clearTimeout(watchdog);
          options?.onStart?.();
        }
        // Resolve on natural finish OR when unloaded by cancelSpeech() interrupt.
        if ((status.isLoaded && status.didJustFinish) || !status.isLoaded) {
          clearTimeout(watchdog);
          if (!settled) {
            settled = true;
            stopMeterPulse();
            try { sound.setOnAudioSampleReceived(null); } catch {}
            options?.onMeter?.(0);
            void stopActivePlayback().finally(resolve);
          }
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
    options?.onMeter?.(0);
    await stopActivePlayback();
    // Silent fail — no robotic iOS fallback. Premium product stays silent
    // rather than breaking the voice character.
    void trackClientEvent({
      event: 'tts_failed',
      screen: 'voice',
      severity: 'warning',
      message: error?.message ?? 'Server voice playback failed.',
      metadata: { provider: 'server', textLength: trimmed.length },
    });
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
