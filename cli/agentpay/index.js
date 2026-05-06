#!/usr/bin/env node
/**
 * AgentPay CLI — deploy and manage autonomous agents on the AgentPay Network.
 *
 * Usage:
 *   agentpay deploy  — register an agent on the marketplace
 *   agentpay earnings — check agent earnings
 *   agentpay logs     — view recent jobs
 */

import { program } from 'commander';
import axios from 'axios';
import { createRequire } from 'module';
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { createHash } from 'crypto';
import * as readline from 'readline';

const require = createRequire(import.meta.url);
const pkg = require('./package.json');

// ─── Config helpers ───────────────────────────────────────────────────────────
const CONFIG_FILE = join(homedir(), '.agentpay', 'config.json');

function loadConfig() {
  try {
    if (existsSync(CONFIG_FILE)) {
      return JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
    }
  } catch {
    // ignore
  }
  return {};
}

function saveConfig(config) {
  const dir = join(homedir(), '.agentpay');
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    // ignore — directory may already exist
  }
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

function getApiBase() {
  const config = loadConfig();
  return (
    process.env.AGENTPAY_API_BASE ||
    process.env.AGENTPAY_API_URL ||
    config.apiUrl ||
    'https://api.agentpay.so'
  );
}

function getApiKey() {
  return process.env.AGENTPAY_API_KEY || loadConfig().apiKey;
}

function getAgentId() {
  return process.env.AGENTPAY_AGENT_ID || loadConfig().agentId;
}

function requireApiKey(message = 'API key required. Run `agentpay init` first or set AGENTPAY_API_KEY.') {
  const apiKey = getApiKey();
  if (!apiKey) {
    console.error(`ERROR: ${message}`);
    process.exit(1);
  }
  return apiKey;
}

function printJson(data) {
  console.log(JSON.stringify(data, null, 2));
}

function inferProvider(capability, priority) {
  const value = String(capability || '').toLowerCase();
  const preference = String(priority || '').toLowerCase();
  if (['web_scraping_high_stealth', 'browser_automation', 'stealth_browser'].includes(value)) return 'browserbase';
  if (['web_scraping', 'crawl', 'crawler', 'page_extract', 'website_to_markdown'].includes(value)) return 'firecrawl';
  if (['market_data', 'financial_data', 'quant_data', 'ticks', 'historical_market_data'].includes(value)) return 'databento';
  if (['search', 'web_search', 'research_search', 'content_retrieval'].includes(value)) return preference === 'cost' ? 'tavily' : 'exa';
  if (['ai_search', 'answer_engine', 'citation_search'].includes(value)) return 'perplexity';
  if (['maps', 'geocoding', 'places', 'routing'].includes(value)) return 'google_maps';
  if (['events', 'ticketing', 'event_discovery'].includes(value)) return 'ticketmaster';
  return 'generic_rest_api';
}

const LEAK_PATTERNS = [
  {
    provider: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com',
    authScheme: 'bearer',
    credentialKind: 'api_key',
    pattern: /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{24,}\b/g,
    rotation: 'Create a replacement OpenAI project key, lower budget if high-limit, vault it, then revoke the exposed key.',
  },
  {
    provider: 'anthropic',
    label: 'Anthropic',
    baseUrl: 'https://api.anthropic.com',
    authScheme: 'x_api_key',
    credentialKind: 'api_key',
    headerName: 'x-api-key',
    pattern: /\bsk-ant-(?:api\d{2}|sid\d{2})-[A-Za-z0-9_-]{24,}\b/g,
    rotation: 'Revoke the exposed Anthropic workspace token, vault a replacement, and scrub context with [AGENTPAY_VAULTED_SECRET].',
  },
  {
    provider: 'stripe',
    label: 'Stripe',
    baseUrl: 'https://api.stripe.com',
    authScheme: 'bearer',
    credentialKind: 'api_key',
    pattern: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g,
    rotation: 'Restricted or test keys can be replaced through a configured Stripe rotation adapter. Live master keys require session kill and manual rotation.',
  },
  {
    provider: 'aws',
    label: 'AWS',
    baseUrl: 'https://sts.amazonaws.com',
    authScheme: 'x_api_key',
    credentialKind: 'api_key',
    headerName: 'x-api-key',
    pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
    rotation: 'Deactivate and delete exposed long-term AWS access keys before replacement because IAM users can only hold two active access keys.',
  },
  {
    provider: 'google',
    label: 'Google API',
    baseUrl: 'https://www.googleapis.com',
    authScheme: 'x_api_key',
    credentialKind: 'api_key',
    pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g,
    rotation: 'Restrict or rotate the key in Google Cloud Console.',
  },
];

