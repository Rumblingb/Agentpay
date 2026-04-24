import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import express from 'express';

type TranscribeBody = {
  audio?: string;
  mimeType?: string;
  languageCode?: string;
  sampleRateHertz?: number;
};

type TtsBody = {
  text?: string;
  languageCode?: string;
  voiceName?: string;
};

const PORT = parseInteger(process.env.PORT, 8788);
const BRIDGE_TOKEN = (process.env.NVIDIA_SPEECH_BRIDGE_TOKEN ?? '').trim();
const NVIDIA_ASR_BASE_URL = normalizeBaseUrl(process.env.NVIDIA_ASR_BASE_URL);
const NVIDIA_TTS_BASE_URL = normalizeBaseUrl(process.env.NVIDIA_TTS_BASE_URL);
const NVIDIA_SPEECH_API_KEY = (process.env.NVIDIA_SPEECH_API_KEY ?? '').trim();
const FFMPEG_PATH = (process.env.FFMPEG_PATH ?? 'ffmpeg').trim() || 'ffmpeg';
const DEFAULT_ASR_LANGUAGE = (process.env.NVIDIA_ASR_LANGUAGE_CODE ?? 'en-US').trim();
const DEFAULT_ASR_SAMPLE_RATE_HZ = parseInteger(process.env.NVIDIA_ASR_SAMPLE_RATE_HZ, 16000);
const DEFAULT_TTS_LANGUAGE = (process.env.NVIDIA_TTS_LANGUAGE_CODE ?? 'en-US').trim();
const DEFAULT_TTS_VOICE_NAME = (process.env.NVIDIA_TTS_VOICE_NAME ?? '').trim();

const app = express();
app.use(express.json({ limit: '32mb' }));

app.use((req, res, next) => {
  if (!BRIDGE_TOKEN) {
    return res.status(503).json({ error: 'bridge_token_missing' });
  }
  const authorization = req.header('authorization') ?? '';
  if (authorization === `Bearer ${BRIDGE_TOKEN}`) {
    return next();
  }
  return res.status(401).json({ error: 'unauthorized' });
});

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    asrConfigured: Boolean(NVIDIA_ASR_BASE_URL),
    ttsConfigured: Boolean(NVIDIA_TTS_BASE_URL),
  });
});

app.post('/transcribe', async (req, res) => {
  if (!NVIDIA_ASR_BASE_URL) {
    return res.status(503).json({ error: 'nvidia_asr_not_configured' });
  }

  const body = req.body as TranscribeBody;
  if (!body?.audio) {
    return res.status(400).json({ error: 'missing_audio' });
  }

  try {
    const inputBuffer = Buffer.from(body.audio, 'base64');
    const wavBuffer = await transcodeToWav(inputBuffer, body.mimeType, body.sampleRateHertz);
    const form = new FormData();
    form.append('language', body.languageCode?.trim() || DEFAULT_ASR_LANGUAGE);
    form.append('file', new Blob([new Uint8Array(wavBuffer)], { type: 'audio/wav' }), 'speech.wav');

    const upstream = await fetch(`${NVIDIA_ASR_BASE_URL}/v1/audio/transcriptions`, {
      method: 'POST',
      headers: buildNvidiaHeaders(),
      body: form,
    });

    const text = await upstream.text();
    if (!upstream.ok) {
      return res.status(502).json({
        error: 'nvidia_asr_failed',
        status: upstream.status,
        detail: text.slice(0, 500),
      });
    }

    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(text) as Record<string, unknown>;
    } catch {
      payload = {};
    }

    const transcript = extractTranscript(payload) || text.trim();
    return res.json({ transcript, provider: 'nvidia' });
  } catch (error) {
    return res.status(500).json({
      error: 'nvidia_asr_bridge_failed',
      detail: error instanceof Error ? error.message : String(error),
    });
  }
});

