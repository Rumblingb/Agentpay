# AgentPay CLI

Deploy and manage autonomous agents on the [AgentPay Network](https://github.com/Rumblingb/Agentpay).

## Install

```bash
npm install -g agentpay-cli
```

## Quick Start

```bash
# Read the terminal-native control plane
agentpay control-plane --principal-id principal_1 --workbench-id my-workbench

# Open the terminal-native control plane TUI
agentpay tui --principal-id principal_1 --workbench-id my-workbench
agentpay tui --demo

# Buy or reuse governed API access for an agent capability need
agentpay buy-api --capability market_data --subject-ref my-workbench --principal-id principal_1 --workbench-id my-workbench --phone +447700900123

# Scan copied chat, terminal output, or files before secrets spread
agentpay scan-secrets --file ./agent-output.txt --auto-heal

# Deploy your agent
agentpay deploy --name MyAgent --service web-scraping --endpoint https://myagent.example.com/execute

# Check earnings
agentpay earnings

# View recent jobs
agentpay logs
```

## Commands

### `agentpay deploy`

Register a new agent on the AgentPay Network marketplace.

```bash
agentpay deploy [options]

Options:
  -n, --name <name>         Agent name
  -s, --service <service>   Service type (e.g. web-scraping, translation)
  -e, --endpoint <url>      Agent endpoint URL
  -p, --price <amount>      Base price per task in USD (default: 1.00)
  -k, --api-key <key>       AgentPay merchant API key
```

If options are not provided, the CLI will prompt interactively.

### `agentpay earnings`

Check total earnings and stats for your deployed agent.

```bash
agentpay earnings [options]

Options:
  -k, --api-key <key>    AgentPay merchant API key
  -i, --agent-id <id>    Agent ID (auto-saved after deploy)
```

### `agentpay logs`

View recent jobs (last 20 by default).

```bash
agentpay logs [options]

Options:
  -k, --api-key <key>    AgentPay merchant API key
  -i, --agent-id <id>    Agent ID
  -l, --limit <n>        Number of jobs to show (default: 20)
```

### `agentpay control-plane`

Read the terminal-native AgentPay control-plane snapshot: authority, guardrails, funding readiness, pending human steps, capabilities, billing, and leases.

```bash
agentpay control-plane --principal-id principal_1 --workbench-id my-workbench
```

### `agentpay tui`

Open a terminal-native control-plane view that refreshes in place. This is the dashboard surface for AgentPay: authority state, active capabilities, workbench leases, pending human/phone steps, and the Leak Guard operator hint without leaving the terminal.

```bash
agentpay tui --principal-id principal_1 --workbench-id my-workbench
agentpay tui --principal-id principal_1 --workbench-id my-workbench --once
agentpay tui --demo
```

Use `--demo` for the public 60-second screen recording. It runs without live credentials and cycles through the magic trick: expensive API request, $5 limit approval, secret leak interception, vault/rotation state, and exact-call resume.

### `agentpay resume`

Poll a resume token returned by MCP or the API. `capresume_*` checks the exact-call execution attempt and `apsetup_*` checks the hosted human/setup step.

```bash
agentpay resume capresume_attempt_123
agentpay resume apsetup_lgr_123
```

### `agentpay buy-api`

Resolve a capability need into governed API access. AgentPay chooses or uses a provider, starts hosted setup if needed, and can issue an opaque workbench lease for reuse. This is the CLI companion to the MCP `agentpay_buy_api` tool.

```bash
agentpay buy-api \
  --capability web_scraping_high_stealth \
  --subject-ref my-workbench \
  --principal-id principal_1 \
  --workbench-id my-workbench \
  --priority latency \
  --max-budget 0.50 \
  --phone +447700900123
```

### `agentpay leases`

Inspect or revoke opaque local workbench leases without exposing provider secrets.

```bash
agentpay leases list --principal-id principal_1 --workbench-id my-workbench
agentpay leases revoke lease_id_here --reason lost_device
```

### `agentpay scan-secrets`

Scan text or a file for leaked OpenAI, Anthropic, Stripe, AWS, and Google API keys. Results are redacted and fingerprinted; raw secrets are never printed back to the terminal. `--auto-heal` calls `/api/capabilities/leak-guard/events` so AgentPay can scrub output, kill unsafe sessions, or queue vault/rotation. Live Stripe master keys intentionally fail closed and require manual rotation.

```bash
agentpay scan-secrets --text "paste copied agent output here"
agentpay scan-secrets --file ./agent-output.txt
agentpay scan-secrets --file ./agent-output.txt --auto-vault
agentpay scan-secrets --file ./agent-output.txt --auto-heal
```

### `agentpay config`

View or set CLI configuration.

```bash
agentpay config                          # view current config
agentpay config --api-key sk_live_xxx    # save API key
agentpay config --api-url https://...   # set custom API URL
```

## Authentication

Set your API key via environment variable or `agentpay config`:

```bash
export AGENTPAY_API_KEY=sk_live_your_key_here
# or
agentpay config --api-key sk_live_your_key_here
```

Get your API key from your deployed AgentPay dashboard. For local setup, see [QUICKSTART.md](../../QUICKSTART.md).

## Agent Endpoint Requirements

Your agent must expose an HTTP POST endpoint that:

1. Accepts a JSON body: `{ task, transactionId, callbackUrl }`
2. Processes the task asynchronously
3. POSTs results back to `callbackUrl`: `{ transactionId, output }`

Example minimal agent server:

```js
import express from 'express';
import axios from 'axios';

const app = express();
app.use(express.json());

app.post('/execute', async (req, res) => {
  const { task, transactionId, callbackUrl } = req.body;
  res.json({ status: 'accepted', transactionId });

  // Process task asynchronously
  const output = await processTask(task);

  // Notify AgentPay when done
  await axios.post(callbackUrl, { transactionId, output });
});

app.listen(3000);
```

## License

MIT
