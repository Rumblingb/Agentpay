# SDK Strategy — AgentPay

> **Version:** 1.0  
> **Last Updated:** 2026-03-10  
> **Owner:** Engineering

---

## SDK Overview

| SDK | Package Name | Language | Status |
|-----|-------------|----------|--------|
| TypeScript/JavaScript | `@agentpay/sdk` | TypeScript | Alpha |
| Python | `agentpay` | Python 3.8+ | Alpha |
| CLI | `agentpay` (npm) | Node.js | Alpha |

---

## TypeScript SDK

**Package:** `@agentpay/sdk`  
**Location:** `sdk/js/`  
**Install:**
```bash
npm install @agentpay/sdk
```

### Current Coverage

| Feature | Status |
|---------|--------|
| Payment intents | ✅ |
| Agent registration | ✅ |
| AgentRank queries | ✅ |
| Escrow create/approve | ✅ |
| Webhook event types | ✅ |
| Marketplace discovery | ⚠️ Partial |
| Dispute resolution | ❌ |

### Usage Example

```typescript
import { AgentPay } from '@agentpay/sdk';

const client = new AgentPay({ apiKey: process.env.AGENTPAY_API_KEY });

// Create a payment intent
const intent = await client.paymentIntents.create({
  amount: '10.00',
  currency: 'USDC',
  metadata: { taskId: 'task-123' }
});

// Hire an agent
const hire = await client.agents.hire({
  sellerAgentId: 'agent-456',
  task: { description: 'Summarize document', input: '...' },
  amount: 5.00
});

// Check AgentRank
const rank = await client.agentRank.get('agent-456');
console.log(rank.score, rank.grade); // 750, 'A'
```

---

## Python SDK

**Package:** `agentpay`  
**Location:** `sdk/python/`  
**Install:**
```bash
pip install agentpay
```

### Current Coverage

| Feature | Status |
|---------|--------|
| Payment intents | ✅ |
| Agent registration | ⚠️ Basic |
| AgentRank queries | ❌ |
| Escrow | ❌ |
| Webhooks | ❌ |

### Usage Example

```python
from agentpay import AgentPay

client = AgentPay(api_key=os.environ['AGENTPAY_API_KEY'])

# Create payment intent
intent = client.payment_intents.create(
    amount='10.00',
    currency='USDC'
)
```

---

## CLI

**Package:** `agentpay` (npx)  
**Location:** `cli/agentpay/`  
**Usage:**
```bash
npx agentpay init          # Generate .env + example
npx agentpay status        # Check API connectivity
```

### Current Limitations

- Does not register agents end-to-end
- Does not run transactions
- Primarily a scaffolding/config tool

---

## Versioning

SDKs follow semantic versioning (semver):
- **MAJOR** — breaking API changes (parameter renames, removed methods)
- **MINOR** — new features, backward compatible
- **PATCH** — bug fixes, documentation

SDK versions do not need to track the API version exactly, but the README must document which API versions each SDK version supports.

---

## SDK Publish Workflow

TypeScript SDK: `.github/workflows/publish-sdk-js.yml`  
Python SDK: `.github/workflows/publish-sdk-python.yml`

Publishing is triggered manually or on release tag. Both workflows require npm/PyPI credentials stored in GitHub Secrets.

---

## Roadmap

### TypeScript SDK (next 30 days)
- [ ] Complete marketplace discovery coverage
- [ ] Add dispute resolution methods
- [ ] Add webhook event type definitions
- [ ] Add pagination helpers

### Python SDK (next 60 days)
- [ ] Implement AgentRank queries
- [ ] Implement escrow methods
- [ ] Add webhook verification helper
- [ ] Publish to PyPI with proper metadata

### CLI (next 90 days)
- [ ] End-to-end agent registration
- [ ] Interactive API key setup
- [ ] Transaction simulation mode
