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
Returns: `{ success: true, credential: { credentialId, agentId, trustLevel, expiresAt, keyMode, proofVerificationMode, ... } }`

**Trust levels in beta:**
- `attested` — maximum achievable in beta (proof verification stubs are active, or key is ephemeral)
- `self-reported` — no proofs supplied

`verified` trust level is reserved for when `proofVerificationMode = "live"` and `keyMode = "configured"`. It will not be issued while stubs are active.

**Response fields:**
- `keyMode: "configured" | "ephemeral"` — `"ephemeral"` means the signing key is per-process; credential will be unverifiable after restart
- `proofVerificationMode: "beta_stub" | "live"` — `"beta_stub"` means no real cryptographic or deployment verification was performed

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
  "proofs": []
}
```
`operatorId` and `requestingOperatorId` are **NOT accepted** in this request body — the authenticated merchant (your API key) is used automatically as the billing and ownership operator. Any such field supplied would be ignored.

Returns: `{ success: true, link: { linkId, primaryAgentId, linkedAgentIds, ... } }`

### Pricing
| Action | Fee |
|---|---|
| `verify` (basic) | $10 |
| `link` (advanced) | $50 |
| `verify_credential`, `get_identity` | Free |

### Environment
- `IDENTITY_VERIFIER_PRIVATE_KEY` — hex secret for HS256 credential signing.
  **Required in production.** If not set, a random ephemeral key is generated per process.
  Credentials issued with an ephemeral key are unverifiable after a server restart.
  Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

### Beta Limitations
- **`_betaStub_verifySignatureProof`** — always returns `true`. Signature proofs do not add cryptographic weight in beta. The method logs a `[IdentityVerifierAgent] BETA` warning to server logs on each call.
- **`_betaStub_verifyDeploymentProof`** — always returns `true`. Deployment environment claims are not independently verified in beta.
- Because stubs are active, `proofVerificationMode` is always `"beta_stub"` and trust level is capped at `"attested"`.
- The `"verified"` trust level will only be issued when both `IDENTITY_VERIFIER_PRIVATE_KEY` is configured **and** real proof verification is implemented.

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

Returns: `{ success: true, disputeCase: { caseId, status, respondent, notificationMode, filedAt, ... } }`

**`notificationMode` in response:**
- `"disabled"` (current beta state) — parties were NOT automatically notified. You must manually inform the respondent of the case ID, claim, and evidence deadline.
- `"live"` — automatic email/webhook notification was sent (not yet implemented).

⚠️ **Beta warning:** In the current implementation, `notificationMode` is always `"disabled"`. The respondent is never notified automatically. Do not assume the other party has been informed.

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
  "toAgent": "<uuid>",
  "amount": 100,
  "currency": "USD",
  "purpose": "Data processing task",
  "metadata": {}
}
```
`fromAgent` is NOT required and is **ignored if supplied** — the authenticated merchant (your API key) is always used as the billing `fromAgent`. Supplying it in the request body has no effect and does not change who is billed.

Returns a `CoordinatedTransaction` with `intentId`, `status`, `route`, `steps`, `executionMode`.

**`executionMode` in response:**
- `"simulated"` (current beta state) — no real API call was made; no funds moved. Step records and `externalTxId` placeholders are created for integration testing only.
- `"live"` — real protocol execution occurred (not yet implemented for any protocol).

⚠️ **Beta warning:** `executionMode` is always `"simulated"`. `externalTxId` values in step details are randomly generated placeholders. Do NOT use `status: "completed"` to confirm payment when `executionMode` is `"simulated"`.

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

### Beta Limitations
Protocol execution methods (Stripe, Solana, x402, AP2, bank) create step records but
do not make live API calls. `executionMode: "simulated"` is always set on responses.
Each `executeVia*` method has a `SIMULATED STUB` doc comment and logs a `[IntentCoordinatorAgent] BETA` warning per call.

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

## Authentication

All `POST /api/foundation-agents/*` action endpoints require a merchant API key.

