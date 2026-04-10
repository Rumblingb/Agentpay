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

type VoiceSessionMode = 'batch' | 'live';
type VoiceSessionProvider = 'batch_proxy' | 'livekit' | 'openai_realtime';

type VoiceSessionConnectResponse = {
  mode: 'live';
  provider: 'livekit';
  serverUrl: string;
  roomName: string;
  participantIdentity: string;
  participantToken: string;
  expiresAt: string;
  planningToolsAvailableDuringConversation: true;
  bookingToolsLockedUntilConfirm: true;
};

function getLiveVoiceProvider(env: Env): VoiceSessionProvider | null {
  if (env.LIVE_VOICE_RUNTIME_ENABLED !== 'true') {
    return null;
  }
  if (env.LIVEKIT_URL && env.LIVEKIT_API_KEY && env.LIVEKIT_API_SECRET) {
    return 'livekit';
  }
  if (env.OPENAI_API_KEY && env.OPENAI_REALTIME_MODEL) {
    return 'openai_realtime';
  }
  return null;
}

function base64UrlEncode(input: string | Uint8Array): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function signHs256(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return base64UrlEncode(new Uint8Array(signature));
}

function slugPart(value: string, fallback: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return normalized.slice(0, 32) || fallback;
}

async function createLiveKitParticipantToken(params: {
  apiKey: string;
  apiSecret: string;
  roomName: string;
  participantIdentity: string;
  metadata?: Record<string, unknown>;
  ttlSeconds?: number;
}): Promise<{ token: string; expiresAt: string }> {
  const now = Math.floor(Date.now() / 1000);
  const ttlSeconds = params.ttlSeconds ?? 60 * 60;
  const exp = now + ttlSeconds;
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    iss: params.apiKey,
    sub: params.participantIdentity,
    nbf: now - 10,
    exp,
    video: {
      room: params.roomName,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    },
    metadata: params.metadata ? JSON.stringify(params.metadata) : undefined,
  };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = await signHs256(params.apiSecret, `${encodedHeader}.${encodedPayload}`);
  return {
    token: `${encodedHeader}.${encodedPayload}.${signature}`,
    expiresAt: new Date(exp * 1000).toISOString(),
  };
}

function getVoiceSessionManifest(env: Env): {
  mode: VoiceSessionMode;
  transport: 'http' | 'webrtc';
  provider: VoiceSessionProvider;
  ready: boolean;
  planningToolsAvailableDuringConversation: boolean;
  bookingToolsLockedUntilConfirm: boolean;
  supportsInterruptions: boolean;
  supportsServerVad: boolean;
  premiumVoice: 'elevenlabs' | 'system' | 'none';
  fallback: { stt: 'whisper_proxy'; tts: 'elevenlabs_http' | 'none' };
  diagnostics: string[];
} {
  const liveProvider = getLiveVoiceProvider(env);
  const diagnostics: string[] = [];

  if (env.LIVE_VOICE_RUNTIME_ENABLED !== 'true') {
    diagnostics.push('live_runtime_disabled');
  } else if (!liveProvider) {
    diagnostics.push('live_runtime_not_configured');
  }

  if (!env.LIVEKIT_URL || !env.LIVEKIT_API_KEY || !env.LIVEKIT_API_SECRET) {
    diagnostics.push('livekit_credentials_missing');
  }

  if (!env.OPENAI_REALTIME_MODEL) {
    diagnostics.push('openai_realtime_model_missing');
  }

  if (!env.ELEVENLABS_API_KEY) {
    diagnostics.push('elevenlabs_unavailable');
  }

  return {
    mode: liveProvider ? 'live' : 'batch',
    transport: liveProvider ? 'webrtc' : 'http',
    provider: liveProvider ?? 'batch_proxy',
    ready: !!liveProvider,
    planningToolsAvailableDuringConversation: true,
    bookingToolsLockedUntilConfirm: true,
    supportsInterruptions: !!liveProvider,
    supportsServerVad: !!liveProvider,
    premiumVoice: env.ELEVENLABS_API_KEY ? 'elevenlabs' : 'none',
    fallback: {
      stt: 'whisper_proxy',
      tts: env.ELEVENLABS_API_KEY ? 'elevenlabs_http' : 'none',
    },
    diagnostics,
  };
}

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

voiceRouter.get('/session', async (c) => {
  const unauthorized = requireBroClientKey(c);
  if (unauthorized) return unauthorized;

  return c.json(getVoiceSessionManifest(c.env));
});

voiceRouter.post('/session/connect', async (c) => {
  const unauthorized = requireBroClientKey(c);
  if (unauthorized) return unauthorized;

  if (c.env.LIVE_VOICE_RUNTIME_ENABLED !== 'true') {
    return c.json({ error: 'Live voice runtime is disabled' }, 503);
  }

  const { LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET } = c.env;
  if (!LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
    return c.json({ error: 'Live voice session is not configured' }, 503);
  }

  let body: { hirerId?: string; sessionId?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const hirerId = body.hirerId?.trim();
  if (!hirerId) {
    return c.json({ error: 'hirerId required' }, 400);
  }

  const roomName = `ace-${slugPart(hirerId, 'guest')}-${slugPart(body.sessionId ?? Date.now().toString(36), 'session')}`;
  const participantIdentity = `traveler-${slugPart(hirerId, 'guest')}`;
  const { token, expiresAt } = await createLiveKitParticipantToken({
    apiKey: LIVEKIT_API_KEY,
    apiSecret: LIVEKIT_API_SECRET,
    roomName,
    participantIdentity,
    metadata: {
      hirerId,
      sessionId: body.sessionId ?? null,
      role: 'traveler',
      planningToolsAvailableDuringConversation: true,
      bookingToolsLockedUntilConfirm: true,
    },
  });

  const response: VoiceSessionConnectResponse = {
    mode: 'live',
    provider: 'livekit',
    serverUrl: LIVEKIT_URL,
    roomName,
    participantIdentity,
    participantToken: token,
    expiresAt,
    planningToolsAvailableDuringConversation: true,
    bookingToolsLockedUntilConfirm: true,
  };

  broLog('live_session_token_issued', {
    hirerId: hirerId.slice(0, 12),
    roomName,
    participantIdentity,
    expiresAt,
  });

  return c.json(response);
});

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
