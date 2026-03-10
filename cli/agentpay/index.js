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
    process.env.AGENTPAY_API_URL ||
    config.apiUrl ||
    'https://agentpay-api.onrender.com'
  );
}

function getApiKey() {
  return process.env.AGENTPAY_API_KEY || loadConfig().apiKey;
}

function getAgentId() {
  return process.env.AGENTPAY_AGENT_ID || loadConfig().agentId;
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

program.parse();