function fingerprintSecret(value) {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

function redactSecret(value) {
  return value.length > 12 ? `${value.slice(0, 6)}...${value.slice(-4)}` : '[redacted]';
}

function scanTextForLeaks(text) {
  const findings = [];
  const credentials = [];
  const leakedValues = [];
  const seen = new Set();
  for (const detector of LEAK_PATTERNS) {
    detector.pattern.lastIndex = 0;
    for (const match of text.matchAll(detector.pattern)) {
      const keyValue = match[0];
      const fingerprint = fingerprintSecret(keyValue);
      const dedupe = `${detector.provider}:${fingerprint}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      leakedValues.push(keyValue);
      findings.push({
        provider: detector.provider,
        label: detector.label,
        ...classifyLeak(detector.provider, keyValue),
        redacted: redactSecret(keyValue),
        fingerprint,
        index: match.index ?? -1,
        rotation: detector.rotation,
      });
      const policy = classifyLeak(detector.provider, keyValue);
      if (policy.autoVaultAllowed) {
        credentials.push({
          provider: detector.provider,
          label: detector.label,
          baseUrl: detector.baseUrl,
          authScheme: detector.authScheme,
          credentialKind: detector.credentialKind,
          ...(detector.headerName ? { headerName: detector.headerName } : {}),
          keyValue,
        });
      }
    }
  }
  return { findings, credentials, scrubbedText: scrubLeakedText(text, leakedValues) };
}

function classifyLeak(provider, keyValue) {
  if (provider === 'stripe') {
    if (keyValue.startsWith('sk_live_')) {
      return {
        severity: 'critical',
        keyClass: 'stripe_live_master_key',
        recommendedAction: 'kill_agent_session',
        autoVaultAllowed: false,
        autoRotateAllowed: false,
        reason: 'Stripe live master keys are too privileged for automatic handling. Kill the agent session and rotate manually in Stripe.',
      };
    }
    if (keyValue.startsWith('rk_live_')) {
      return {
        severity: 'critical',
        keyClass: 'stripe_live_restricted_key',
        recommendedAction: 'rotate_and_vault',
        autoVaultAllowed: true,
        autoRotateAllowed: true,
        reason: 'Restricted live keys are eligible for adapter-driven replacement when Stripe rotation credentials are configured.',
      };
    }
    return {
      severity: 'high',
      keyClass: 'stripe_test_key',
      recommendedAction: 'rotate_and_vault',
      autoVaultAllowed: true,
      autoRotateAllowed: true,
      reason: 'Stripe test keys can be replaced safely in configured non-production contexts.',
    };
  }

  if (provider === 'aws' && keyValue.startsWith('ASIA')) {
    return {
      severity: 'high',
      keyClass: 'aws_temporary_access_key',
      recommendedAction: 'vault_and_manual_rotate',
      autoVaultAllowed: false,
      autoRotateAllowed: false,
      reason: 'Temporary AWS credentials should expire or be revoked by the issuing session instead of being vaulted as long-term authority.',
    };
  }

  return {
    severity: provider === 'google' ? 'high' : 'critical',
    keyClass: `${provider}_api_key`,
    recommendedAction: 'rotate_and_vault',
    autoVaultAllowed: true,
    autoRotateAllowed: false,
    reason: 'AgentPay can vault replacement access and guide rotation now; provider-side automatic rotation requires a configured admin adapter.',
  };
}

function scrubLeakedText(text, leakedValues) {
  return leakedValues.reduce((scrubbed, keyValue) => (
    scrubbed.split(keyValue).join('[AGENTPAY_VAULTED_SECRET]')
  ), text);
}

function clearScreen() {
  process.stdout.write('\x1b[2J\x1b[H');
}

function truncate(value, max = 42) {
  const text = String(value ?? '');
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

function renderControlPlaneTui(snapshot, opts = {}) {
  const capabilities = Array.isArray(snapshot.capabilities) ? snapshot.capabilities : [];
  const leases = Array.isArray(snapshot.workbenchLeases) ? snapshot.workbenchLeases : [];
  const pending = Array.isArray(snapshot.pendingActions) ? snapshot.pendingActions : [];
  const authority = snapshot.authorityProfile || {};
  const bootstrap = snapshot.authorityBootstrap || {};
  const now = new Date().toLocaleTimeString();

  const lines = [
    'AgentPay Terminal Control Plane',
    `Updated ${now} | principal ${opts.principalId || 'default'} | workbench ${opts.workbenchId || 'default'}`,
    ''.padEnd(78, '='),
    `Authority: ${authority.walletStatus || 'unknown'} | Bootstrap: ${bootstrap.status || 'unknown'} | Runtime: terminal/MCP`,
    `Spend policy: ${JSON.stringify(authority.limits || bootstrap.limits || {}).slice(0, 110)}`,
    ''.padEnd(78, '-'),
    'Active capabilities',
    ...(capabilities.length ? capabilities.slice(0, 8).map((cap) => (
      `  ${truncate(cap.provider || cap.capabilityKey || cap.id, 24).padEnd(26)} ${truncate(cap.status || 'ready', 14).padEnd(16)} ${truncate(cap.capabilityKey || cap.id, 28)}`
    )) : ['  none']),
    ''.padEnd(78, '-'),
    'Workbench leases',
    ...(leases.length ? leases.slice(0, 8).map((lease) => (
      `  ${truncate(lease.id, 24).padEnd(26)} ${truncate(lease.status || 'active', 12).padEnd(14)} ${truncate(lease.workbenchId || lease.subjectRef, 28)}`
    )) : ['  none']),
    ''.padEnd(78, '-'),
    'Pending human/phone actions',
    ...(pending.length ? pending.slice(0, 6).map((action) => (
      `  ${truncate(action.actionType || action.type || action.title, 26).padEnd(28)} ${truncate(action.summary || action.entityType || action.id, 46)}`
    )) : ['  none']),
    ''.padEnd(78, '-'),
    'Leak Guard: use `agentpay scan-secrets --text "<agent output>" --auto-heal` to scrub, vault, and resume safely.',
    'Press Ctrl+C to exit.',
  ];

  clearScreen();
  process.stdout.write(`${lines.join('\n')}\n`);
}

function buildDemoSnapshot(frame = 0) {
  const stages = [
    {
      status: 'approval_required',
      pending: 'Agent Alpha requests Databento market data. Limit approval: $5.00.',
      leak: 'clean',
    },
    {
      status: 'funding_required',
      pending: 'Paid API boundary hit. AgentPay paused exact call and stored capresume_demo_1.',
      leak: 'clean',
    },
    {
      status: 'leak_detected',
      pending: 'Secret leak intercepted before stdout. Stripe restricted key scrubbed and queued.',
      leak: 'rk_live...9f2a -> [AGENTPAY_VAULTED_SECRET]',
    },
    {
      status: 'resumed',
      pending: 'Human step complete. Exact API call resumed server-side. Agent never saw the key.',
      leak: 'vaulted and rotated',
    },
  ];
  const stage = stages[frame % stages.length];
  return {
    authorityProfile: {
      walletStatus: 'ready',
      limits: { perActionUsd: 5, dailyUsd: 25, monthlyUsd: 250 },
    },
    authorityBootstrap: { status: 'ready' },
    capabilities: [
      { id: 'cap_databento', provider: 'databento', status: stage.status, capabilityKey: 'databento_primary' },
      { id: 'cap_browserbase', provider: 'browserbase', status: 'ready', capabilityKey: 'browserbase_primary' },
    ],
    workbenchLeases: [
      { id: 'lease_demo_databento', status: 'active', workbenchId: 'codex-mac-mini' },
    ],
    pendingActions: [
      {
        actionType: stage.status,
        summary: stage.pending,
      },
      {
        actionType: 'leak_guard',
        summary: stage.leak,
      },
    ],
  };
}

// ─── Prompt helper (pure Node.js, no deps) ────────────────────────────────────
async function prompt(question, defaultValue) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    const q = defaultValue ? `${question} (${defaultValue}): ` : `${question}: `;
    rl.question(q, (answer) => {
      rl.close();
      resolve(answer.trim() || defaultValue || '');
    });
  });
}

// ─── Commands ─────────────────────────────────────────────────────────────────

program
  .name('agentpay')
  .description('AgentPay Network CLI — deploy autonomous agents and start earning')
  .version(pkg.version);

/**
 * agentpay deploy
 * Registers a new agent on the AgentPay Network.
 */
program
  .command('deploy')
  .description('Register an agent on the AgentPay Network marketplace')
  .option('-n, --name <name>', 'Agent name')
  .option('-s, --service <service>', 'Service type (e.g. web-scraping, translation)')
  .option('-e, --endpoint <url>', 'Agent endpoint URL (must accept POST /execute or similar)')
  .option('-p, --price <amount>', 'Base price per task (in USD)', '1.00')
  .option('-k, --api-key <key>', 'AgentPay merchant API key (or set AGENTPAY_API_KEY)')
  .action(async (opts) => {
    console.log('\n⚡ AgentPay Network — Agent Deployment\n');

    const apiKey = opts.apiKey || getApiKey();
    if (!apiKey) {
      console.error('❌ API key required. Pass --api-key or set AGENTPAY_API_KEY.');
      console.error('   Get your key at: https://agentpay.network/dashboard');
      process.exit(1);
    }

    const name = opts.name || (await prompt('Agent name', 'MyAgent'));
    const service = opts.service || (await prompt('Service type', 'general'));
    const endpointUrl = opts.endpoint || (await prompt('Endpoint URL', 'https://myagent.example.com/execute'));
    const basePrice = parseFloat(opts.price) || 1.0;

    if (!name || !service || !endpointUrl) {
      console.error('❌ Name, service, and endpoint are required.');
      process.exit(1);
    }

    // Validate URL format
    try {
      new URL(endpointUrl);
    } catch {
      console.error(`❌ Invalid endpoint URL: ${endpointUrl}`);
      process.exit(1);
    }

    console.log('\n📡 Registering agent...');

    try {
      const res = await axios.post(
        `${getApiBase()}/api/agents/register`,
        {
          name,
          service,
          endpointUrl,
          pricing: { base: basePrice },
        },
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 15_000,
        },
      );

      const { agentId, marketplaceUrl } = res.data;

      // Persist agentId to config
      const config = loadConfig();
      config.agentId = agentId;
      config.apiKey = apiKey;
      saveConfig(config);

      console.log('\n✅ Agent registered successfully!\n');
      console.log(`   Agent ID:     ${agentId}`);
      console.log(`   Name:         ${name}`);
      console.log(`   Service:      ${service}`);
      console.log(`   Price:        $${basePrice}/task`);
      console.log(`   Marketplace:  ${getApiBase()}${marketplaceUrl}`);
      console.log('\n🚀 Your agent is LIVE and ready to earn.\n');
      console.log('   Check earnings: agentpay earnings');
      console.log('   View jobs:      agentpay logs\n');
    } catch (err) {
      const msg = err.response?.data?.error || err.message;
      console.error(`\n❌ Deployment failed: ${msg}`);
      if (err.response?.status === 401) {
        console.error('   Check your API key and try again.');
      }
      process.exit(1);
    }
  });

/**
 * agentpay earnings
 * Fetch earnings for the authenticated agent.
 */
program
  .command('earnings')
  .description('Check earnings for your agent')
  .option('-k, --api-key <key>', 'AgentPay merchant API key')
  .option('-i, --agent-id <id>', 'Agent ID (saved from deploy)')
  .action(async (opts) => {
    const apiKey = opts.apiKey || getApiKey();
    const agentId = opts.agentId || getAgentId();

    if (!apiKey) {
      console.error('❌ API key required. Run agentpay deploy first or set AGENTPAY_API_KEY.');
      process.exit(1);
    }

    if (!agentId) {
      console.error('❌ Agent ID not found. Run agentpay deploy first or pass --agent-id.');
      process.exit(1);
    }

    try {
      const res = await axios.get(`${getApiBase()}/api/agents/${agentId}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        timeout: 10_000,
      });

      const agent = res.data.agent;
      console.log('\n💰 Agent Earnings\n');
      console.log(`   Agent:          ${agent.displayName}`);
      console.log(`   Service:        ${agent.service || 'N/A'}`);
      console.log(`   Total Earnings: $${agent.totalEarnings?.toFixed(2) ?? '0.00'}`);
      console.log(`   Jobs Completed: ${agent.tasksCompleted ?? 0}`);
      console.log(`   Rating:         ⭐ ${agent.rating?.toFixed(1) ?? '5.0'}\n`);
    } catch (err) {
      const msg = err.response?.data?.error || err.message;
      console.error(`\n❌ Failed to fetch earnings: ${msg}`);
      process.exit(1);
    }
  });

