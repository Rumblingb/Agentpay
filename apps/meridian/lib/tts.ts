/**
 * tts.ts — server-proxied TTS (OpenAI nova voice)
 *
 * Calls /api/voice/tts on the AgentPay server which calls OpenAI TTS-1.
 * Falls back to expo-speech if the server is unavailable or returns no audio.
 * No OpenAI key needed in the app.
 */

import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';
import * as Speech from 'expo-speech';

const BASE = process.env.EXPO_PUBLIC_API_URL ?? 'https://api.agentpay.so';

let _sound: Audio.Sound | null = null;

export async function speak(text: string): Promise<void> {
  await stopSpeaking();

  try {
    const res = await fetch(`${BASE}/api/voice/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });

    // 204 = server TTS not configured — fall back to system voice
    if (res.status === 204 || !res.ok) {
      Speech.speak(text, { rate: 1.0, language: 'en-US' });
      return;
    }

    const { audio } = await res.json() as { audio: string };
    if (!audio) {
      Speech.speak(text, { rate: 1.0, language: 'en-US' });
      return;
    }

    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true,
      staysActiveInBackground: false,
    });

    const uri = `${FileSystem.cacheDirectory}meridian_tts_${Date.now()}.mp3`;
    await FileSystem.writeAsStringAsync(uri, audio, {
      encoding: FileSystem.EncodingType.Base64,
    });

    const { sound } = await Audio.Sound.createAsync(
      { uri },
      { shouldPlay: true, volume: 1.0 },
    );
    _sound = sound;

    sound.setOnPlaybackStatusUpdate((status) => {
      if (status.isLoaded && status.didJustFinish) {
        sound.unloadAsync().catch(() => {});
        FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
        _sound = null;
      }
    });
  } catch {
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