```
Authorization: Bearer sk_live_...
# or
x-api-key: sk_live_...
```

The `GET /api/foundation-agents` discovery manifest is public (no auth required).

Without a valid API key, all action endpoints return:
```json
{ "code": "AUTH_MISSING", "message": "Provide a token or API key." }
```

**Billing note:** The authenticated merchant ID is used as the billing operator for all fee-charging actions. You cannot bill fees to another merchant's account by supplying a different `requestingOperatorId` or `fromAgent` in the request body — those fields are overridden server-side.

---

## Error Responses

All endpoints return `{ error: string }` with an appropriate HTTP status code.

Common errors:
- `401` — Missing or invalid API key
- `400` — `"Invalid action"` (unknown action string)
- `404` — `"Agent not found"`, `"Transaction not found"`, `"Dispute not found"`
- `403` — `"Only transaction parties can file disputes"`, `"Ownership verification failed"`
- `500` — unexpected internal errors (full message returned for debugging)

---

## Integration Patterns

### Before hiring an unknown agent
```typescript
// All action endpoints require auth
const headers = {
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${process.env.AGENTPAY_API_KEY}`,
};

// 1. Check reputation
const rep = await fetch('/api/foundation-agents/reputation', {
  method: 'POST',
  headers,
  body: JSON.stringify({
    action: 'get_trust_score',
    agentId: targetAgentId,
    // requestingAgentId is NOT needed — your API key determines billing
  }),
}).then(r => r.json());

if (rep.trustScore < 50) {
  console.warn('Low trust score — proceed with caution');
}

// 2. Verify their identity
const identity = await fetch('/api/foundation-agents/identity', {
  method: 'POST',
  headers,
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

## Beta Limitations

The following table describes what is functional, what is beta-safe, and what is still a stub. Do not mistake "functional" for "production-complete".

| Area | Status | Detail |
|---|---|---|
| Auth on action routes | ✅ Done | `authenticateApiKey` required on all `POST` routes |
| `GET /api/foundation-agents` manifest | ✅ Public | No auth required |
| Merchant-enforced billing | ✅ Done | `req.merchant.id` used server-side; caller cannot override billing operator |
| Fee recording | ✅ Functional | Creates `agent_fee_transactions` rows |
| Credential signature (HS256) | ✅ Functional | Works when `IDENTITY_VERIFIER_PRIVATE_KEY` is configured |
| `IDENTITY_VERIFIER_PRIVATE_KEY` | ⚠️ Required for prod | Startup warning logged when missing; ephemeral key used as fallback |
| Credential `keyMode` + `proofVerificationMode` | ✅ Done | Both fields present in all credential responses |
| `verified` trust level | ⚠️ Blocked | Capped at `attested` while proof stubs are active |
| `_betaStub_verifySignatureProof` | ⚠️ Stub | Always returns `true`; logs `[IdentityVerifierAgent] BETA` warning |
| `_betaStub_verifyDeploymentProof` | ⚠️ Stub | Always returns `true`; logs `[IdentityVerifierAgent] BETA` warning |
| Dispute `notificationMode` | ✅ Done | Field present; always `"disabled"` in beta |
| `notifyRespondent` | ⚠️ Stub | No-op; logs `[DisputeResolverAgent] BETA` warning with case ID |
| `beginResolution` | ⚠️ Stub | No-op; logs warning; disputes stay `"under_review"` until manually resolved |
| `notifyResolution` | ⚠️ Stub | No-op; logs warning |
| Intent `executionMode` | ✅ Done | Field present; always `"simulated"` in beta |
| IntentCoordinator — all protocol execution | ⚠️ Simulated | Steps recorded, no real API calls; `simulated: true` in step details |
| `IDENTITY_VERIFIER_PRIVATE_KEY` rotation | Not implemented | One key; rotation path not built |
| Foundation agent fee real debit | Not implemented | Fee rows created; no real token transfer |

See `docs/FOUNDATION_AGENTS_SHIP_CHECKLIST.md` for the pre-production gate.
