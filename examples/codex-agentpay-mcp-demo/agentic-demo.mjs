#!/usr/bin/env node
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const defaultMcpLauncher = path.join(repoRoot, 'scripts', 'agentpay-codex-mcp.mjs');

function usage() {
  return `Codex + AgentPay MCP agentic demo

Usage:
  node examples/codex-agentpay-mcp-demo/agentic-demo.mjs [options]

Options:
  --mock                  Run against a local mock AgentPay API. Default.
  --live                  Run against AGENTPAY_API_URL or https://api.agentpay.so.
  --api-key <key>         API key for live mode. Defaults to AGENTPAY_API_KEY.
  --api-url <url>         API URL for live mode. Defaults to AGENTPAY_API_URL.
  --mcp-launcher <path>   MCP launcher path. Defaults to scripts/agentpay-codex-mcp.mjs.
  --subject-ref <id>      Workbench/subject reference. Default: codex-agentpay-demo.
  --principal-id <id>     Principal for live mode. Default: principal_codex_demo.
  --operator-id <id>      Operator id. Default: codex-demo-agent.
  --customer-phone <num>  Phone hint for approval. Optional.
  --customer-email <mail> Email hint for approval. Optional.
  --compact               Print compact console output.
  --transcript-path <path> Markdown transcript path. Default: demo-recordings/latest-codex-agentpay-mcp-demo.md.
  --json-path <path>      JSON transcript path. Default: demo-recordings/latest-codex-agentpay-mcp-demo.json.
  --no-artifacts          Do not write transcript artifacts.
  --help                  Show this help.

Examples:
  node examples/codex-agentpay-mcp-demo/agentic-demo.mjs
  AGENTPAY_API_KEY=apk_... node examples/codex-agentpay-mcp-demo/agentic-demo.mjs --live --customer-phone +15555550100
`;
}

function parseArgs(argv) {
  const args = { mode: 'mock' };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    if (key === 'help') {
      args.help = true;
      continue;
    }
    if (key === 'compact' || key === 'no-artifacts') {
      args[key] = true;
      continue;
    }
    if (key === 'mock' || key === 'live') {
      args.mode = key;
      continue;
    }
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) throw new Error(`Missing value for --${key}`);
    args[key] = next;
    i += 1;
  }
  return args;
}

function logStep(title, body) {
  process.stdout.write(`\n\x1b[1m${title}\x1b[0m\n`);
  if (body) process.stdout.write(`${body}\n`);
}

function summarizeJson(value) {
  return JSON.stringify(sanitizeValue(value), null, 2)
    .replace(/"token": "([^"]+)"/g, '"token": "[redacted]"')
    .replace(/"leaseToken": "([^"]+)"/g, '"leaseToken": "[redacted]"')
    .replace(/"Authorization": "([^"]+)"/gi, '"Authorization": "[redacted]"');
}

function sanitizeValue(value, key = '') {
  if (Array.isArray(value)) return value.map((entry) => sanitizeValue(entry));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [entryKey, sanitizeValue(entryValue, entryKey)]),
    );
  }
  if (typeof value !== 'string') return value;
  if (/(api[_-]?key|authorization|secret|password)/i.test(key)) return '[redacted]';
  if (/^lease_.*token/i.test(value)) return '[redacted]';
  return redactKnownSecrets(value);
}

function redactKnownSecrets(text) {
  return text
    .replace(/\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g, (secret) => `${secret.slice(0, 6)}...${secret.slice(-4)}`)
    .replace(/\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{24,}\b/g, (secret) => `${secret.slice(0, 6)}...${secret.slice(-4)}`)
    .replace(/\bsk-ant-(?:api\d{2}|sid\d{2})-[A-Za-z0-9_-]{24,}\b/g, (secret) => `${secret.slice(0, 6)}...${secret.slice(-4)}`)
    .replace(/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, (secret) => `${secret.slice(0, 6)}...${secret.slice(-4)}`)
    .replace(/\bAIza[0-9A-Za-z_-]{35}\b/g, (secret) => `${secret.slice(0, 6)}...${secret.slice(-4)}`);
}

