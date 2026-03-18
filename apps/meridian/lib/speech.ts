/**
 * speech.ts — STT via OpenAI Whisper
 *
 * TTS is handled by lib/tts.ts (OpenAI TTS-1-HD).
 * Re-exported from here for convenience.
 */

import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';
export { speak, stopSpeaking } from './tts';

const WHISPER_URL = 'https://api.openai.com/v1/audio/transcriptions';

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

export async function transcribeAudio(
  uri: string,
  openaiKey: string,
): Promise<string> {
  const base64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });

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