app.post('/tts', async (req, res) => {
  if (!NVIDIA_TTS_BASE_URL) {
    return res.status(503).json({ error: 'nvidia_tts_not_configured' });
  }

  const body = req.body as TtsBody;
  const text = body?.text?.trim();
  if (!text) {
    return res.status(400).json({ error: 'missing_text' });
  }

  try {
    const form = new FormData();
    form.append('language', body.languageCode?.trim() || DEFAULT_TTS_LANGUAGE);
    form.append('text', text);
    const voiceName = body.voiceName?.trim() || DEFAULT_TTS_VOICE_NAME;
    if (voiceName) {
      form.append('voice', voiceName);
    }

    const upstream = await fetch(`${NVIDIA_TTS_BASE_URL}/v1/audio/synthesize`, {
      method: 'POST',
      headers: buildNvidiaHeaders(),
      body: form,
    });

    if (!upstream.ok) {
      const detail = await upstream.text();
      return res.status(502).json({
        error: 'nvidia_tts_failed',
        status: upstream.status,
        detail: detail.slice(0, 500),
      });
    }

    const audioBuffer = Buffer.from(await upstream.arrayBuffer());
    const contentType = upstream.headers.get('content-type') ?? 'audio/wav';
    res.status(200).setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'no-store');
    return res.send(audioBuffer);
  } catch (error) {
    return res.status(500).json({
      error: 'nvidia_tts_bridge_failed',
      detail: error instanceof Error ? error.message : String(error),
    });
  }
});

app.listen(PORT, () => {
  console.log(
    JSON.stringify({
      scope: 'nvidia-speech-bridge',
      event: 'listening',
      port: PORT,
      asrConfigured: Boolean(NVIDIA_ASR_BASE_URL),
      ttsConfigured: Boolean(NVIDIA_TTS_BASE_URL),
      ts: new Date().toISOString(),
    }),
  );
});

function parseInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeBaseUrl(value: string | undefined): string {
  return (value ?? '').trim().replace(/\/+$/, '');
}

function buildNvidiaHeaders(): HeadersInit {
  if (!NVIDIA_SPEECH_API_KEY) {
    return {};
  }
  return {
    Authorization: `Bearer ${NVIDIA_SPEECH_API_KEY}`,
  };
}

function extractTranscript(payload: Record<string, unknown>): string {
  const direct = payload.text;
  if (typeof direct === 'string' && direct.trim()) {
    return direct.trim();
  }
  const transcript = payload.transcript;
  if (typeof transcript === 'string' && transcript.trim()) {
    return transcript.trim();
  }
  const segments = payload.segments;
  if (Array.isArray(segments)) {
    const combined = segments
      .map((segment) => {
        if (segment && typeof segment === 'object' && typeof (segment as Record<string, unknown>).text === 'string') {
          return ((segment as Record<string, unknown>).text as string).trim();
        }
        return '';
      })
      .filter(Boolean)
      .join(' ')
      .trim();
    if (combined) {
      return combined;
    }
  }
  return '';
}

async function transcodeToWav(inputBuffer: Buffer, mimeType: string | undefined, sampleRateHertz: number | undefined): Promise<Buffer> {
  const tempDir = path.join(os.tmpdir(), `agentpay-nvidia-speech-${randomUUID()}`);
  await fs.mkdir(tempDir, { recursive: true });

  const inputPath = path.join(tempDir, `input${extensionForMimeType(mimeType)}`);
  const outputPath = path.join(tempDir, 'output.wav');
  await fs.writeFile(inputPath, inputBuffer);

  try {
    const requestedSampleRate = Number.isFinite(sampleRateHertz) && sampleRateHertz ? sampleRateHertz : DEFAULT_ASR_SAMPLE_RATE_HZ;
    await runFfmpeg(FFMPEG_PATH, [
      '-y',
      '-i',
      inputPath,
      '-ac',
      '1',
      '-ar',
      String(requestedSampleRate),
      '-sample_fmt',
      's16',
      outputPath,
    ]);
    return await fs.readFile(outputPath);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

function extensionForMimeType(mimeType: string | undefined): string {
  const normalized = (mimeType ?? '').toLowerCase();
  if (normalized.includes('wav')) return '.wav';
  if (normalized.includes('ogg') || normalized.includes('opus')) return '.ogg';
  if (normalized.includes('flac')) return '.flac';
  if (normalized.includes('mpeg') || normalized.includes('mp3')) return '.mp3';
  if (normalized.includes('webm')) return '.webm';
  if (normalized.includes('aac')) return '.aac';
  return '.m4a';
}

function runFfmpeg(binary: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      if ('code' in error && error.code === 'ENOENT') {
        reject(new Error('ffmpeg_not_available'));
        return;
      }
      reject(error);
    });
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr.trim() || `ffmpeg_exit_${code ?? 'unknown'}`));
    });
  });
}
