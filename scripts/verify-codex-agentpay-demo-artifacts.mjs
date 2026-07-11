#!/usr/bin/env node
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const repoRoot = resolve(new URL('..', import.meta.url).pathname);

const requiredFiles = [
  'demo-recordings/agentpay-codex-mcp-agentic-clean-16x9.mp4',
  'demo-recordings/agentpay-codex-mcp-agentic-vertical-social.mp4',
  'demo-recordings/agentpay-magic-trick-clean-16x9.mp4',
  'apps/docs/public/demo/agentpay-codex-mcp-agentic-clean-16x9.mp4',
  'apps/docs/public/demo/agentpay-codex-mcp-agentic-vertical-social.mp4',
  'apps/docs/public/demo/agentpay-magic-trick-clean-16x9.mp4',
  'apps/docs/public/demo/agentpay-codex-mcp-agentic-poster.png',
  'demo-recordings/latest-codex-agentpay-mcp-demo.md',
  'demo-recordings/latest-codex-agentpay-mcp-demo.json',
];

const forbiddenPatterns = [
  {
    label: 'Stripe/OpenAI-style raw secret',
    pattern: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b|\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{24,}\b/,
  },
  {
    label: 'mock lease secret',
    pattern: /lease_demo_secret_token_redacted_by_demo/,
  },
];

function pass(message) {
  process.stdout.write(`PASS ${message}\n`);
}

function fail(message) {
  process.stdout.write(`FAIL ${message}\n`);
  process.exitCode = 1;
}

function assertFile(relPath) {
  const absPath = join(repoRoot, relPath);
  if (!existsSync(absPath)) {
    fail(`Missing ${relPath}`);
    return null;
  }

  const size = statSync(absPath).size;
  if (size <= 0) {
    fail(`${relPath} is empty`);
    return null;
  }

  pass(`${relPath} exists (${Math.round(size / 1024)} KiB)`);
  return absPath;
}

function verifyTranscriptJson(absPath) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(absPath, 'utf8'));
  } catch (err) {
    fail(`Transcript JSON is invalid: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  if (Array.isArray(parsed.steps) && parsed.steps.length >= 10) pass(`Transcript JSON has ${parsed.steps.length} steps`);
  else fail('Transcript JSON has too few steps');

  if (Array.isArray(parsed.outcome) && parsed.outcome.length === 4) pass('Transcript JSON has 4 outcome bullets');
  else fail('Transcript JSON outcome is missing or incomplete');

  const text = JSON.stringify(parsed);
  if (text.includes('rk_liv...ijkl')) pass('Transcript JSON contains redacted Stripe finding');
  else fail('Transcript JSON is missing expected redacted Stripe finding rk_liv...ijkl');

  if (text.includes('"rawSecretsReturned":false') || text.includes('"rawSecretsReturned": false')) {
    pass('Transcript JSON confirms rawSecretsReturned=false');
  } else {
    fail('Transcript JSON does not confirm rawSecretsReturned=false');
  }
}

function verifyNoForbiddenSecrets(relPath) {
  const absPath = join(repoRoot, relPath);
  if (!existsSync(absPath)) return;

  const text = readFileSync(absPath, 'utf8');
  for (const { label, pattern } of forbiddenPatterns) {
    if (pattern.test(text)) fail(`${relPath} contains ${label}`);
    else pass(`${relPath} does not contain ${label}`);
  }
}

process.stdout.write('AgentPay Codex MCP demo artifact verifier\n\n');

for (const relPath of requiredFiles) {
  assertFile(relPath);
}

const transcriptJsonPath = join(repoRoot, 'demo-recordings/latest-codex-agentpay-mcp-demo.json');
if (existsSync(transcriptJsonPath)) verifyTranscriptJson(transcriptJsonPath);

verifyNoForbiddenSecrets('demo-recordings/latest-codex-agentpay-mcp-demo.json');
verifyNoForbiddenSecrets('demo-recordings/latest-codex-agentpay-mcp-demo.md');

if (process.exitCode) {
  process.stderr.write('\nDemo artifact verification failed.\n');
} else {
  process.stdout.write('\nDemo artifact verification passed.\n');
}
