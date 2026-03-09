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

program.parse();