/**
 * agentpay logs
 * Fetch the last 20 jobs for the authenticated agent.
 */
program
  .command('logs')
  .description('View recent jobs for your agent')
  .option('-k, --api-key <key>', 'AgentPay merchant API key')
  .option('-i, --agent-id <id>', 'Agent ID')
  .option('-l, --limit <n>', 'Number of jobs to show', '20')
  .action(async (opts) => {
    const apiKey = opts.apiKey || getApiKey();
    const agentId = opts.agentId || getAgentId();

    if (!agentId) {
      console.error('❌ Agent ID not found. Run agentpay deploy first or pass --agent-id.');
      process.exit(1);
    }

    try {
      const res = await axios.get(`${getApiBase()}/api/agents/feed`, {
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
        timeout: 10_000,
      });

      const limit = parseInt(opts.limit, 10) || 20;
      const jobs = (res.data.feed || [])
        .filter((tx) => tx.buyer === agentId || tx.seller === agentId)
        .slice(0, limit);

      if (jobs.length === 0) {
        console.log('\n📋 No recent jobs found.\n');
        return;
      }

      console.log(`\n📋 Recent Jobs (${jobs.length})\n`);
      console.log(
        `${'Time'.padEnd(22)} ${'Role'.padEnd(8)} ${'Counterpart'.padEnd(22)} ${'Amount'.padEnd(10)} Status`,
      );
      console.log('─'.repeat(80));

      for (const job of jobs) {
        const isBuyer = job.buyer === agentId;
        const role = isBuyer ? 'Hired' : 'Worker';
        const counterpart = isBuyer ? job.seller : job.buyer;
        const time = new Date(job.timestamp).toLocaleString();
        console.log(
          `${time.padEnd(22)} ${role.padEnd(8)} ${counterpart.slice(0, 20).padEnd(22)} $${job.amount.toFixed(2).padEnd(9)} ${job.status}`,
        );
      }
      console.log();
    } catch (err) {
      const msg = err.response?.data?.error || err.message;
      console.error(`\n❌ Failed to fetch logs: ${msg}`);
      process.exit(1);
    }
  });

