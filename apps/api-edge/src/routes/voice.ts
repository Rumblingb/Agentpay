/**
 * Voice proxy routes - /api/voice/*
 *
 * Server-side STT and TTS so the mobile app never needs a provider key.
 *
 * POST /api/voice/transcribe      -> transcript text
 * POST /api/voice/extract-profile -> extracted profile fields
 * POST /api/voice/tts             -> streamed MP3 audio
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../types';

export const voiceRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

// George (JBFqnCBsd6RMkjVDRZzb) — warm, natural British male, lowest latency in ElevenLabs library.
// Daniel (onwK4e9ZLuTAKqWW03F9) — deeper/more formal, but noticeably slower to first byte.
const DEFAULT_ELEVENLABS_VOICE_ID = 'JBFqnCBsd6RMkjVDRZzb';

function broLog(event: string, data: Record<string, unknown>) {
  console.log(
    JSON.stringify({
      scope: 'voice',
      event,
      ...data,
      ts: new Date().toISOString(),
    }),
  );
}

function requireBroClientKey(c: {
  req: { header: (name: string) => string | undefined };
  env: Env;
  json: (body: unknown, status?: number) => Response;
}): Response | null {
  if (!c.env.BRO_CLIENT_KEY) {
    return null;
  }
  const clientKey = c.req.header('x-bro-key') ?? '';
  if (clientKey === c.env.BRO_CLIENT_KEY) {
    return null;
  }
  return c.json({ error: 'Unauthorized' }, 401);
}

function containsArabicScript(text: string): boolean {
  return /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(text);
}

function shouldFallbackToEnglishWhisper(text: string): boolean {
  const transcript = text.trim();
  if (!transcript) return false;
  if (containsArabicScript(transcript)) return true;
  const latinMatches = transcript.match(/[A-Za-z]/g) ?? [];
  const lettersOnly = transcript.match(/\p{L}/gu) ?? [];
  if (lettersOnly.length >= 6 && latinMatches.length <= 1) return true;
  return false;
}

// CF Whisper (@cf/openai/whisper) hallucinates predictable filler phrases for
// quiet, short, or unclear audio. Detect these and force a fallback to OpenAI
// Whisper which handles edge cases much more reliably.
const CF_WHISPER_HALLUCINATIONS = new Set([
  'thank you for watching.',
  'thank you for watching',
  'thank you.',
  'thank you',
  'thanks for watching.',
  'thanks for watching',
  'you',
  'yeah',
  'hmm',
  'um',
  'uh',
  'okay',
  'ok',
  '.',
  '...',
]);

function isCfWhisperHallucination(text: string): boolean {
  const lower = text.trim().toLowerCase();
  if (!lower) return true;
  if (CF_WHISPER_HALLUCINATIONS.has(lower)) return true;
  // Single word with no travel meaning — likely hallucinated
  if (lower.split(/\s+/).length === 1 && lower.length <= 4) return true;
  return false;
}

voiceRouter.post('/transcribe', async (c) => {
  const unauthorized = requireBroClientKey(c);
  if (unauthorized) return unauthorized;

  const contentType = c.req.header('content-type') ?? '';
  let audioBytes: Uint8Array | null = null;
  let audioBlob: Blob | null = null;

  if (contentType.includes('application/json')) {
    try {
      const body = await c.req.json<{ audio?: string; mimeType?: string }>();
      if (!body.audio) return c.json({ error: 'Missing audio field' }, 400);
      audioBytes = Uint8Array.from(atob(body.audio), (char) => char.charCodeAt(0));
      audioBlob = new Blob([audioBytes], { type: body.mimeType ?? 'audio/m4a' });
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }
  } else {
    try {
      const formData = await c.req.formData();
      const file = formData.get('audio') as File | null;
      if (!file) return c.json({ error: 'Missing audio field' }, 400);
      audioBytes = new Uint8Array(await file.arrayBuffer());
      audioBlob = file;
    } catch {
      return c.json({ error: 'Invalid form data' }, 400);
    }
  }

  if (!audioBytes || !audioBlob) {
    return c.json({ error: 'Missing audio field' }, 400);
  }

  if (c.env.AI) {
    try {
      const result = await (c.env.AI as any).run('@cf/openai/whisper', {
        audio: [...audioBytes],
      });
      const transcript = (result?.text ?? '').trim();
      if (transcript && !shouldFallbackToEnglishWhisper(transcript) && !isCfWhisperHallucination(transcript)) {
        return c.json({ transcript });
      }
      if (transcript) {
        console.warn('[voice/transcribe] cf_whisper_fallback', { transcript });
      }
    } catch (error: any) {
      console.warn('[voice/transcribe] cf_ai_failed', error?.message ?? String(error));
    }
  }

  const openaiKey = c.env.OPENAI_API_KEY;
  if (!openaiKey) return c.json({ error: 'Voice service not configured' }, 503);

  try {
    const whisperForm = new FormData();
    whisperForm.append('file', audioBlob, 'audio.m4a');
    whisperForm.append('model', 'whisper-1');
    whisperForm.append('language', 'en');
    whisperForm.append(
      'prompt',
      'Transcribe spoken English accurately, including British, Indian, and other regional accents. Be forgiving with station names, city names, and travel brands. If the speaker spells out a place or name letter by letter, join it correctly. Prefer the most likely English travel wording and return plain English text only.',
    );

    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${openaiKey}` },
      body: whisperForm,
    });

    if (!res.ok) return c.json({ error: `Whisper error ${res.status}` }, 502);

    const data = (await res.json()) as { text: string };
    return c.json({ transcript: (data.text ?? '').trim() });
  } catch (error: any) {
    return c.json({ error: error?.message ?? 'Transcription failed' }, 500);
  }
});

voiceRouter.post('/extract-profile', async (c) => {
  const unauthorized = requireBroClientKey(c);
  if (unauthorized) return unauthorized;

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
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 256,
        system: `Extract travel profile fields from the user's spoken input.
Return ONLY valid JSON with these optional fields (include only what was clearly stated):
{
  "legalName": "full legal name",
  "email": "email address",
  "phone": "phone number in E.164 format (+44... or +91...)",
  "railcardType": "one of: 16-25 | 26-30 | senior | two-together | family | network | disabled | hm-forces | none",
  "nationality": "uk | india | other"
}
If a field is not mentioned, omit it. Return only JSON, no explanation.`,
        messages: [{ role: 'user', content: transcript }],
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) return c.json({ fields: {} });

    const data = (await res.json()) as { content: Array<{ type: string; text: string }> };
    const text = data.content?.find((block) => block.type === 'text')?.text ?? '{}';

    let fields: Record<string, string> = {};
    try {
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

voiceRouter.post('/tts', async (c) => {
  const unauthorized = requireBroClientKey(c);
  if (unauthorized) return unauthorized;

  let text: string;
  let voiceId: string | undefined;
  try {
    const body = await c.req.json<{ text: string; voiceId?: string }>();
    text = (body.text ?? '').trim();
    voiceId = body.voiceId?.trim() || undefined;
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  if (!text) return c.json({ error: 'Missing text' }, 400);
  if (text.length > 500) text = text.slice(0, 500);

  const elevenLabsKey = c.env.ELEVENLABS_API_KEY;
  if (!elevenLabsKey) {
    return c.json({ error: 'tts_unavailable' }, 503);
  }

  const selectedVoiceId = voiceId ?? DEFAULT_ELEVENLABS_VOICE_ID;
  const startedAt = Date.now();

  try {
    const res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${selectedVoiceId}/stream?output_format=mp3_44100_128`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'xi-api-key': elevenLabsKey,
        },
        body: JSON.stringify({
          text,
          model_id: 'eleven_flash_v2_5',  // fastest ElevenLabs model (~200-400ms TTFB)
          voice_settings: {
            stability: 0.50,          // more natural variation on Flash
            similarity_boost: 0.75,   // strong voice character
            style: 0.00,              // style transfer not effective on Flash — keep at 0
            use_speaker_boost: true,
          },
        }),
        signal: AbortSignal.timeout(20_000),
      },
    );

    const timeToFirstByteMs = Date.now() - startedAt;
    broLog('tts_requested', {
      ok: res.ok,
      status: res.status,
      voiceId: selectedVoiceId,
      textLength: text.length,
      timeToFirstByteMs,
    });

    if (!res.ok || !res.body) {
      return c.json({ error: 'tts_unavailable' }, 503);
    }

    return new Response(res.body, {
      status: 200,
      headers: {
        'Content-Type': res.headers.get('content-type') ?? 'audio/mpeg',
        'Cache-Control': 'no-store',
        'X-Bro-TTFB-Ms': String(timeToFirstByteMs),
      },
    });
  } catch (error) {
    broLog('tts_failed', {
      voiceId: selectedVoiceId,
      textLength: text.length,
      error: error instanceof Error ? error.message : String(error),
    });
    return c.json({ error: 'tts_unavailable' }, 503);
  }
});
