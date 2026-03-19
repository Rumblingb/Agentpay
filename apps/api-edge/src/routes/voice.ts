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

// ── POST /api/voice/extract-profile ──────────────────────────────────────
// Accepts: { transcript: string }
// Returns: { fields: { legalName?, email?, phone?, railcardNumber?, nationality? } }
//
// Used by onboarding: user speaks their details, Claude extracts the fields.
// Example: "I'm John Smith, my email is john@example.com, phone 07700 900123,
//           I have a 16-25 railcard"

voiceRouter.post('/extract-profile', async (c) => {
  const anthropicKey = c.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    return c.json({ error: 'AI not configured' }, 503);
  }

  let transcript: string;
  try {
    const body = await c.req.json<{ transcript: string }>();
    transcript = (body.transcript ?? '').trim();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  if (!transcript) return c.json({ error: 'Missing transcript' }, 400);

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key':         anthropicKey,
        'anthropic-version': '2023-06-01',
        'content-type':      'application/json',
      },
      body: JSON.stringify({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 256,
        system: `Extract travel profile fields from the user's spoken input.
Return ONLY valid JSON with these optional fields (include only what was clearly stated):
{
  "legalName": "full legal name",
  "email": "email address",
  "phone": "phone number in E.164 format (+44... or +91...)",
  "railcardNumber": "railcard name or number (e.g. 16-25, Senior, Network)",
  "nationality": "uk | india | other"
}
If a field is not mentioned, omit it. Return only JSON, no explanation.`,
        messages: [{ role: 'user', content: transcript }],
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) return c.json({ fields: {} });

    const data = await res.json() as { content: Array<{ type: string; text: string }> };
    const text = data.content?.find(b => b.type === 'text')?.text ?? '{}';

    let fields: Record<string, string> = {};
    try {
      // Strip any markdown code fences Claude might add
      const clean = text.replace(/```json\n?|\n?```/g, '').trim();
      fields = JSON.parse(clean);
    } catch {
      fields = {};
    }

    return c.json({ fields });
  } catch {
    return c.json({ fields: {} });
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
