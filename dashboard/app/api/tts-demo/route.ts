/**
 * POST /api/tts-demo
 *
 * Public TTS proxy for the /for-billing landing page demo.
 * Uses ElevenLabs (George voice) if ELEVENLABS_API_KEY is set in Vercel env.
 * Returns audio/mpeg; rate-limited to 5 requests/IP/minute.
 *
 * Set ELEVENLABS_API_KEY in Vercel project settings to enable.
 * Without it, the client falls back to browser SpeechSynthesis.
 */

import { NextRequest, NextResponse } from 'next/server';
import { readJsonBody, hasControlCharacters } from '@/lib/requestBody';
import { enforceBurstLimit } from '@/lib/rateLimit';

const VOICE_ID = 'JBFqnCBsd6RMkjVDRZzb'; // George
const MODEL = 'eleven_flash_v2_5';

export async function POST(req: NextRequest) {
  const limited = enforceBurstLimit(req, 'tts-demo', 5);
  if (limited) return limited;
  const parsed = await readJsonBody<{ text?: unknown }>(req);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  const body = parsed.value;

  const text = typeof body.text === 'string' ? body.text.slice(0, 400).trim() : '';
  if (!text || hasControlCharacters(text)) return NextResponse.json({ error: 'text required' }, { status: 400 });

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    // Tell the client to use browser TTS fallback
    return NextResponse.json({ fallback: true }, { status: 503 });
  }

  let res: Response;
  try {
    res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}/stream`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text,
          model_id: MODEL,
          voice_settings: {
            stability: 0.50,
            similarity_boost: 0.75,
            style: 0.00,
            use_speaker_boost: false,
          },
        }),
        signal: AbortSignal.timeout(15_000),
      },
    );
  } catch {
    return NextResponse.json({ fallback: true }, { status: 503 });
  }

  if (!res.ok) {
    return NextResponse.json({ fallback: true }, { status: 503 });
  }

  const audio = await res.arrayBuffer();
  return new Response(audio, {
    headers: {
      'Content-Type': 'audio/mpeg',
      'Cache-Control': 'no-store',
    },
  });
}
