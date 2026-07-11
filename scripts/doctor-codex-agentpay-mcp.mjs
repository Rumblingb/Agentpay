#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const repoRoot = resolve(new URL('..', import.meta.url).pathname);
const configPath = join(homedir(), '.agentpay', 'config.json');
const launcherPath = join(repoRoot, 'scripts', 'agentpay-codex-mcp.mjs');
const serverDistPath = join(repoRoot, 'packages', 'mcp-server', 'dist', 'index.js');
const requiredVideos = [
  'demo-recordings/agentpay-codex-mcp-agentic-clean-16x9.mp4',
  'demo-recordings/agentpay-codex-mcp-agentic-vertical-social.mp4',
  'demo-recordings/agentpay-magic-trick-clean-16x9.mp4',
];
const requiredTools = [
  'agentpay_scan_for_leaked_secrets',
  'agentpay_buy_api',
  'agentpay_execute_with_resume_token',
];
let hasFailure = false;

function parseArgs(argv) {
  return {
    requireLiveConfig: argv.includes('--require-live-config'),
  };
}

function pass(message) {
  process.stdout.write(`PASS ${message}\n`);
}

function warn(message) {
  process.stdout.write(`WARN ${message}\n`);
}

function fail(message) {
  hasFailure = true;
  process.stdout.write(`FAIL ${message}\n`);
}

function readConfig({ requireLiveConfig }) {
  if (!existsSync(configPath)) {
    const message = `Missing ${configPath}. Run: npx agentpay config --api-key apk_your_key_here --api-url https://api.agentpay.so`;
    if (requireLiveConfig) fail(message);
    else warn(message);
    return {};
  }
  try {
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    pass(`${configPath} exists`);
    if (typeof config.apiKey === 'string' && config.apiKey.startsWith('apk_')) pass('AgentPay API key is configured');
    else if (requireLiveConfig) fail('AgentPay API key is missing or does not look like apk_...');
    else warn('AgentPay API key is missing or does not look like apk_...');
    if (typeof config.apiUrl === 'string' && config.apiUrl) pass(`AgentPay API URL is ${config.apiUrl}`);
    else if (requireLiveConfig) fail('AgentPay API URL is missing');
    else warn('AgentPay API URL is missing');
    return config;
  } catch (err) {
    fail(`Could not parse ${configPath}: ${err instanceof Error ? err.message : String(err)}`);
    return {};
  }
}

async function checkMcpTools(config) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [launcherPath],
    cwd: repoRoot,
    stderr: 'pipe',
    env: {
      ...process.env,
      AGENTPAY_API_KEY: process.env.AGENTPAY_API_KEY ?? config.apiKey ?? 'apk_doctor_placeholder',
      AGENTPAY_API_URL: process.env.AGENTPAY_API_URL ?? config.apiUrl ?? 'https://api.agentpay.so',
    },
  });
  const client = new Client({ name: 'agentpay-codex-mcp-doctor', version: '1.0.0' });

  try {
    await client.connect(transport);
    const tools = await client.listTools();
    const names = new Set(tools.tools.map((tool) => tool.name));
    pass(`AgentPay MCP started and exposed ${tools.tools.length} tools`);
    for (const tool of requiredTools) {
      if (names.has(tool)) pass(`MCP tool available: ${tool}`);
      else fail(`MCP tool missing: ${tool}`);
    }
  } finally {
    await transport.close().catch(() => {});
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  process.stdout.write('AgentPay Codex MCP doctor\n\n');
  if (args.requireLiveConfig) {
    process.stdout.write('Live readiness mode: requiring a valid ~/.agentpay/config.json\n\n');
  }

  if (existsSync(launcherPath)) pass(`Codex MCP launcher exists: ${launcherPath}`);
  else fail(`Missing Codex MCP launcher: ${launcherPath}`);

  if (existsSync(serverDistPath)) pass('MCP server dist build exists');
  else warn('MCP server dist build is missing. Run: npm run build --workspace @agentpayxyz/mcp-server');

  for (const video of requiredVideos) {
    if (existsSync(join(repoRoot, video))) pass(`Demo video present: ${video}`);
    else warn(`Demo video missing: ${video}`);
  }

  const config = readConfig(args);
  if (existsSync(launcherPath) && existsSync(serverDistPath)) {
    await checkMcpTools(config);
  }

  if (hasFailure) process.exitCode = 1;
}

main().catch((err) => {
  fail(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exitCode = 1;
});