function parseToolJson(result) {
  const text = result?.content?.find((part) => part.type === 'text')?.text;
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function findResumeToken(value) {
  if (!value || typeof value !== 'object') return null;
  if (typeof value.resumeToken === 'string') return value.resumeToken;
  if (value.agentResume && typeof value.agentResume.resumeToken === 'string') return value.agentResume.resumeToken;
  if (value.nextAction?.agentResume && typeof value.nextAction.agentResume.resumeToken === 'string') {
    return value.nextAction.agentResume.resumeToken;
  }
  for (const child of Object.values(value)) {
    const found = findResumeToken(child);
    if (found) return found;
  }
  return null;
}

async function startMockAgentPayApi() {
  const state = {
    accessResolveCalls: 0,
    actionStatus: 'pending',
    executionStatus: 'blocked',
  };

  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const bodyText = Buffer.concat(chunks).toString('utf8');
    const body = bodyText ? JSON.parse(bodyText) : {};

    const send = (status, payload) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(payload));
    };

    if (req.method === 'POST' && req.url === '/api/capabilities/access-resolve') {
      state.accessResolveCalls += 1;
      if (state.accessResolveCalls === 1) {
        send(200, {
          status: 'needs_provider_setup',
          provider: 'databento',
          capability: body.capability,
          actionSession: {
            sessionId: 'act_codex_databento_connect',
            status: state.actionStatus,
            url: 'https://api.agentpay.so/actions/demo-connect',
          },
          nextAction: {
            type: 'connect_provider',
            label: 'Connect Databento through AgentPay',
            message: 'Human approval/provider setup is required before the agent can access market data.',
          },
        });
        return;
      }

      send(200, {
        status: 'ready',
        provider: 'databento',
        capability: {
          id: 'cap_codex_market_data_demo',
          provider: 'databento',
          status: 'connected',
        },
        workbenchLease: {
          leaseId: 'lease_codex_demo',
          token: 'lease_demo_secret_token_redacted_by_demo',
          workbenchId: body.workbenchId,
          status: 'active',
        },
      });
      return;
    }

    if (req.method === 'GET' && req.url === '/api/actions/act_codex_databento_connect') {
      send(200, {
        sessionId: 'act_codex_databento_connect',
        status: state.actionStatus,
        completed: state.actionStatus === 'completed',
        message: state.actionStatus === 'completed'
          ? 'Provider setup approved. The agent can retry access resolution.'
          : 'Waiting for human provider setup.',
      });
      return;
    }

    if (req.method === 'POST' && req.url === '/api/capabilities/lease-execute') {
      send(200, {
        status: 'blocked_for_approval',
        executionAttempt: {
          attemptId: 'exec_codex_market_data_demo',
          status: state.executionStatus,
          amountUsd: 1.25,
          reason: 'Initial market-data call exceeds the free tier and needs governed approval.',
        },
        nextAction: {
          type: 'approval',
          message: 'Approve $1.25 to execute the stored market-data request.',
        },
      });
      return;
    }

    if (req.method === 'GET' && req.url === '/api/capabilities/execution-attempts/exec_codex_market_data_demo') {
      send(200, {
        executionAttempt: {
          attemptId: 'exec_codex_market_data_demo',
          status: state.executionStatus,
        },
        result: state.executionStatus === 'completed'
          ? {
              symbol: 'NVDA',
              lastPrice: 914.21,
              currency: 'USD',
              source: 'mock-databento-via-agentpay',
            }
          : null,
      });
      return;
    }

    if (req.method === 'POST' && req.url === '/__demo/complete-action') {
      state.actionStatus = 'completed';
      send(200, { ok: true, actionStatus: state.actionStatus });
      return;
    }

    if (req.method === 'POST' && req.url === '/__demo/complete-execution') {
      state.executionStatus = 'completed';
      send(200, { ok: true, executionStatus: state.executionStatus });
      return;
    }

    send(404, { error: 'not_found', method: req.method, url: req.url });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  return {
    baseUrl,
    completeAction: () => fetch(`${baseUrl}/__demo/complete-action`, { method: 'POST' }),
    completeExecution: () => fetch(`${baseUrl}/__demo/complete-execution`, { method: 'POST' }),
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function recordStep(transcript, step) {
  transcript.steps.push({
    at: new Date().toISOString(),
    ...step,
  });
}

async function callAgentPayTool(client, name, args, transcript, options = {}) {
  if (!options.compact) logStep(`MCP call: ${name}`, summarizeJson(args));
  const result = parseToolJson(await client.callTool({ name, arguments: args }));
  if (options.compact) {
    process.stdout.write(`MCP ${name}: ${result.status ?? result.executionAttempt?.status ?? result.sessionId ?? 'ok'}\n`);
  } else {
    process.stdout.write(`${summarizeJson(result)}\n`);
  }
  recordStep(transcript, {
    kind: 'mcp_call',
    tool: name,
    input: sanitizeValue(args),
    output: sanitizeValue(result),
  });
  return result;
}

function toMarkdown(transcript) {
  const lines = [
    '# Codex + AgentPay MCP Demo Transcript',
    '',
    `- Generated: ${transcript.generatedAt}`,
    `- Mode: ${transcript.mode}`,
    `- API URL: ${transcript.apiUrl}`,
    `- MCP launcher: ${transcript.mcpLauncher}`,
    `- Subject/workbench: ${transcript.subjectRef}`,
    '',
    '## Outcome',
    '',
    ...transcript.outcome.map((line) => `- ${line}`),
    '',
    '## Steps',
    '',
  ];

  for (const step of transcript.steps) {
    lines.push(`### ${step.kind === 'mcp_call' ? `MCP: ${step.tool}` : step.title}`);
    lines.push('');
    if (step.summary) lines.push(step.summary, '');
    if (step.input) {
      lines.push('Input:', '', '```json', JSON.stringify(step.input, null, 2), '```', '');
    }
    if (step.output) {
      lines.push('Output:', '', '```json', JSON.stringify(step.output, null, 2), '```', '');
    }
  }

  return `${lines.join('\n')}\n`;
}

async function writeArtifacts(transcript, args) {
  if (args['no-artifacts']) return;
  const markdownPath = path.resolve(args['transcript-path'] ?? path.join(repoRoot, 'demo-recordings', 'latest-codex-agentpay-mcp-demo.md'));
  const jsonPath = path.resolve(args['json-path'] ?? path.join(repoRoot, 'demo-recordings', 'latest-codex-agentpay-mcp-demo.json'));
  await mkdir(path.dirname(markdownPath), { recursive: true });
  await mkdir(path.dirname(jsonPath), { recursive: true });
  await writeFile(markdownPath, toMarkdown(transcript), 'utf8');
  await writeFile(jsonPath, `${JSON.stringify(transcript, null, 2)}\n`, 'utf8');
  logStep('Artifacts written', `${markdownPath}\n${jsonPath}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage());
    return;
  }

  const mock = args.mode === 'mock' ? await startMockAgentPayApi() : null;
  const apiUrl = mock?.baseUrl ?? args['api-url'] ?? process.env.AGENTPAY_API_URL ?? 'https://api.agentpay.so';
  const apiKey = args['api-key'] ?? process.env.AGENTPAY_API_KEY ?? (mock ? 'apk_mock_codex_demo' : '');
  const mcpLauncher = path.resolve(args['mcp-launcher'] ?? defaultMcpLauncher);
  const subjectRef = args['subject-ref'] ?? 'codex-agentpay-demo';
  const principalId = args['principal-id'] ?? 'principal_codex_demo';
  const operatorId = args['operator-id'] ?? 'codex-demo-agent';
  const transcript = {
    generatedAt: new Date().toISOString(),
    mode: args.mode,
    apiUrl,
    mcpLauncher,
    subjectRef,
    steps: [],
    outcome: [],
  };

  if (!apiKey) {
    throw new Error('Live mode requires --api-key or AGENTPAY_API_KEY.');
  }

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [mcpLauncher],
    cwd: repoRoot,
    stderr: 'pipe',
    env: {
      ...process.env,
      AGENTPAY_API_KEY: apiKey,
      AGENTPAY_API_URL: apiUrl,
    },
  });

  transport.stderr?.on('data', (chunk) => {
    process.stderr.write(`[agentpay-mcp] ${chunk}`);
  });

  const client = new Client({ name: 'codex-agentpay-agentic-demo', version: '1.0.0' });

  try {
    logStep('Boot', `Starting AgentPay MCP through ${mcpLauncher}\nAPI URL: ${apiUrl}`);
    recordStep(transcript, {
      kind: 'agent_event',
      title: 'Boot',
      summary: `Started AgentPay MCP through ${mcpLauncher}.`,
    });
    await client.connect(transport);

    const tools = await client.listTools();
    const toolNames = new Set(tools.tools.map((tool) => tool.name));
    for (const required of ['agentpay_scan_for_leaked_secrets', 'agentpay_buy_api', 'agentpay_execute_with_resume_token']) {
      if (!toolNames.has(required)) throw new Error(`AgentPay MCP did not expose required tool: ${required}`);
    }
    logStep('Agent observes MCP capability', `Found ${tools.tools.length} AgentPay tools, including leak scan, API buying, and exact-call resume.`);
    recordStep(transcript, {
      kind: 'agent_event',
      title: 'Agent observes MCP capability',
      summary: `Found ${tools.tools.length} AgentPay tools, including leak scan, API buying, and exact-call resume.`,
    });

    const suspiciousAgentOutput = [
      'Build logs from autonomous worker:',
      'STRIPE_RESTRICTED_KEY=rk_live_1234567890abcdefghijkl',
      'Next step: call market data API directly from the agent process.',
    ].join('\n');

    logStep('Agent thought', 'The worker leaked a provider secret and wants market data. I need to contain the leak, then acquire governed access without handling raw keys.');
    recordStep(transcript, {
      kind: 'agent_event',
      title: 'Agent thought',
      summary: 'The worker leaked a provider secret and wants market data. The agent chooses containment plus governed access.',
    });

    const leakScan = await callAgentPayTool(client, 'agentpay_scan_for_leaked_secrets', {
      text: suspiciousAgentOutput,
      source: 'codex_agentpay_mcp_demo',
      mode: 'scan',
      subjectType: 'workspace',
      subjectRef,
    }, transcript, { compact: args.compact });

    const firstFinding = leakScan.findings?.[0];
    logStep(
      'Agent decision: contain leaked secret',
      [
        `Status: ${leakScan.status}`,
        `Raw secrets returned: ${leakScan.secretHandling?.rawSecretsReturned}`,
        `Recommended action: ${firstFinding?.recommendedAction ?? leakScan.immediateAction}`,
        `Session decision: ${firstFinding?.recommendedAction === 'kill_agent_session' ? 'kill session' : 'continue only through AgentPay-governed access'}`,
      ].join('\n'),
    );
    recordStep(transcript, {
      kind: 'agent_event',
      title: 'Agent decision: contain leaked secret',
      summary: `Leak status ${leakScan.status}; rawSecretsReturned=${leakScan.secretHandling?.rawSecretsReturned}; recommendedAction=${firstFinding?.recommendedAction ?? leakScan.immediateAction}.`,
    });

    const buyArgs = {
      capability: 'market_data',
      maxBudgetUsd: 5,
      priority: 'reliability',
      subjectType: 'workspace',
      subjectRef,
      principalId,
      operatorId,
      workbenchId: subjectRef,
      workbenchLabel: 'Codex AgentPay MCP demo',
      notificationChannel: args['customer-phone'] ? 'phone' : 'terminal',
      customerPhone: args['customer-phone'],
      customerEmail: args['customer-email'],
      issueWorkbenchLease: true,
      initialCall: {
        method: 'GET',
        path: '/v1/market-data/last',
        query: { symbol: 'NVDA' },
        allowPaidUsage: true,
        requestId: 'codex-demo-market-data-nvda',
        idempotencyKey: 'codex-demo-market-data-nvda',
      },
    };

    const setupBlocked = await callAgentPayTool(client, 'agentpay_buy_api', buyArgs, transcript, { compact: args.compact });
    const setupResumeToken = findResumeToken(setupBlocked);
    if (setupResumeToken) {
      logStep('Human step surfaced', `AgentPay returned resume token: ${setupResumeToken}\nThe agent stores the token instead of reconstructing the setup flow.`);
      recordStep(transcript, {
        kind: 'agent_event',
        title: 'Human step surfaced',
        summary: `AgentPay returned setup resume token ${setupResumeToken}; the agent stores the token instead of reconstructing setup.`,
      });
    }

    if (mock && setupResumeToken?.startsWith('apsetup_')) {
      logStep('Demo harness', 'Simulating the human completing provider setup in AgentPay.');
      await mock.completeAction();
      await callAgentPayTool(client, 'agentpay_execute_with_resume_token', { resumeToken: setupResumeToken }, transcript, { compact: args.compact });
    }

    const executionBlocked = await callAgentPayTool(client, 'agentpay_buy_api', buyArgs, transcript, { compact: args.compact });
    const executionResumeToken = findResumeToken(executionBlocked);
    if (executionResumeToken) {
      logStep('Paid execution pause', `AgentPay returned exact-call resume token: ${executionResumeToken}\nThe stored API call can resume server-side after approval.`);
      recordStep(transcript, {
        kind: 'agent_event',
        title: 'Paid execution pause',
        summary: `AgentPay returned exact-call resume token ${executionResumeToken}; the stored API call can resume server-side after approval.`,
      });
    }

    if (mock && executionResumeToken?.startsWith('capresume_')) {
      logStep('Demo harness', 'Simulating the human approving the $1.25 market-data execution.');
      await mock.completeExecution();
      await callAgentPayTool(client, 'agentpay_execute_with_resume_token', { resumeToken: executionResumeToken }, transcript, { compact: args.compact });
    }

    transcript.outcome = [
      'Leak was detected and raw secrets were not returned to the agent.',
      'The agent switched from direct API-key use to AgentPay-governed market_data access under a $5 budget.',
      'Human/provider setup and paid execution were represented as resumable AgentPay tokens.',
      'The agent never received the provider credential or had to rebuild the blocked call.',
    ];
    logStep(
      'Final agent answer',
      transcript.outcome.join('\n'),
    );
    recordStep(transcript, {
      kind: 'agent_event',
      title: 'Final agent answer',
      summary: transcript.outcome.join(' '),
    });
    await writeArtifacts(transcript, args);
  } finally {
    await transport.close().catch(() => {});
    if (mock) await mock.close();
  }
}

main().catch((err) => {
  process.stderr.write(`\nDemo failed: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exitCode = 1;
});
