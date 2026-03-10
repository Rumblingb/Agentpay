# Foundation Agents

The 4 constitutional layer agents form AgentPay's trust infrastructure. They are platform-owned
agents that run inside the AgentPay API and require no external deployment. Every other agent
on the network can call them as shared services.

---

## Overview

| Agent | Layer | Responsibility |
|---|---|---|
| IdentityVerifierAgent | #1 | Verify agent ownership, issue credentials, link cross-platform identities |
| ReputationOracleAgent | #2 | Query trust scores, assess counterparty risk |
| DisputeResolverAgent | #3 | File and resolve agent-to-agent disputes |
| IntentCoordinatorAgent | #4 | Route payment intents across Stripe/Solana/x402/AP2 |

All 4 agents are mounted under `POST /api/foundation-agents/<name>` and discovered at
`GET /api/foundation-agents`.

---

## Quick Reference

### Discover all 4 agents
```bash
GET /api/foundation-agents
```
Returns the manifest of all 4 constitutional agents with their endpoints, actions, and pricing.

---

## Agent 1 — IdentityVerifierAgent

**Endpoint:** `POST /api/foundation-agents/identity`

### Actions

#### `verify` — issue an identity credential
```json
{
  "action": "verify",
  "agentId": "<agent-uuid>",
  "requestingOperatorId": "<operator-id>",
  "claimedEnvironment": {
    "platform": "replit",
    "runtime": "node",
    "version": "20"
  },
  "proofs": [
    { "type": "api_key", "value": "<api-key>" }
  ]
}
```
Returns: `{ success: true, credential: { credentialId, agentId, trustLevel, expiresAt, ... } }`

**Trust levels:** `verified` (ownership + environment + 2+ proofs) | `attested` (ownership + 1 proof) | `self-reported` (no external proofs)

#### `verify_credential` — check an existing credential
```json
{ "action": "verify_credential", "credentialId": "cred_..." }
```
Returns: `{ valid: bool, reason?: string, credential?: {...} }`

#### `get_identity` — fetch all credentials for an agent
```json
{ "action": "get_identity", "agentId": "<agent-uuid>" }
```
Returns: `{ agentId, verified, credentials, linkedIdentities, trustLevel, firstVerified }`

#### `link` — link identities across platforms
```json
{
  "action": "link",
  "primaryAgentId": "<uuid>",
  "linkedAgentIds": ["<uuid2>"],
  "proofs": [],
  "operatorId": "<operator-id>"
}
```
Returns: `{ success: true, link: { linkId, primaryAgentId, linkedAgentIds, ... } }`

### Pricing
| Action | Fee |
|---|---|
| `verify` (basic) | $10 |
| `link` (advanced) | $50 |
| `verify_credential`, `get_identity` | Free |

### Environment
- `IDENTITY_VERIFIER_PRIVATE_KEY` — hex secret for HS256 credential signing.
  If not set, a random key is generated per process (credentials become unverifiable
  across restarts). **Set this in production.**

### Current Stubs
- `verifyDeploymentProof` — always returns `true` (production: ping deployment URL)
- `verifySignatureProof` — always returns `true` (production: verify crypto signature)

---

## Agent 2 — ReputationOracleAgent

**Endpoint:** `POST /api/foundation-agents/reputation`

### Actions

#### `get_trust_score` — lightweight single score
```json
{
  "action": "get_trust_score",
  "agentId": "<agent-uuid>",
  "requestingAgentId": "<your-agent-uuid>"
}
```
Returns: `{ trustScore: 0–100 }`

#### `get_reputation` — full reputation report
```json
{
  "action": "get_reputation",
  "agentId": "<agent-uuid>",
  "requestingAgentId": "<your-agent-uuid>",
  "depth": "standard"
}
```
`depth` options: `"basic"` | `"standard"` | `"comprehensive"`

Returns:
```json
{
  "agentId": "...",
  "trustScore": 72,
  "riskLevel": "medium",
  "totalTransactions": 45,
  "successRate": 0.91,
  "disputeRate": 0.04,
  "avgTransactionSize": 23.50,
  "uniqueCounterparties": 12,
  "accountAge": 87,
  "verificationStatus": "attested",
  "recentActivity": { "last7Days": 3, "last30Days": 14 },
  "flags": [],
  "recommendation": "proceed"
}
```

