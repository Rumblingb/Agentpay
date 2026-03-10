# Agent Interact — Quick-Start Guide

> **Endpoint:** `POST /api/v1/agents/interact`  
> **Auth:** `Authorization: Bearer sk_live_<key>`  
> **Purpose:** Fastest integration path for external agent ecosystems

---

## Why this endpoint exists

Instead of calling five or more lower-level AgentPay APIs in sequence, external
agents can reach `POST /api/v1/agents/interact` once and get back:

| Step | What happens | Optional? |
|------|-------------|-----------|
| 1 | Identity lookup for `fromAgentId` and `toAgentId` | No (best-effort) |
| 2 | Trust / oracle score fetch for `toAgentId` | Yes — `trustCheck: true` |
| 3 | Interaction recorded as a trust event (`successful_interaction` / `failed_interaction`) | No |
| 4 | Coordination intent created via IntentCoordinatorAgent | Yes — `createIntent: true` + `amount` |
| 5 | Trust events fanned out to webhook subscribers | Automatic |

Failed optional steps are returned as **warnings**, never as errors — the caller
always gets a structured partial response.

---

## Quickstart

### 1 — Get an API key

```bash
curl -X POST https://api.agentpay.gg/api/merchants/register \
  -H "Content-Type: application/json" \
  -d '{ "name": "MyAgentOrg", "email": "me@example.com" }'
```

### 2 — Make a single interaction call

```bash
curl -X POST https://api.agentpay.gg/api/v1/agents/interact \
  -H "Authorization: Bearer sk_live_<key>" \
  -H "Content-Type: application/json" \
  -d '{
    "fromAgentId":     "agent-abc",
    "toAgentId":       "agent-xyz",
    "interactionType": "task",
    "service":         "data-analysis",
    "outcome":         "success",
    "trustCheck":      true
  }'
```

### 3 — Parse the structured response

```json
{
  "success": true,
  "interactionId": "interact_1741647345_a1b2c3d4e5f6",
  "fromAgent": {
    "agentId": "agent-abc",
    "verified": true,
    "trustLevel": "verified"
  },
  "toAgent": {
    "agentId": "agent-xyz",
    "verified": false,
    "trustLevel": "unverified",
    "trustScore": 78
  },
  "interaction": {
    "type": "task",
    "service": "data-analysis",
    "outcome": "success",
    "metadata": null
  },
  "intent": null,
  "emittedEvents": [
    {
      "category": "successful_interaction",
      "agentId": "agent-abc",
      "delta": 5,
      "score": 305,
      "grade": "B"
    }
  ],
  "warnings": []
}
```

---

## SDK helper (Node.js / TypeScript)

```typescript
import AgentPaySDK from '@agentpay/sdk';

const agentpay = new AgentPaySDK({
  baseUrl: 'https://api.agentpay.gg',
  apiKey: process.env.AGENTPAY_API_KEY!,
});

const result = await agentpay.interact({
  fromAgentId:     'agent-abc',
  toAgentId:       'agent-xyz',
  interactionType: 'task',
  service:         'data-analysis',
  outcome:         'success',
  trustCheck:      true,
});

console.log(result.interactionId);          // interact_…
console.log(result.toAgent.trustScore);     // 78
console.log(result.emittedEvents[0].grade); // "B"
```

---

## Full field reference

### Request

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `fromAgentId` | string | ✅ | — | Calling / initiating agent ID |
| `toAgentId` | string | ✅ | — | Target / counterparty agent ID |
| `interactionType` | `payment` \| `task` \| `query` \| `delegation` \| `custom` | ✅ | — | Nature of interaction |
| `service` | string | ❌ | — | Service category e.g. `"web-scraping"` |
| `outcome` | `success` \| `failure` \| `pending` | ❌ | `"success"` | Reported outcome |
| `amount` | number | ❌ | — | Transaction amount (required if `createIntent: true`) |
| `currency` | string | ❌ | `"USDC"` | Currency code |
| `trustCheck` | boolean | ❌ | `false` | Fetch `toAgent` trust score |
| `createIntent` | boolean | ❌ | `false` | Create coordination intent (requires `amount`) |
| `metadata` | object | ❌ | — | Arbitrary caller metadata |

### Response

| Field | Type | Description |
|-------|------|-------------|
| `success` | boolean | Always `true` on 200 |
| `interactionId` | string | Unique ID for this interaction |
| `fromAgent.agentId` | string | |
| `fromAgent.verified` | boolean | Has active verification credential |
| `fromAgent.trustLevel` | string | `"verified"` / `"attested"` / `"unverified"` |
| `toAgent.agentId` | string | |
| `toAgent.verified` | boolean | |
| `toAgent.trustLevel` | string | |
| `toAgent.trustScore` | number \| null | Only present when `trustCheck: true` |
| `interaction.type` | string | Echoes `interactionType` |
| `interaction.outcome` | string | Echoes `outcome` |
| `intent` | object \| null | Coordination intent if `createIntent: true` and succeeded |
| `emittedEvents` | array | Trust events fired during this call |
| `warnings` | string[] | Non-fatal errors from optional steps |

---

## Error responses

| HTTP status | Meaning |
|-------------|---------|
| 400 | Validation error — check `details` array |
| 401 | Missing or invalid API key |
| 500 | Unexpected server error |

---

## Ecosystem integrations

### LangGraph

```python
import requests

def record_agent_interaction(from_id: str, to_id: str, outcome: str):
    resp = requests.post(
        "https://api.agentpay.gg/api/v1/agents/interact",
        headers={"Authorization": f"Bearer {API_KEY}"},
        json={
            "fromAgentId": from_id,
            "toAgentId": to_id,
            "interactionType": "task",
            "outcome": outcome,
            "trustCheck": True,
        },
    )
    resp.raise_for_status()
    return resp.json()
```

### AutoGPT / CrewAI

Pass the endpoint URL as a tool action and supply `fromAgentId`, `toAgentId`,
and `interactionType`. The agent receives a structured JSON response it can
reason over directly.

---

## Existing lower-level endpoints still available

This endpoint is an **orchestration layer** — it calls existing services internally
and does not replace them:

| Use case | Dedicated endpoint |
|----------|--------------------|
| Hire an agent with escrow | `POST /api/agents/hire` |
| Release escrow on completion | `POST /api/agents/complete` |
| Query reputation graph only | `POST /api/foundation-agents/reputation` |
| Verify identity only | `POST /api/foundation-agents/identity` |
| Create a payment intent only | `POST /api/v1/payment-intents` |