/**
 * agentpay config
 * Set/view CLI configuration (API URL, API key).
 */
program
  .command('config')
  .description('View or set CLI configuration')
  .option('--api-url <url>', 'Set the AgentPay API base URL')
  .option('--api-key <key>', 'Set the API key')
  .action((opts) => {
    const config = loadConfig();

    if (opts.apiUrl) {
      config.apiUrl = opts.apiUrl;
      saveConfig(config);
      console.log(`✅ API URL set to: ${opts.apiUrl}`);
    }
    if (opts.apiKey) {
      config.apiKey = opts.apiKey;
      saveConfig(config);
      console.log('✅ API key saved.');
    }
    if (!opts.apiUrl && !opts.apiKey) {
      console.log('\nCurrent config:');
      console.log(`  API URL:  ${config.apiUrl || getApiBase()}`);
      console.log(`  API Key:  ${config.apiKey ? config.apiKey.slice(0, 8) + '...' : 'not set'}`);
      console.log(`  Agent ID: ${config.agentId || 'not set'}\n`);
    }
  });

// ─── Marketplace commands ─────────────────────────────────────────────────────

/**
 * agentpay marketplace discover
 * Search for agents on the AgentPay marketplace.
 */
const marketplace = program
  .command('marketplace')
  .description('Interact with the AgentPay marketplace');

marketplace
  .command('discover')
  .description('Search for agents on the AgentPay marketplace')
  .option('-q, --query <text>', 'Free-text search query')
  .option('-c, --category <cat>', 'Filter by category')
  .option('--min-score <n>', 'Minimum AgentRank score', parseInt)
  .option('--sort <mode>', 'Sort mode: best_match | cheapest | fastest | score', 'best_match')
  .option('-l, --limit <n>', 'Max results', parseInt, 10)
  .option('-k, --api-key <key>', 'AgentPay API key (or set AGENTPAY_API_KEY)')
  .action(async (opts) => {
    const apiKey = opts.apiKey || getApiKey();
    const apiBase = getApiBase();

    const params = new URLSearchParams();
    if (opts.query) params.set('q', opts.query);
    if (opts.category) params.set('category', opts.category);
    if (opts.minScore !== undefined) params.set('minScore', String(opts.minScore));
    params.set('sortBy', opts.sort);
    params.set('limit', String(opts.limit || 10));

    try {
      const res = await axios.get(`${apiBase}/api/marketplace/discover?${params}`, {
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      });
      const { agents = [], pagination } = res.data;

      console.log('\n🔍 AgentPay Marketplace — Discovery Results\n');
      console.log('─'.repeat(80));
      console.log(
        'Rank'.padEnd(6) + 'Agent ID'.padEnd(38) + 'Score'.padEnd(8) + 'Grade'.padEnd(7) + 'Reliability',
      );
      console.log('─'.repeat(80));
      for (const a of agents) {
        console.log(
          `${String(a.rank).padEnd(6)}${(a.agentId || a.handle || '').slice(0, 36).padEnd(38)}${String(a.score).padEnd(8)}${(a.grade || '-').padEnd(7)}${(a.paymentReliability * 100).toFixed(1)}%`,
        );
      }
      console.log(`\nShowing ${agents.length} of ${pagination?.total ?? '?'} agents.\n`);
    } catch (err) {
      const msg = err.response?.data?.error || err.message;
      console.error(`\n❌ Discovery failed: ${msg}`);
      process.exit(1);
    }
  });

