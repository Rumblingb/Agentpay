#!/usr/bin/env node

import { writeFileSync } from 'node:fs';

const [, , text, output] = process.argv;
if (!text?.trim() || !output) process.exit(2);

const base = (process.env.BEE_VOICEBOX_URL || 'http://127.0.0.1:17493').replace(/\/$/, '');
const profileName = process.env.BEE_VOICEBOX_PROFILE || 'Bee';
const engine = process.env.BEE_VOICEBOX_ENGINE || 'qwen_custom_voice';
const modelSize = process.env.BEE_VOICEBOX_MODEL_SIZE || '0.6B';
const instruct = process.env.BEE_VOICEBOX_INSTRUCT
  || 'Speak warmly and naturally, with relaxed pacing, subtle emotion, and brief conversational pauses. Avoid an announcer tone.';

async function request(url, options = {}, timeoutMs = 2_500) {
  return fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
}

try {
  const health = await request(`${base}/health`);
  if (!health.ok) throw new Error('Voicebox is unhealthy');

  const profilesResponse = await request(`${base}/profiles`);
  if (!profilesResponse.ok) throw new Error('Voicebox profiles unavailable');
  const profiles = await profilesResponse.json();
  const profile = profiles.find((item) => item.name?.toLowerCase() === profileName.toLowerCase());
  if (!profile) throw new Error(`Voicebox profile not found: ${profileName}`);

  const response = await request(`${base}/generate/stream`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      profile_id: profile.id,
      text,
      language: 'en',
      engine,
      model_size: modelSize,
      instruct,
      normalize: true,
      max_chunk_chars: 500,
      crossfade_ms: 50,
    }),
  }, Number(process.env.BEE_VOICEBOX_TIMEOUT_MS || 45_000));
  if (!response.ok) throw new Error(`Voicebox generation failed: ${response.status}`);

  const audio = Buffer.from(await response.arrayBuffer());
  if (audio.length < 44 || audio.subarray(0, 4).toString('ascii') !== 'RIFF') {
    throw new Error('Voicebox returned invalid WAV audio');
  }
  writeFileSync(output, audio, { mode: 0o600 });
} catch (error) {
  if (process.env.BEE_VOICE_DEBUG === '1') console.error(error.message);
  process.exit(1);
}
