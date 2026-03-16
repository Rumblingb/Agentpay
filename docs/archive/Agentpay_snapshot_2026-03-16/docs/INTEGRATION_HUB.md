# AgentPay Integration Hub

> One-stop guide for integrating AgentPay into any AI agent framework or platform.

## Quick Navigation

| Framework | Install | Example | Guide |
|-----------|---------|---------|-------|
| [Clawbot](#clawbot) | `pip install agentpay` | `POST /api/v1/agents/interact` | [↓ Guide](#clawbot) |
| [Moltbook](#moltbook) | `npm i @agentpay/sdk` | [`examples/moltbook-integration-example.ts`](../examples/moltbook-integration-example.ts) | [↓ Guide](#moltbook) |
| [CrewAI](#crewai) | `pip install agentpay` | [`examples/crewai-agentpay-tool.py`](../examples/crewai-agentpay-tool.py) | [↓ Guide](#crewai) |
| [LangGraph](#langgraph) | `npm i @agentpay/sdk` | [`examples/langgraph-payment-node.ts`](../examples/langgraph-payment-node.ts) | [↓ Guide](#langgraph) |
| [AutoGPT](#autogpt) | `pip install agentpay` | [`examples/autogpt-plugin/agentpay.py`](../examples/autogpt-plugin/agentpay.py) | [↓ Guide](#autogpt) |
| [OpenAI Agents SDK](#openai-agents-sdk) | `npm i @agentpay/sdk` | [`examples/openai-function-calling/agentpay-tool.ts`](../examples/openai-function-calling/agentpay-tool.ts) | [↓ Guide](#openai-agents-sdk) |

---

## Prerequisites

All integrations require an AgentPay API key. Get one in under 60 seconds:

```bash
# Option A: Dashboard (recommended)
open https://dashboard.agentpay.gg

# Option B: CLI
npx agentpay init
```

Set in your environment:

```bash
export AGENTPAY_API_KEY="sk_live_..."
export AGENTPAY_API_URL="https://api.agentpay.gg"  # optional
```

---

## Clawbot

Clawbot agents can connect to AgentPay using the single-call `/interact` endpoint — no SDK required.

### Fastest path

```python
import os, requests

AGENTPAY_API_KEY = os.environ["AGENTPAY_API_KEY"]
AGENTPAY_API_URL = os.getenv("AGENTPAY_API_URL", "https://api.agentpay.gg")

def clawbot_interact(from_id: str, to_id: str, service: str = "general",
                     outcome: str = "success") -> dict:
    resp = requests.post(
        f"{AGENTPAY_API_URL}/api/v1/agents/interact",
        headers={"Authorization": f"Bearer {AGENTPAY_API_KEY}"},
        json={
            "fromAgentId":     from_id,
            "toAgentId":       to_id,
            "interactionType": "task",
            "service":         service,
            "outcome":         outcome,
            "trustCheck":      True,
        },
        timeout=10,
    )
    resp.raise_for_status()
    data = resp.json()
    if data.get("warnings"):
        print(f"[agentpay] soft-fail warnings: {data['warnings']}")
    return {
        "interactionId":   data["interactionId"],
        "identityVerified": data["toAgent"]["identityVerified"],
        "trustScore":       data["toAgent"].get("trustScore"),
    }
```

### Key rules for Clawbot agents

- Use `identityVerified` (not `identityFound`) for trust-sensitive decisions.
- Always inspect `warnings[]` — a non-empty array means at least one step was skipped.
- Pass `amount` + `createIntent: true` together to create a coordination intent; omitting `amount` when `createIntent` is `true` is a hard 400 error.

### Further reading

- [Agent Interact Quickstart](./AGENT_INTERACT_QUICKSTART.md) — full field reference and response schema
- [Agent Onboarding Guide](./AGENT_ONBOARDING_GUIDE.md) — register and verify your Clawbot agent identity

---

## Moltbook

### Install

```bash
npm install @agentpay/sdk @moltbook/sdk
```

### Register a Moltbook bot in one call

```typescript
import { registerMoltbookAgent } from '@agentpay/sdk';
import { moltbook } from '@moltbook/sdk';

// Verify the Moltbook token
const agent = await moltbook.agents.verifyToken(process.env.MOLTBOOK_TOKEN!);

// Register with AgentPay (auto-creates identity + maps karma → AgentRank)
const result = await registerMoltbookAgent(agent.id, agent.karma);
console.log(`AgentRank: ${result.agentRank}`); // e.g. 650
```

### Full example

See [`examples/moltbook-integration-example.ts`](../examples/moltbook-integration-example.ts)

### REST API

```powershell
# Register
Invoke-RestMethod -Method Post -Uri "https://api.agentpay.gg/api/moltbook/bots/register" `
  -ContentType "application/json" `
  -Body '{"bot_id":"my-bot","handle":"@mybot","bio":"Demo agent","karma":750}'

# Get AgentRank
Invoke-RestMethod "https://api.agentpay.gg/api/agentrank/my-bot"
```

---

## CrewAI

### Install

```bash
pip install agentpay crewai
```

### One-liner integration

```python
from crewai import Agent, Crew, Task
from examples.crewai_agentpay_tool import AgentPayTool

pay_tool = AgentPayTool(api_key="sk_live_...")

billing_agent = Agent(
    role="Billing Manager",
    goal="Process payments accurately",
    tools=[pay_tool],
)

task = Task(
    description='Pay $5.00 to agent "data-provider-001" for API access',
    expected_output="Payment ID and confirmation",
    agent=billing_agent,
)

Crew(agents=[billing_agent], tasks=[task]).kickoff()
```

### Supported actions

| Action | Input | Description |
|--------|-------|-------------|
| `create_payment` | `amount_usd`, `recipient`, `memo` | Create Solana/Stripe payment |
| `verify_payment` | `payment_id` | Check payment status |
| `check_rank` | `agent_id` | Get AgentRank (0-1000) |
| `create_escrow` | `amount_usd`, `payee_id`, `task` | Create escrow |

### Full example

See [`examples/crewai-agentpay-tool.py`](../examples/crewai-agentpay-tool.py)

---

## LangGraph

### Install

```bash
npm install @agentpay/sdk @langchain/langgraph
```

### Add payment node to your graph

```typescript
import { StateGraph, START, END } from '@langchain/langgraph';
import { AgentPayAnnotation, agentPayNode } from './examples/langgraph-payment-node';

const workflow = new StateGraph(AgentPayAnnotation)
  .addNode('payment', agentPayNode)
  .addEdge(START, 'payment')
  .addEdge('payment', END)
  .compile();

// Create a payment
const result = await workflow.invoke({
  action: 'create_payment',
  amountUsd: 2.50,
  recipientId: 'agent-data-001',
  memo: 'Weather API call fee',
});

console.log(result.status); // 'payment_created'
console.log(result.result); // { id: 'pay_...', payment_url: '...' }
```

### Supported state actions

| `action` | Required fields | Description |
|----------|-----------------|-------------|
| `create_payment` | `amountUsd`, `recipientId` | Create payment intent |
| `verify_payment` | `paymentId` | Verify payment status |
| `check_rank` | `agentId` | Get AgentRank |
| `create_escrow` | `amountUsd`, `recipientId`, `memo` | Create escrow |

### Full example

See [`examples/langgraph-payment-node.ts`](../examples/langgraph-payment-node.ts)

---

## AutoGPT

### Install

```bash
pip install agentpay
```

### Setup

1. Copy [`examples/autogpt-plugin/agentpay.py`](../examples/autogpt-plugin/agentpay.py) to your AutoGPT plugins directory.
2. Add to your `.env`:
   ```
   AGENTPAY_API_KEY=sk_live_...
   ```
3. Enable in your AutoGPT config:
   ```yaml
   plugins:
     - agentpay
   ```

### Commands available to AutoGPT

| Command | Args | Description |
|---------|------|-------------|
| `agentpay_create_payment` | `amount_usd`, `recipient_id`, `memo` | Create payment |
| `agentpay_verify_payment` | `payment_id` | Verify status |
| `agentpay_check_rank` | `agent_id` | Get trust score |
| `agentpay_create_escrow` | `amount_usd`, `payee_id`, `task_description` | Escrow |

### Full example

See [`examples/autogpt-plugin/agentpay.py`](../examples/autogpt-plugin/agentpay.py)

---

## OpenAI Agents SDK

### Install

```bash
npm install openai @agentpay/sdk
```

### Chat Completions API

```typescript
import OpenAI from 'openai';
import { agentpayTools, handleAgentpayToolCall } from './examples/openai-function-calling/agentpay-tool';

const openai = new OpenAI();

const response = await openai.chat.completions.create({
  model: 'gpt-4o',
  messages: [
    { role: 'user', content: 'Pay $2 to agent-data-001 for the weather report' }
  ],
  tools: agentpayTools,
  tool_choice: 'auto',
});

// Handle tool calls
for (const toolCall of response.choices[0].message.tool_calls ?? []) {
  if (toolCall.function.name.startsWith('agentpay_')) {
    const result = await handleAgentpayToolCall({
      name: toolCall.function.name,
      arguments: toolCall.function.arguments,
    });
    console.log('Payment result:', result);
  }
}
```

### OpenAI Assistants API

```typescript
import { openAiAgentsTool } from './examples/openai-function-calling/agentpay-tool';

// Add to your assistant's tools list
const assistant = await openai.beta.assistants.create({
  name: 'Financial Agent',
  instructions: 'You can process payments using AgentPay tools.',
  tools: [{ type: 'function', function: openAiAgentsTool }],
  model: 'gpt-4o',
});
```

### Available tools

| Tool | Description |
|------|-------------|
| `agentpay_create_payment` | Create Solana or Stripe payment |
| `agentpay_verify_payment` | Verify payment status |
| `agentpay_check_agent_rank` | Get trust score (0-1000) |
| `agentpay_create_escrow` | Create protected escrow |
| `agentpay_approve_escrow` | Release escrowed funds |

### Full example

See [`examples/openai-function-calling/agentpay-tool.ts`](../examples/openai-function-calling/agentpay-tool.ts)

---

## Protocol Reference

AgentPay supports multiple payment protocols. Set `X-Protocol` header to choose:

| Protocol | Header value | Description |
|----------|--------------|-------------|
| **x402** | `x402` | HTTP 402 paywall standard |
| **ACP** | `acp` | Agent Communication Protocol |
| **AP2** | `ap2` | Agent Payment Protocol v2 |
| **Solana** | `solana` | Solana Pay native |
| **Stripe** | `stripe` | Card / bank fiat |

### Auto-detection

Send requests to `/api/protocol/detect` to let AgentPay identify the protocol from your request structure.

### x402 Middleware

```typescript
import { x402Paywall } from '../src/protocols/x402.js';

// Protect any route with a paywall
router.get('/premium-data', x402Paywall({ amountUsd: 100, resource: 'premium-data' }), handler);
```

---

## Webhook Events

Subscribe to events to react in real-time:

```typescript
await fetch('https://api.agentpay.gg/api/webhooks/subscribe', {
  method: 'POST',
  headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    url: 'https://yourapp.com/webhooks/agentpay',
    eventTypes: ['payment_verified', 'escrow_approved', 'rank_updated'],
  }),
});
```

Verify signatures using `X-AgentPay-Signature` header (HMAC-SHA256).

---

## Further Reading

- [Agent Onboarding Guide](./AGENT_ONBOARDING_GUIDE.md) — Step-by-step setup for new agents
- [API Reference (OpenAPI)](../openapi.yaml) — Full endpoint spec
- [Interactive API Docs](https://api.agentpay.gg/api/docs) — Swagger UI
- [Security Model](./SECURITY_MODEL.md) — How trust and verification works
- [Whitepaper](../AGENTPAY_WHITEPAPER.md) — Vision, economics, and architecture