/**
 * agentpay marketplace hire
 * Hire an agent from the marketplace.
 */
marketplace
  .command('hire')
  .description('Hire an agent from the AgentPay marketplace with USDC escrow')
  .requiredOption('-a, --agent-id <id>', 'Agent ID to hire')
  .requiredOption('-m, --amount <usdc>', 'Amount in USDC', parseFloat)
  .requiredOption('-t, --task <description>', 'Task description')
  .option('--timeout <hours>', 'Escrow timeout in hours', parseInt, 72)
  .option('-k, --api-key <key>', 'AgentPay API key (or set AGENTPAY_API_KEY)')
  .action(async (opts) => {
    const apiKey = opts.apiKey || getApiKey();
    if (!apiKey) {
      console.error('❌ API key required. Pass --api-key or set AGENTPAY_API_KEY.');
      process.exit(1);
    }

    const apiBase = getApiBase();
    console.log(`\n💼 Hiring agent ${opts.agentId} for $${opts.amount} USDC…`);

    try {
      const res = await axios.post(
        `${apiBase}/api/marketplace/hire`,
        {
          agentIdToHire: opts.agentId,
          amountUsd: opts.amount,
          taskDescription: opts.task,
          timeoutHours: opts.timeout,
        },
        { headers: { Authorization: `Bearer ${apiKey}` } },
      );

      const { escrowId, paymentUrl, status, intentId } = res.data;
      console.log('\n✅ Hire successful!\n');
      console.log(`  Escrow ID:   ${escrowId}`);
      console.log(`  Status:      ${status}`);
      if (intentId) console.log(`  Intent ID:   ${intentId}`);
      if (paymentUrl) console.log(`  Payment URL: ${paymentUrl}`);
      console.log();
    } catch (err) {
      const msg = err.response?.data?.error || err.message;
      console.error(`\n❌ Hire failed: ${msg}`);
      process.exit(1);
    }
  });

/**
 * agentpay init
 * Interactive setup wizard — saves API key and base URL to ~/.agentpay/config.json.
 */
program
  .command('init')
  .description('Interactive setup wizard — configure your AgentPay CLI')
  .action(async () => {
    console.log('\n⚡ AgentPay CLI — Setup Wizard\n');

    const currentConfig = loadConfig();

    const apiKey = await prompt('AgentPay API key', currentConfig.apiKey || '');
    if (!apiKey) {
      console.error('❌ API key is required.');
      process.exit(1);
    }

    const apiUrl = await prompt('API base URL', currentConfig.apiUrl || 'https://agentpay-api.onrender.com');

    const config = { ...currentConfig, apiKey, apiUrl };
    saveConfig(config);

    console.log('\n✅ Configuration saved to ~/.agentpay/config.json\n');
    console.log(`   API URL:  ${apiUrl}`);
    console.log(`   API Key:  ${apiKey.slice(0, 8)}...\n`);
    console.log('   Next steps:');
    console.log('     agentpay deploy   — register your agent');
    console.log('     agentpay status   — view agent status\n');
  });

/**
 * agentpay status
 * Shows agent details, AgentRank score, active escrows, and recent feed events.
 */
program
  .command('status')
  .description('Show current agent status, AgentRank score, and active escrows')
  .option('-k, --api-key <key>', 'AgentPay API key')
  .option('-i, --agent-id <id>', 'Agent ID')
  .action(async (opts) => {
    const apiKey = opts.apiKey || getApiKey();
    const agentId = opts.agentId || getAgentId();
    const apiBase = getApiBase();

    if (!apiKey) {
      console.error('❌ API key required. Run `agentpay init` first or set AGENTPAY_API_KEY.');
      process.exit(1);
    }

    if (!agentId) {
      console.error('❌ Agent ID not found. Run `agentpay deploy` first or pass --agent-id.');
      process.exit(1);
    }

    const headers = { Authorization: `Bearer ${apiKey}` };

    console.log('\n📊 AgentPay — Agent Status\n');
    console.log('─'.repeat(50));

    try {
      const [agentRes, rankRes, escrowRes, feedRes] = await Promise.allSettled([
        axios.get(`${apiBase}/api/agents/${agentId}`, { headers, timeout: 10_000 }),
        axios.get(`${apiBase}/api/agentrank/${agentId}`, { headers, timeout: 10_000 }),
        axios.get(`${apiBase}/api/escrow/stats`, { headers, timeout: 10_000 }),
        axios.get(`${apiBase}/api/feed/status`, { headers, timeout: 10_000 }),
      ]);

      // Agent info
      if (agentRes.status === 'fulfilled') {
        const agent = agentRes.value.data.agent || agentRes.value.data;
        console.log(`  Agent ID:     ${agentId}`);
        console.log(`  Name:         ${agent.displayName || agent.name || 'N/A'}`);
        console.log(`  Service:      ${agent.service || 'N/A'}`);
        console.log(`  Jobs:         ${agent.tasksCompleted ?? 0} completed`);
        console.log(`  Rating:       ⭐ ${agent.rating?.toFixed(1) ?? '5.0'}`);
      } else {
        console.log(`  Agent ID:     ${agentId}`);
        console.log(`  Agent info:   unavailable`);
      }

      console.log('─'.repeat(50));

      // AgentRank
      if (rankRes.status === 'fulfilled') {
        const rank = rankRes.value.data;
        console.log(`  AgentRank:    ${rank.score ?? 'N/A'} (${rank.grade ?? '-'})`);
        console.log(`  Reliability:  ${rank.paymentReliability != null ? (rank.paymentReliability * 100).toFixed(1) + '%' : 'N/A'}`);
      } else {
        console.log(`  AgentRank:    unavailable`);
      }

      console.log('─'.repeat(50));

      // Escrow stats
      if (escrowRes.status === 'fulfilled') {
        const stats = escrowRes.value.data;
        console.log(`  Active escrows:   ${stats.active ?? stats.activeCount ?? 'N/A'}`);
        console.log(`  Pending escrows:  ${stats.pending ?? stats.pendingCount ?? 'N/A'}`);
        console.log(`  Total locked:     $${(stats.totalLocked ?? stats.totalLockedUsd ?? 0).toFixed(2)}`);
      } else {
        console.log(`  Escrow stats: unavailable`);
      }

      console.log('─'.repeat(50));

      // Feed events
      if (feedRes.status === 'fulfilled') {
        const feed = feedRes.value.data;
        console.log(`  Feed events (24h): ${feed.eventsLast24h ?? feed.recentCount ?? 'N/A'}`);
        console.log(`  Last event:        ${feed.lastEventAt ? new Date(feed.lastEventAt).toLocaleString() : 'N/A'}`);
      } else {
        console.log(`  Feed status:  unavailable`);
      }

      console.log('─'.repeat(50));
      console.log();
    } catch (err) {
      const msg = err.response?.data?.error || err.message;
      console.error(`\n❌ Status check failed: ${msg}`);
      process.exit(1);
    }
  });

