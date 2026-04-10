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

// In-memory rate limiter — adequate for a landing page demo
// (Vercel may run multiple instances; bucket doesn't sync, but that's acceptable here)
const ipBucket = new Map<string, { count: number; resetAt: number }>();

function allow(ip: string): boolean {
  const now = Date.now();
  const b = ipBucket.get(ip);
  if (!b || now > b.resetAt) {
    ipBucket.set(ip, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (b.count >= 5) return false;
  b.count++;
  return true;
}

const VOICE_ID = 'JBFqnCBsd6RMkjVDRZzb'; // George
const MODEL = 'eleven_flash_v2_5';

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  if (!allow(ip)) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
  }

  let body: { text?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const text = (body.text ?? '').slice(0, 400).trim();
  if (!text) return NextResponse.json({ error: 'text required' }, { status: 400 });

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
