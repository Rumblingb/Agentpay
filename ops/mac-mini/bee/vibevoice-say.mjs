#!/usr/bin/env node

import { writeFileSync } from 'node:fs';

const [, , text, output] = process.argv;
if (!text?.trim() || !output) process.exit(2);
if (typeof WebSocket === 'undefined') process.exit(1);

const base = (process.env.BEE_VIBEVOICE_URL || 'ws://127.0.0.1:18765/stream').replace(/\/$/, '');
const url = new URL(base);
if (url.protocol === 'http:') url.protocol = 'ws:';
if (url.protocol === 'https:') url.protocol = 'wss:';
url.pathname = url.pathname === '/' ? '/stream' : url.pathname;
url.searchParams.set('text', text);
url.searchParams.set('cfg', process.env.BEE_VIBEVOICE_CFG || '1.3');
url.searchParams.set('steps', process.env.BEE_VIBEVOICE_STEPS || '2');
url.searchParams.set('voice', process.env.BEE_VIBEVOICE_VOICE || 'en-Carter_man');

const timeoutMs = Number(process.env.BEE_VIBEVOICE_TIMEOUT_MS || 30000);
const chunks = [];

function wavHeader(bytes, sampleRate = 24000) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + bytes, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(bytes, 40);
  return header;
}

try {
  await new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => {
      try { ws.close(); } catch {}
      reject(new Error('VibeVoice timed out'));
    }, timeoutMs);

    ws.binaryType = 'arraybuffer';
    ws.addEventListener('message', async (event) => {
      if (typeof event.data === 'string') return;
      const data = Buffer.from(await event.data.arrayBuffer?.() || event.data);
      if (data.length) chunks.push(data);
    });
    ws.addEventListener('close', () => {
      clearTimeout(timer);
      resolve();
    });
    ws.addEventListener('error', (error) => {
      clearTimeout(timer);
      reject(error?.error || error);
    });
  });

  const pcm = Buffer.concat(chunks);
  if (pcm.length < 1024) throw new Error('No VibeVoice audio received');
  writeFileSync(output, Buffer.concat([wavHeader(pcm.length), pcm]), { mode: 0o600 });
} catch (error) {
  if (process.env.BEE_VOICE_DEBUG === '1') console.error(error.message || error);
  process.exit(1);
}
