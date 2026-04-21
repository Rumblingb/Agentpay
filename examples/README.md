# Examples

Runnable examples for integrating AgentPay into agents, frameworks, and backend services.

All examples call the live API at `api.agentpay.so`. You need an API key — get one in 30 seconds:

```bash
curl -s -X POST https://api.agentpay.so/api/merchants/register \
  -H "Content-Type: application/json" \
  -d '{ "name": "My Agent", "email": "you@example.com" }'
```

---

## agents/

Standalone example agents that demonstrate different task types. Each has its own `README.md` and `package.json`.

| Agent | What it does |
|-------|-------------|
| `ResearchAgent/` | Searches and summarises web content; charges per task via AgentPay mandate |
| `WebScraperAgent/` | Firecrawl-backed scraper using the Capability Vault — no raw API key exposed |
| `SummarizerAgent/` | LLM summarisation with per-call billing |
| `TranslatorAgent/` | Translation service registered on the AgentPay network |
| `ImageGenAgent/` | Image generation with AgentPay payment gate |
| `DataCleanerAgent/` | Tabular data cleaning with mandate-based billing |
| `CodeReviewAgent/` | Code review as a paid agent service |
| `HumanProxyBuyerAgent/` | Demonstrates the human-in-the-loop funding request flow |

### Run any agent

```bash
cd examples/agents/ResearchAgent
npm install
AGENTPAY_API_KEY=apk_... AGENTPAY_MERCHANT_ID=mer_... node server.js
```

---

## adapters/

Integration examples for popular AI frameworks and demo scripts.

| File | What it shows |
|------|--------------|
| `semiLiveDemo.ts` | Full `create → approve → execute` mandate flow against the live API — best first example |
| `toolCallingAgentExample.ts` | OpenAI function calling + AgentPay payment gate |
| `genericAgentExample.ts` | Framework-agnostic agent loop with AgentPay |
| `internalEndToEndDemo.ts` | End-to-end test covering mandate, capability vault, and receipt |

### Quickest demo (no framework needed)

```bash
cd examples/adapters
npm install
AGENTPAY_API_KEY=apk_... npx tsx semiLiveDemo.ts
```

This runs a complete `create → policy check → approve → execute → receipt` flow in one script. Good for verifying your API key works before building.

---

## node-backend-agent/

A minimal Node.js backend that registers as an AgentPay agent, exposes a task endpoint, and bills callers via the mandate system. Good starting point for building a paid agent service.

```bash
cd examples/node-backend-agent
npm install
AGENTPAY_API_KEY=apk_... AGENTPAY_MERCHANT_ID=mer_... node index.js
```

---

## Framework adapters (root level)

| File | Framework |
|------|-----------|
| `langgraph-payment-node.ts` | LangGraph — AgentPay as a payment node in a graph |
| `crewai-agentpay-tool.py` | CrewAI — AgentPay as a tool in a crew |
| `autogpt-plugin/` | AutoGPT plugin |

### LangGraph

```bash
AGENTPAY_API_KEY=apk_... npx tsx langgraph-payment-node.ts
```

### CrewAI

```bash
pip install agentpay
AGENTPAY_API_KEY=apk_... python crewai-agentpay-tool.py
```

---

## Environment variables

All examples read from the same two env vars:

```bash
AGENTPAY_API_KEY=apk_...       # Required — your merchant API key
AGENTPAY_MERCHANT_ID=mer_...   # Recommended — your merchant ID
AGENTPAY_API_URL=...           # Optional — override to point at local dev server
```
