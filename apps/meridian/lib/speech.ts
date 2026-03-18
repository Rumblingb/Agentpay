/**
 * Speech — STT via OpenAI Whisper + TTS via expo-speech
 *
 * STT flow:
 *   1. Record audio with expo-av (Recording)
 *   2. Send m4a blob to OpenAI Whisper API → transcript
 *
 * TTS flow:
 *   expo-speech.speak() — native on-device, zero latency
 */

import { Audio } from 'expo-av';
import * as Speech from 'expo-speech';
import * as FileSystem from 'expo-file-system';

const WHISPER_URL = 'https://api.openai.com/v1/audio/transcriptions';

// ── Recording ────────────────────────────────────────────────────────────────

let _recording: Audio.Recording | null = null;

export async function startRecording(): Promise<void> {
  await Audio.requestPermissionsAsync();
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

export async function transcribeAudio(
  uri: string,
  openaiKey: string,
): Promise<string> {
  // Read file as base64 and build FormData
  const base64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });

  // Convert base64 to blob via fetch data URI
  const dataUri = `data:audio/m4a;base64,${base64}`;
  const blob = await fetch(dataUri).then(r => r.blob());

  const form = new FormData();
  form.append('file', blob as any, 'audio.m4a');
  form.append('model', 'whisper-1');
  form.append('language', 'en');

  const res = await fetch(WHISPER_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${openaiKey}` },
    body: form,
  });

  if (!res.ok) throw new Error(`Whisper error ${res.status}`);
  const data = await res.json();
  return (data.text as string).trim();
}

// ── TTS ───────────────────────────────────────────────────────────────────────

export function speak(text: string, rate = 1.0): void {
  Speech.speak(text, {
    rate,
    pitch: 1.0,
    language: 'en-US',
  });
}

export function stopSpeaking(): void {
  Speech.stop();
}