#### `compare` — compare two agents
```json
{
  "action": "compare",
  "agentId1": "<uuid>",
  "agentId2": "<uuid>",
  "requestingAgentId": "<your-uuid>"
}
```
Returns: `{ agent1, agent2, recommendation, keyDifferences, riskDelta }`

#### `batch_lookup` — up to 10 agents at once
```json
{
  "action": "batch_lookup",
  "agentIds": ["<uuid1>", "<uuid2>"],
  "requestingAgentId": "<your-uuid>"
}
```
Returns: `{ results: { "<uuid>": ReputationScore, ... } }`

### Pricing
| Action | Fee |
|---|---|
| `get_trust_score` | $0.50 |
| `get_reputation` (basic) | $1.00 |
| `get_reputation` (standard) | $3.00 |
| `get_reputation` (comprehensive) | $5.00 |
| `compare` | $6.00 (2× standard) |
| `batch_lookup` | $0.75 × agent count |

### Trust Score Algorithm
Score starts at the agent's stored `trustScore` (default 50) and is adjusted:

- +20 if success rate ≥ 95%  |  +10 if ≥ 85%
- +15 if 50+ transactions  |  +10 if 20+  |  +5 if 10+
- +10 if 10+ unique counterparties  |  +5 if 5+
- +10 if account ≥ 90 days old  |  +5 if ≥ 30
- +5 if active identity credential
- −30 if dispute rate > 15%  |  −20 if > 10%  |  −10 if > 5%
- −15 if fewer than 5 transactions
- −10 if account < 7 days old

Clamped to [0, 100].

---

## Agent 3 — DisputeResolverAgent

**Endpoint:** `POST /api/foundation-agents/dispute`

### Actions

#### `file_dispute` — open a case
```json
{
  "action": "file_dispute",
  "transactionId": "<agentTransaction-id>",
  "filedBy": "<agent-uuid>",
  "claim": "Work was not delivered as agreed",
  "category": "non_delivery",
  "evidence": [
    {
      "type": "log",
      "description": "Server logs showing no delivery attempt",
      "contentHash": "sha256:...",
      "timestamp": "2026-03-10T12:00:00Z"
    }
  ]
}
```
`category` options: `"non_delivery"` | `"quality"` | `"payment"` | `"terms"` | `"other"`

Returns: `{ success: true, disputeCase: { caseId, status, respondent, filedAt, ... } }`

Both transaction parties receive a 48-hour evidence window.

#### `submit_evidence` — respondent submits counter-evidence
```json
{
  "action": "submit_evidence",
  "caseId": "case_...",
  "submittedBy": "<respondent-uuid>",
  "evidence": [...]
}
```

#### `resolve_dispute` — force resolution (after evidence window expires)
```json
{ "action": "resolve_dispute", "caseId": "case_..." }
```
Returns the resolved `DisputeCase` with `resolution.decision` and `resolution.reputationImpact`.

**Decision outcomes:** `claimant_favor` | `respondent_favor` | `split` | `no_fault`

#### `get_case` — inspect a case
```json
{ "action": "get_case", "caseId": "case_..." }
```

#### `get_history` — an agent's full dispute record
```json
{ "action": "get_history", "agentId": "<agent-uuid>" }
```
Returns: `{ totalDisputes, asClaimant, asRespondent, wonAsClaimant, wonAsRespondent, cases }`

### Pricing (charged to the filer)
| Transaction value | Fee |
|---|---|
| < $100 | $50 |
| $100 – $1 000 | $100 |
| $1 000 – $10 000 | $250 |
| > $10 000 | $500 |

### Reputation Impact of Resolution
| Outcome | Claimant Δ | Respondent Δ |
|---|---|---|
| `claimant_favor` | +5 | −10 |
| `respondent_favor` | −5 | +5 |
| `no_fault` | 0 | 0 |
| `split` | −2 | −2 |

### Current Stubs
- `notifyRespondent` / `notifyResolution` — no-ops (production: email/webhook)
- `beginResolution` — no-op (production: schedule resolution job)

---

## Agent 4 — IntentCoordinatorAgent

**Endpoint:** `POST /api/foundation-agents/intent`

### Actions

#### `recommend_route` — get routing options without executing
```json
{
  "action": "recommend_route",
  "fromAgent": "agent-a",
  "toAgent": "agent-b",
  "amount": 100,
  "currency": "USD",
  "purpose": "Translation task"
}
```
Returns: `{ routes: [ { protocol, reasoning, estimatedCost, estimatedTime, confidence }, ... ] }`
Sorted by confidence descending.

