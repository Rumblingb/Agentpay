import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';

const DEFAULT_ACE_VOICE_ID = 'jpzKOF4VdptUa52jEdw5';
export const ELEVENLABS_ACE_VOICE_ID =
  process.env.EXPO_PUBLIC_ELEVENLABS_VOICE_ID ?? DEFAULT_ACE_VOICE_ID;

let activeSound: Audio.Sound | null = null;
let activeUri: string | null = null;

function encodeBase64(bytes: Uint8Array): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let output = '';

  for (let index = 0; index < bytes.length; index += 3) {
    const byte1 = bytes[index] ?? 0;
    const byte2 = bytes[index + 1] ?? 0;
    const byte3 = bytes[index + 2] ?? 0;
    const combined = (byte1 << 16) | (byte2 << 8) | byte3;

    output += alphabet[(combined >> 18) & 63];
    output += alphabet[(combined >> 12) & 63];
    output += index + 1 < bytes.length ? alphabet[(combined >> 6) & 63] : '=';
    output += index + 2 < bytes.length ? alphabet[combined & 63] : '=';
  }

  return output;
}

async function stopActivePlayback(): Promise<void> {
  if (activeSound) {
    try {
      await activeSound.stopAsync();
      await activeSound.unloadAsync();
    } catch {}
    activeSound = null;
  }

  if (activeUri) {
    FileSystem.deleteAsync(activeUri, { idempotent: true }).catch(() => {});
    activeUri = null;
  }
}

export async function speakBro(text: string): Promise<void> {
  const apiKey = process.env.EXPO_PUBLIC_ELEVENLABS_KEY;
  if (!apiKey || !text.trim()) {
    return;
  }

  await stopActivePlayback();

  try {
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_ACE_VOICE_ID}/stream`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'xi-api-key': apiKey,
          Accept: 'audio/mpeg',
        },
        body: JSON.stringify({
          text,
          model_id: 'eleven_multilingual_v2',
          voice_settings: {
            stability: 0.42,
            similarity_boost: 0.78,
            style: 0.08,
            speed: 0.88,
            use_speaker_boost: true,
          },
        }),
      },
    );

    if (!response.ok) {
      return;
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length === 0) {
      return;
    }

    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true,
      staysActiveInBackground: false,
    });

    const uri = `${FileSystem.cacheDirectory}bro_elevenlabs_${Date.now()}.mp3`;
    await FileSystem.writeAsStringAsync(uri, encodeBase64(bytes), {
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
  } catch {
    await stopActivePlayback();
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
