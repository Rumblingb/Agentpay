#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const serverBin = fileURLToPath(new URL('../packages/mcp-server/bin/agentpay-mcp.mjs', import.meta.url));
const configPath = join(homedir(), '.agentpay', 'config.json');

const env = { ...process.env };

if (existsSync(configPath)) {
  try {
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    if (!env.AGENTPAY_API_KEY && typeof config.apiKey === 'string') {
      env.AGENTPAY_API_KEY = config.apiKey;
    }
    if (!env.AGENTPAY_API_URL && typeof config.apiUrl === 'string') {
      env.AGENTPAY_API_URL = config.apiUrl;
    }
    if (!env.AGENTPAY_MERCHANT_ID && typeof config.merchantId === 'string') {
      env.AGENTPAY_MERCHANT_ID = config.merchantId;
    }
  } catch (err) {
    process.stderr.write(`AgentPay Codex MCP config warning: ${err instanceof Error ? err.message : String(err)}\n`);
  }
}

const child = spawn(process.execPath, [serverBin], {
  cwd: repoRoot,
  env,
  stdio: 'inherit',
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});