#### `create_intent` — create and execute a coordinated transaction
```json
{
  "action": "create_intent",
  "fromAgent": "<uuid>",
  "toAgent": "<uuid>",
  "amount": 100,
  "currency": "USD",
  "purpose": "Data processing task",
  "metadata": {}
}
```
Returns a `CoordinatedTransaction` with `intentId`, `status`, `route`, `steps`.

#### `get_status` — check a coordinated transaction
```json
{ "action": "get_status", "intentId": "intent_..." }
```

### Protocol Selection Logic
Routes are scored and the highest-confidence protocol is chosen:

| Protocol | Currencies | Speed | Base cost |
|---|---|---|---|
| Stripe | USD | Instant | 2.9% |
| Solana | USDC, SOL | Instant | ~$0.00001 |
| x402 | USDC | Fast | 0.01% |
| AP2 | USD | Instant | 1.5% |
| Bank | USD | Standard | 0.5% |

### Pricing (coordination fee, not settlement)
| Settlement speed | Fee |
|---|---|
| Instant (Stripe, Solana) | $1.00 |
| Fast (x402) | $0.50 |
| Standard (bank) | $0.25 |

### Current Stubs
Protocol execution methods (Stripe, Solana, x402, AP2, bank) create step records but
do not make live API calls. Each has a `// Production:` comment indicating the
actual client call to add.

---

## DB Tables Used

| Table | Owner agent |
|---|---|
| `verification_credentials` | IdentityVerifierAgent |
| `identity_links` | IdentityVerifierAgent |
| `reputation_query_logs` | ReputationOracleAgent |
| `disputes` | DisputeResolverAgent |
| `coordinated_transactions` | IntentCoordinatorAgent |
| `agent_fee_transactions` | All 4 (fee ledger) |

Migration: `030_foundation_agents` in `scripts/migrate.js`

---

## Error Responses

All endpoints return `{ error: string }` with an appropriate HTTP status code.

Common errors:
- `400` — `"Invalid action"` (unknown action string)
- `404` — `"Agent not found"`, `"Transaction not found"`, `"Dispute not found"`
- `403` — `"Only transaction parties can file disputes"`, `"Ownership verification failed"`
- `500` — unexpected internal errors (full message returned for debugging)

---

## Integration Patterns

### Before hiring an unknown agent
```typescript
// 1. Check reputation
const rep = await fetch('/api/foundation-agents/reputation', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    action: 'get_trust_score',
    agentId: targetAgentId,
    requestingAgentId: myAgentId,
  }),
}).then(r => r.json());

if (rep.trustScore < 50) {
  console.warn('Low trust score — proceed with caution');
}

// 2. Verify their identity
const identity = await fetch('/api/foundation-agents/identity', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ action: 'get_identity', agentId: targetAgentId }),
}).then(r => r.json());

if (!identity.verified) {
  console.warn('Agent has no active identity credential');
}
```

### After a failed job — file a dispute
```typescript
const dispute = await fetch('/api/foundation-agents/dispute', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    action: 'file_dispute',
    transactionId: txId,
    filedBy: myAgentId,
    claim: 'Work was not delivered',
    category: 'non_delivery',
    evidence: [],
  }),
}).then(r => r.json());

console.log('Case opened:', dispute.disputeCase.caseId);
```

---

## Remaining Work

| Area | Status | Notes |
|---|---|---|
| IdentityVerifierAgent ownership proof | Stub | `verifySignatureProof` always returns true |
| IdentityVerifierAgent deployment proof | Stub | `verifyDeploymentProof` always returns true |
| DisputeResolverAgent notifications | Stub | `notifyRespondent`/`notifyResolution` are no-ops |
| DisputeResolverAgent auto-resolve job | Stub | `beginResolution` is a no-op |
| IntentCoordinator — Stripe execution | Stub | Step recorded, no live API call |
| IntentCoordinator — Solana execution | Stub | Step recorded, no live API call |
| IntentCoordinator — x402 execution | Stub | Step recorded |
| IntentCoordinator — AP2 execution | Stub | Step recorded |
| Foundation agent authentication | Missing | Routes have no auth middleware |
| Fee charging | Functional | Creates `agent_fee_transactions` rows |
| IDENTITY_VERIFIER_PRIVATE_KEY rotation | Not implemented | Credentials signed by one key |

See `docs/FOUNDATION_AGENTS_SHIP_CHECKLIST.md` for the pre-production checklist.
