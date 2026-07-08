#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repo = resolve(new URL('../../../..', import.meta.url).pathname);
const casperDir = resolve(repo, 'ops/mac-mini/bee/casper');
const proofDir = resolve(casperDir, 'proofs');
const outDir = resolve(casperDir, 'demo-artifacts');
mkdirSync(outDir, { recursive: true });

function run(command, args, opts = {}) {
  const result = spawnSync(command, args, { cwd: repo, encoding: 'utf8', timeout: opts.timeout ?? 180000, env: process.env });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed\n${result.stdout}\n${result.stderr}`);
  }
  return result.stdout.trim();
}

function xml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function slideSvg(slide) {
  const wrapped = slide.body.flatMap((line) => wrap(line, 54));
  const body = wrapped.map((line, idx) => (
    `<tspan x="120" dy="${idx === 0 ? 0 : 68}">${xml(line)}</tspan>`
  )).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#081018"/>
      <stop offset="55%" stop-color="#111827"/>
      <stop offset="100%" stop-color="#0A1F1D"/>
    </linearGradient>
  </defs>
  <rect width="1920" height="1080" fill="url(#bg)"/>
  <rect x="84" y="82" width="1752" height="820" rx="28" fill="#0E1522" opacity="0.86" stroke="#2F6B5C" stroke-width="2"/>
  <circle cx="1668" cy="188" r="96" fill="#43D39E" opacity="0.18"/>
  <circle cx="1726" cy="248" r="54" fill="#A3E635" opacity="0.16"/>
  <text x="120" y="178" fill="#FFFFFF" font-family="Arial, Helvetica, sans-serif" font-size="78" font-weight="700">${xml(slide.title)}</text>
  <text x="120" y="310" fill="#E7EEF8" font-family="Arial, Helvetica, sans-serif" font-size="38">${body}</text>
  <text x="120" y="978" fill="#9FB0C7" font-family="Arial, Helvetica, sans-serif" font-size="30">Bee + Clickey + AgentPay / Casper Agentic Buildathon</text>
  <text x="120" y="1018" fill="#6EE7B7" font-family="Arial, Helvetica, sans-serif" font-size="24">Local proof video only. No public upload, GitHub push, Casper broadcast, or DoraHacks submit.</text>
</svg>`;
}

function wrap(text, max = 54) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > max && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

run('node', ['ops/mac-mini/bee/casper/demo-proof.mjs']);

const latestProof = readdirSync(proofDir)
  .filter((f) => /^casper-buildathon-proof-.*\.json$/.test(f))
  .sort()
  .at(-1);

if (!latestProof) throw new Error('No proof JSON generated');

const proof = JSON.parse(readFileSync(resolve(proofDir, latestProof), 'utf8'));
const dryRun = proof.checks.find((c) => c.label === 'Casper receipt dry-run')?.stdout || '';
const transferId = dryRun.match(/"transfer_id":\s*([0-9]+)/)?.[1] || 'generated in dry-run';
const receiptId = proof.receipt_id;
const feedLine = (proof.checks.find((c) => c.label === 'AgentPay Feed')?.stdout || '').split('\n').find((line) => /published/.test(line))?.trim() || 'AgentPay Feed reachable';
const capsLine = (proof.checks.find((c) => c.label === 'Bee capabilities')?.stdout || '').split('\n').find((line) => /SKILLS:/.test(line))?.trim() || '6 agents, skills, MCP, tools';

const slides = [
  {
    seconds: 7,
    title: 'Bee + Clickey',
    body: [
      'Founder-in-a-box for agent-run work',
      'Bee routes the fleet. Clickey is the desktop body.',
      'AgentPay supplies approvals, receipts, and rails.',
    ],
  },
  {
    seconds: 8,
    title: 'Capability Radar',
    body: [
      capsLine,
      feedLine,
      'New MCP tools become routable capabilities.',
    ],
  },
  {
    seconds: 8,
    title: 'Casper Receipt Path',
    body: [
      `Receipt id: ${receiptId}`,
      `Casper testnet transfer id: ${transferId}`,
      'Protocol: x402-casper. Chain: casper. Asset: CSPR.',
    ],
  },
  {
    seconds: 8,
    title: 'Safety Wall',
    body: [
      'Bee can prepare high-impact actions.',
      'Founder approval is required for live settlement, uploads, pushes, and submits.',
      'Local proof only: no broadcast, no public upload, no DoraHacks submit.',
    ],
  },
  {
    seconds: 7,
    title: 'Ready For Final Proof',
    body: [
      'Next: funded Casper Testnet deploy URL.',
      'Then upload this demo and send the update or recovery packet.',
      'Casper becomes the proof layer for human-approved agent commerce.',
    ],
  },
];

const font = '/System/Library/Fonts/Supplemental/Arial.ttf';
const segments = [];
for (let i = 0; i < slides.length; i++) {
  const slide = slides[i];
  const svgPath = resolve(outDir, `slide-${i}.svg`);
  const pngPath = resolve(outDir, `slide-${i}.svg.png`);
  const segmentPath = resolve(outDir, `slide-${i}.mp4`);
  writeFileSync(svgPath, slideSvg(slide));
  run('qlmanage', ['-t', '-s', '1920', '-o', outDir, svgPath]);
  run('ffmpeg', [
    '-y',
    '-loop', '1',
    '-i', pngPath,
    '-t', String(slide.seconds),
    '-vf', 'scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080',
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-r', '30',
    segmentPath,
  ]);
  segments.push(segmentPath);
}

const concatPath = resolve(outDir, 'slides.ffconcat');
writeFileSync(concatPath, ['ffconcat version 1.0', ...segments.map((s) => `file '${s.replace(/'/g, "'\\''")}'`)].join('\n'));
const outPath = resolve(outDir, 'bee-clickey-casper-local-demo.mp4');
run('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', concatPath, '-c', 'copy', outPath]);

console.log(JSON.stringify({ ok: true, video: outPath, proof_json: resolve(proofDir, latestProof), receipt_id: receiptId, transfer_id: transferId }, null, 2));