program
  .command('control-plane')
  .description('Read the terminal-native AgentPay control-plane snapshot')
  .option('-p, --principal-id <id>', 'Human principal ID')
  .option('-w, --workbench-id <id>', 'Workbench ID')
  .option('--json', 'Print raw JSON', true)
  .action(async (opts) => {
    const apiKey = requireApiKey();
    const qs = new URLSearchParams();
    if (opts.principalId) qs.set('principalId', opts.principalId);
    if (opts.workbenchId) qs.set('workbenchId', opts.workbenchId);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';

    try {
      const res = await axios.get(`${getApiBase()}/api/capabilities/terminal/control-plane${suffix}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        timeout: 15_000,
      });
      printJson(res.data);
    } catch (err) {
      const msg = err.response?.data?.error || err.message;
      console.error(`ERROR: control-plane failed: ${msg}`);
      process.exit(1);
    }
  });

program
  .command('tui')
  .description('Open a terminal-native AgentPay control-plane view')
  .option('-p, --principal-id <id>', 'Human principal ID')
  .option('-w, --workbench-id <id>', 'Workbench ID')
  .option('-i, --interval <ms>', 'Refresh interval in milliseconds', (value) => Math.max(parseInt(value, 10) || 5000, 1000), 5000)
  .option('--once', 'Render one frame and exit')
  .option('--demo', 'Render a deterministic 60-second showcase loop without live credentials')
  .action(async (opts) => {
    if (opts.demo) {
      let frame = 0;
      renderControlPlaneTui(buildDemoSnapshot(frame), {
        principalId: opts.principalId || 'principal_demo',
        workbenchId: opts.workbenchId || 'codex-mac-mini',
      });
      if (opts.once) return;
      setInterval(() => {
        frame += 1;
        renderControlPlaneTui(buildDemoSnapshot(frame), {
          principalId: opts.principalId || 'principal_demo',
          workbenchId: opts.workbenchId || 'codex-mac-mini',
        });
      }, Math.max(opts.interval || 3000, 1000));
      return;
    }

    const apiKey = requireApiKey();
    const qs = new URLSearchParams();
    if (opts.principalId) qs.set('principalId', opts.principalId);
    if (opts.workbenchId) qs.set('workbenchId', opts.workbenchId);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';

    const fetchSnapshot = async () => {
      const res = await axios.get(`${getApiBase()}/api/capabilities/terminal/control-plane${suffix}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        timeout: 15_000,
      });
      renderControlPlaneTui(res.data, opts);
    };

    try {
      await fetchSnapshot();
      if (opts.once) return;
      setInterval(async () => {
        try {
          await fetchSnapshot();
        } catch (err) {
          clearScreen();
          const msg = err.response?.data?.error || err.message;
          console.error(`AgentPay TUI refresh failed: ${msg}`);
        }
      }, opts.interval);
    } catch (err) {
      const msg = err.response?.data?.error || err.message;
      console.error(`ERROR: tui failed: ${msg}`);
      process.exit(1);
    }
  });

