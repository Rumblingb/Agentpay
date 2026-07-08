#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repo = resolve(new URL('../../../..', import.meta.url).pathname);
const outDir = resolve(repo, 'ops/mac-mini/bee/casper/proofs');
mkdirSync(outDir, { recursive: true });

function run(label, command, args, options = {}) {
  const started = new Date().toISOString();
  const result = spawnSync(command, args, {
    cwd: repo,
    encoding: 'utf8',
    env: { ...process.env, ...options.env },
    timeout: options.timeout ?? 120000,
  });
  return {
    label,
    command: [command, ...args].join(' '),
    started,
    status: result.status,
    ok: result.status === 0,
    stdout: (result.stdout || '').trim(),
    stderr: (result.stderr || '').trim(),
  };
}

const receiptId = process.env.BEE_CASPER_RECEIPT_ID || `bee-demo-${Date.now()}`;
const checks = [
  run('Bee test suite', 'node', ['--test', 'ops/mac-mini/bee/bee.test.mjs']),
  run('Bee doctor', 'ops/mac-mini/bin/bee', ['doctor']),
  run('Bee capabilities', 'ops/mac-mini/bin/bee', ['caps']),
  run('AgentPay Feed', 'ops/mac-mini/bin/bee', ['feed']),
  run('Casper receipt dry-run', 'npm', ['--prefix', 'ops/mac-mini/bee/casper', 'run', 'receipt', '--', '--dry-run'], {
    env: { BEE_CASPER_RECEIPT_ID: receiptId },
  }),
];

const proof = {
  generated_at: new Date().toISOString(),
  receipt_id: receiptId,
  network: 'casper-test',
  external_effects: {
    github_push: false,
    dorahacks_submit: false,
    public_video_upload: false,
    casper_broadcast: false,
  },
  qualification_note: 'Dry-run proves the local Casper deploy builder. DoraHacks qualification still needs one funded Casper Testnet broadcast and public demo video URL.',
  checks,
};

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const jsonPath = resolve(outDir, `casper-buildathon-proof-${stamp}.json`);
const mdPath = resolve(outDir, `casper-buildathon-proof-${stamp}.md`);

writeFileSync(jsonPath, JSON.stringify(proof, null, 2));
writeFileSync(mdPath, [
  '# Casper Buildathon Local Proof',
  '',
  `Generated: ${proof.generated_at}`,
  `Receipt id: \`${receiptId}\``,
  '',
  'This is a local, no-broadcast proof bundle for the Bee + Clickey + AgentPay Casper Buildathon submission.',
  '',
  'External effects: no GitHub push, no DoraHacks submit, no public upload, no Casper broadcast.',
  '',
  '## Checks',
  '',
  ...checks.flatMap((c) => [
    `### ${c.label}`,
    '',
    `Command: \`${c.command}\``,
    `Status: ${c.status} (${c.ok ? 'ok' : 'failed'})`,
    '',
    '```text',
    c.stdout || c.stderr || '(no output)',
    '```',
    '',
  ]),
  '## Remaining For DoraHacks Qualification',
  '',
  '- Broadcast one funded Casper Testnet receipt and add the explorer URL.',
  '- Upload or link a public demo video.',
  '- Push final GitHub changes, then update/appeal/submit through DoraHacks only after action-time approval.',
  '',
].join('\n'));

console.log(JSON.stringify({ ok: checks.every((c) => c.ok), json: jsonPath, markdown: mdPath, receipt_id: receiptId }, null, 2));
process.exit(checks.every((c) => c.ok) ? 0 : 1);
