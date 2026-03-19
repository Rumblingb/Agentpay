/**
 * Voice proxy routes — /api/voice/*
 *
 * Server-side STT and TTS so the mobile app never needs an OpenAI key.
 * Requires OPENAI_API_KEY Workers secret (`wrangler secret put OPENAI_API_KEY`).
 *
 * POST /api/voice/transcribe  — multipart audio → transcript text
 * POST /api/voice/tts         — text → base64 MP3 audio
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../types';

export const voiceRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

// ── POST /api/voice/transcribe ────────────────────────────────────────────
// Accepts: multipart/form-data with field "audio" (m4a/webm/wav file)
// Returns: { transcript: string }

voiceRouter.post('/transcribe', async (c) => {
  const openaiKey = (c.env as any).OPENAI_API_KEY as string | undefined;
  if (!openaiKey) {
    return c.json({ error: 'Voice service not configured' }, 503);
  }

  let audioFile: File | Blob | null = null;
  try {
    const formData = await c.req.formData();
    audioFile = formData.get('audio') as File | null;
  } catch {
    return c.json({ error: 'Invalid form data' }, 400);
  }

  if (!audioFile) {
    return c.json({ error: 'Missing audio field' }, 400);
  }

  const whisperForm = new FormData();
  whisperForm.append('file', audioFile, 'audio.m4a');
  whisperForm.append('model', 'whisper-1');
  whisperForm.append('language', 'en');

  try {
    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${openaiKey}` },
      body: whisperForm,
    });

    if (!res.ok) {
      return c.json({ error: `Whisper error ${res.status}` }, 502);
    }

    const data = await res.json() as { text: string };
    return c.json({ transcript: (data.text ?? '').trim() });
  } catch (e: any) {
    return c.json({ error: e.message ?? 'Transcription failed' }, 500);
  }
});

// ── POST /api/voice/tts ───────────────────────────────────────────────────
// Accepts: { text: string }
// Returns: { audio: string } — base64 encoded MP3

voiceRouter.post('/tts', async (c) => {
  const openaiKey = (c.env as any).OPENAI_API_KEY as string | undefined;
  if (!openaiKey) {
    // Return 204 — app will fall back to system TTS
    return c.body(null, 204);
  }

  let text: string;
  try {
    const body = await c.req.json<{ text: string }>();
    text = (body.text ?? '').trim();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  if (!text) return c.json({ error: 'Missing text' }, 400);
  // Truncate to avoid runaway TTS costs
  if (text.length > 500) text = text.slice(0, 500);

  try {
    const res = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${openaiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: 'tts-1', voice: 'nova', input: text }),
    });

    if (!res.ok) {
      return c.body(null, 204); // fall back to system TTS
    }

    const arrayBuffer = await res.arrayBuffer();
    const base64 = arrayBufferToBase64(arrayBuffer);
    return c.json({ audio: base64 });
  } catch {
    return c.body(null, 204); // fall back to system TTS
  }
});

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