program
  .command('resume <resumeToken>')
  .description('Resume or poll an AgentPay setup/exact-call token without reconstructing the original API call')
  .action(async (resumeToken) => {
    const apiKey = requireApiKey();
    let endpoint;
    if (resumeToken.startsWith('capresume_')) {
      endpoint = `/api/capabilities/execution-attempts/${encodeURIComponent(resumeToken.slice('capresume_'.length))}`;
    } else if (resumeToken.startsWith('apsetup_')) {
      endpoint = `/api/actions/${encodeURIComponent(resumeToken.slice('apsetup_'.length))}`;
    } else {
      console.error('ERROR: resume token must start with capresume_ or apsetup_.');
      process.exit(1);
    }

    try {
      const res = await axios.get(`${getApiBase()}${endpoint}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        timeout: 15_000,
      });
      printJson({
        resumeToken,
        mode: resumeToken.startsWith('capresume_') ? 'server_side_exact_call_resume' : 'hosted_human_step_status',
        rawSecretsReturned: false,
        result: res.data,
      });
    } catch (err) {
      const msg = err.response?.data?.error || err.message;
      console.error(`ERROR: resume failed: ${msg}`);
      process.exit(1);
    }
  });

program
  .command('buy-api')
  .description('Resolve, buy, or reuse governed API access for this workbench')
  .requiredOption('-c, --capability <need>', 'Capability need, e.g. web_scraping_high_stealth, market_data, search')
  .requiredOption('-s, --subject-ref <id>', 'Workspace, agent, principal, or merchant reference that owns access')
  .option('-p, --principal-id <id>', 'Human principal ID for funding and authority')
  .option('-o, --operator-id <id>', 'Agent/operator ID requesting access')
  .option('-w, --workbench-id <id>', 'Workbench ID for opaque lease reuse')
  .option('--provider <provider>', 'Explicit provider override')
  .option('--priority <value>', 'Provider selection priority: latency, cost, quality, reliability')
  .option('--max-budget <usd>', 'Maximum budget in USD', parseFloat)
  .option('--phone <phone>', 'Phone hint for OTP, approval, funding, or future mobile hook')
  .option('--email <email>', 'Email hint for OTP, setup, or receipts')
  .option('--notification <channel>', 'terminal, phone, or both')
  .option('--no-lease', 'Do not issue an opaque workbench lease')
  .action(async (opts) => {
    const apiKey = requireApiKey();
    const body = {
      capability: opts.capability,
      provider: opts.provider || inferProvider(opts.capability, opts.priority),
      requestedProviderName: opts.provider || opts.capability,
      priority: opts.priority,
      maxBudgetUsd: opts.maxBudget,
      subjectType: 'workspace',
      subjectRef: opts.subjectRef,
      principalId: opts.principalId,
      operatorId: opts.operatorId,
      workbenchId: opts.workbenchId,
      issueWorkbenchLease: opts.lease,
      customerPhone: opts.phone,
      customerEmail: opts.email,
      notificationChannel: opts.notification || (opts.phone ? 'phone' : 'terminal'),
    };

    try {
      const res = await axios.post(`${getApiBase()}/api/capabilities/access-resolve`, body, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 20_000,
      });
      printJson(res.data);
    } catch (err) {
      const msg = err.response?.data?.error || err.message;
      console.error(`ERROR: buy-api failed: ${msg}`);
      process.exit(1);
    }
  });

const leasesCmd = program
  .command('leases')
  .description('Inspect or revoke opaque workbench leases');

leasesCmd
  .command('list')
  .description('List workbench leases')
  .option('-p, --principal-id <id>', 'Principal ID')
  .option('-w, --workbench-id <id>', 'Workbench ID')
  .option('--status <status>', 'active, revoked, or expired')
  .action(async (opts) => {
    const apiKey = requireApiKey();
    const qs = new URLSearchParams();
    if (opts.principalId) qs.set('principalId', opts.principalId);
    if (opts.workbenchId) qs.set('workbenchId', opts.workbenchId);
    if (opts.status) qs.set('status', opts.status);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';

    try {
      const res = await axios.get(`${getApiBase()}/api/capabilities/leases${suffix}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        timeout: 15_000,
      });
      printJson(res.data);
    } catch (err) {
      const msg = err.response?.data?.error || err.message;
      console.error(`ERROR: leases list failed: ${msg}`);
      process.exit(1);
    }
  });

leasesCmd
  .command('revoke <leaseId>')
  .description('Revoke one workbench lease without touching the vaulted provider credential')
  .option('-r, --reason <reason>', 'Audit reason', 'operator_requested')
  .action(async (leaseId, opts) => {
    const apiKey = requireApiKey();
    try {
      const res = await axios.post(`${getApiBase()}/api/capabilities/leases/${encodeURIComponent(leaseId)}/revoke`, {
        reason: opts.reason,
      }, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 15_000,
      });
      printJson(res.data);
    } catch (err) {
      const msg = err.response?.data?.error || err.message;
      console.error(`ERROR: lease revoke failed: ${msg}`);
      process.exit(1);
    }
  });

program
  .command('scan-secrets')
  .description('Scan text or a file for leaked API keys and optionally start AgentPay Leak Guard')
  .option('--text <text>', 'Text to scan')
  .option('--file <path>', 'File to scan')
  .option('--auto-vault', 'Start the AgentPay Leak Guard OTP vault flow for detected supported keys')
  .option('--auto-heal', 'Ask the AgentPay server to scrub, queue vaulting, and report rotation policy')
  .action(async (opts) => {
    if (!opts.text && !opts.file) {
      console.error('ERROR: provide --text or --file.');
      process.exit(1);
    }

    let text = opts.text || '';
    if (opts.file) {
      text = readFileSync(opts.file, 'utf8');
    }

    const { findings, scrubbedText } = scanTextForLeaks(text);
    const killSession = findings.some((finding) => finding.recommendedAction === 'kill_agent_session');
    let vaultSession = null;
    let serverLeakGuard = null;
    if ((opts.autoVault || opts.autoHeal) && findings.length > 0) {
      const apiKey = requireApiKey('API key required to start the AgentPay Leak Guard flow.');
      try {
        const res = await axios.post(`${getApiBase()}/api/capabilities/leak-guard/events`, {
          text,
          mode: opts.autoHeal ? 'auto_heal' : 'vault',
          source: 'cli_scan_secrets',
        }, {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 20_000,
        });
        serverLeakGuard = res.data;
        vaultSession = res.data?.vaultSession ?? null;
      } catch (err) {
        const msg = err.response?.data?.error || err.message;
        console.error(`ERROR: Leak Guard flow failed: ${msg}`);
        process.exit(1);
      }
    }

    printJson({
      status: findings.length > 0 ? 'leak_detected' : 'clean',
      findingCount: findings.length,
      findings,
      scrubbedText: findings.length > 0 ? scrubbedText : text,
      action: killSession ? 'kill_agent_session' : findings.length > 0 ? 'scrub_and_rotate' : 'none',
      autoVaultRequested: Boolean(opts.autoVault),
      autoHealRequested: Boolean(opts.autoHeal),
      vaultSession,
      serverLeakGuard,
      rawSecretsReturned: false,
      nextStep: findings.length > 0
        ? killSession
          ? 'Kill the agent session. A live master key or non-vaultable authority was exposed and must be rotated manually.'
          : 'Rotate/revoke the exposed provider key, then use AgentPay leases or proxy execution instead of raw secrets.'
        : 'No supported provider key pattern detected.',
    });
  });

