/**
 * tts.ts — OpenAI TTS-1-HD premium voice
 *
 * Uses OpenAI's tts-1-hd model with the "nova" voice.
 * Audio is streamed to a temp file and played via expo-av.
 *
 * Falls back to expo-speech if OpenAI key is unavailable.
 */

import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';
import * as Speech from 'expo-speech';

const TTS_URL = 'https://api.openai.com/v1/audio/speech';
const VOICE   = 'nova';   // nova = warm, natural female. alloy/echo/fable/onyx/shimmer also available
const MODEL   = 'tts-1-hd';

let _sound: Audio.Sound | null = null;

export async function speak(text: string, openaiKey: string | null): Promise<void> {
  // Stop any current speech
  await stopSpeaking();

  if (!openaiKey) {
    // Fallback to system TTS
    Speech.speak(text, { rate: 1.0, pitch: 1.0, language: 'en-US' });
    return;
  }

  try {
    // Set audio mode for playback
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true,
      staysActiveInBackground: false,
    });

    // Fetch TTS audio from OpenAI
    const res = await fetch(TTS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${openaiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: MODEL, voice: VOICE, input: text }),
    });

    if (!res.ok) {
      // Fallback on API error
      Speech.speak(text, { rate: 1.0, language: 'en-US' });
      return;
    }

    // Save audio to temp file
    const arrayBuffer = await res.arrayBuffer();
    const base64 = arrayBufferToBase64(arrayBuffer);
    const uri = `${FileSystem.cacheDirectory}meridian_tts_${Date.now()}.mp3`;
    await FileSystem.writeAsStringAsync(uri, base64, {
      encoding: FileSystem.EncodingType.Base64,
    });

    // Play
    const { sound } = await Audio.Sound.createAsync(
      { uri },
      { shouldPlay: true, volume: 1.0 },
    );
    _sound = sound;

    // Clean up temp file when done
    sound.setOnPlaybackStatusUpdate((status) => {
      if (status.isLoaded && status.didJustFinish) {
        sound.unloadAsync().catch(() => {});
        FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
        _sound = null;
      }
    });
  } catch {
    // Fallback on any error
    Speech.speak(text, { rate: 1.0, language: 'en-US' });
  }
}

export async function stopSpeaking(): Promise<void> {
  Speech.stop();
  if (_sound) {
    try {
      await _sound.stopAsync();
      await _sound.unloadAsync();
    } catch {}
    _sound = null;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
