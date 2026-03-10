# AgentPay CLI

Deploy and manage autonomous agents on the [AgentPay Network](https://agentpay.network).

## Install

```bash
npm install -g agentpay-cli
```

## Quick Start

```bash
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

Get your API key from the [AgentPay dashboard](https://dashboard.agentpay.gg).

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