/**
 * agentpay hire <agentId> <amount> <task>
 * Hire an agent directly with a single command.
 */
program
  .command('hire <agentId> <amount> <task>')
  .description('Hire an agent by ID with USDC escrow')
  .option('-k, --api-key <key>', 'AgentPay API key')
  .action(async (agentId, amount, task, opts) => {
    const apiKey = opts.apiKey || getApiKey();
    if (!apiKey) {
      console.error('❌ API key required. Run `agentpay init` first or set AGENTPAY_API_KEY.');
      process.exit(1);
    }

    const amountUsd = parseFloat(amount);
    if (isNaN(amountUsd) || amountUsd <= 0) {
      console.error('❌ Amount must be a positive number (e.g. 5.00).');
      process.exit(1);
    }

    console.log(`\n💼 Hiring agent ${agentId} for $${amountUsd.toFixed(2)} USDC…`);

    try {
      const res = await axios.post(
        `${getApiBase()}/api/marketplace/hire`,
        { agentIdToHire: agentId, amountUsd, taskDescription: task },
        { headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, timeout: 15_000 },
      );

      const { escrowId, paymentUrl, status, intentId } = res.data;
      console.log('\n✅ Hire successful!\n');
      console.log(`  Escrow ID:   ${escrowId}`);
      console.log(`  Status:      ${status}`);
      if (intentId) console.log(`  Intent ID:   ${intentId}`);
      if (paymentUrl) console.log(`  Payment URL: ${paymentUrl}`);
      console.log();
    } catch (err) {
      const msg = err.response?.data?.error || err.message;
      console.error(`\n❌ Hire failed: ${msg}`);
      process.exit(1);
    }
  });

// ─── Foundation agent commands ────────────────────────────────────────────────

/**
 * agentpay foundation list
 * Lists all 4 constitutional agents registered on the network.
 */
const foundationCmd = program
  .command('foundation')
  .description('Inspect the 4 constitutional foundation agents');

foundationCmd
  .command('list')
  .description('List all constitutional foundation agents and their endpoints')
  .action(async () => {
    const apiBase = getApiBase();
    console.log('\n⚡ AgentPay Constitutional Agents\n');

    try {
      const res = await axios.get(`${apiBase}/api/foundation-agents`, { timeout: 10_000 });
      const { foundationAgents } = res.data;

      for (const agent of foundationAgents) {
        console.log(`  ${agent.name}`);
        console.log(`    ID:       ${agent.id}`);
        console.log(`    Role:     ${agent.description}`);
        console.log(`    Endpoint: ${agent.endpoint}`);
        console.log(`    Actions:  ${agent.actions.join(', ')}`);
        console.log();
      }
    } catch (err) {
      const msg = err.response?.data?.error || err.message;
      console.error(`❌ Could not reach AgentPay API: ${msg}`);
      console.error(`   API base: ${apiBase}`);
      process.exit(1);
    }
  });

/**
 * agentpay foundation inspect <agent>
 * Inspect a single foundation agent. <agent> is one of:
 *   identity | reputation | dispute | intent
 */
foundationCmd
  .command('inspect <agent>')
  .description('Inspect a specific foundation agent (identity|reputation|dispute|intent)')
  .action(async (agentName) => {
    const agentMap = {
      identity:   'identity',
      reputation: 'reputation',
      dispute:    'dispute',
      intent:     'intent',
    };

    const key = agentMap[agentName.toLowerCase()];
    if (!key) {
      console.error(`❌ Unknown agent "${agentName}". Choose: identity, reputation, dispute, intent`);
      process.exit(1);
    }

    const apiBase = getApiBase();
    console.log(`\n⚡ Foundation Agent: ${agentName}\n`);

    try {
      const res = await axios.get(`${apiBase}/api/foundation-agents`, { timeout: 10_000 });
      const agent = res.data.foundationAgents.find(
        (a) => a.endpoint.endsWith(`/${key}`)
      );

      if (!agent) {
        console.error('❌ Agent not found in registry response.');
        process.exit(1);
      }

      console.log(`  Name:        ${agent.name}`);
      console.log(`  ID:          ${agent.id}`);
      console.log(`  Layer:       ${agent.layer}`);
      console.log(`  Description: ${agent.description}`);
      console.log(`  Endpoint:    ${apiBase}${agent.endpoint}`);
      console.log(`  Actions:`);
      for (const action of agent.actions) {
        console.log(`    - ${action}`);
      }
      console.log(`  Pricing:`);
      for (const [tier, price] of Object.entries(agent.pricing)) {
        console.log(`    ${tier}: ${price}`);
      }
      console.log();

      console.log(`  Example call (curl):`);
      console.log(`    curl -X POST ${apiBase}${agent.endpoint} \\`);
      console.log(`      -H 'Content-Type: application/json' \\`);
      console.log(`      -d '{"action":"${agent.actions[0]}"}'`);
      console.log();
    } catch (err) {
      const msg = err.response?.data?.error || err.message;
      console.error(`❌ Could not reach AgentPay API: ${msg}`);
      process.exit(1);
    }
  });

program.parse();
