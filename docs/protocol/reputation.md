# Agent Reputation Engine

## Overview

The Agent Reputation Engine tracks the trustworthiness of agents (identified by their wallet/payer address) across payments processed through AgentPay. Every successful payment verification updates the agent's reputation record, enabling downstream systems to make informed decisions about payment handling.

## Data Model

Table: `agent_reputation`

| Column           | Type      | Description                                  |
|------------------|-----------|----------------------------------------------|
| `agent_id`       | VARCHAR   | Primary key — wallet/payer address           |
| `trust_score`    | INT       | Computed score in range [0, 100]             |
| `total_payments` | INT       | Cumulative payment verification count       |
| `success_rate`   | FLOAT     | Ratio of successful verifications           |
| `dispute_rate`   | FLOAT     | Ratio of disputed/failed payments           |
| `last_payment_at`| TIMESTAMP | Timestamp of most recent verification       |
| `created_at`     | TIMESTAMP | Record creation time                         |
| `updated_at`     | TIMESTAMP | Last update time                             |

## Trust Score Formula

The trust score is recomputed on every verification using a two-stage formula:

### 1. Raw Score

```
rawScore = 100 × successRate × (1 − disputeRate)
```

- `successRate` is the fraction of total payments that were successfully verified.
- `disputeRate` is the fraction of total payments that were disputed/failed after initial acceptance.
- A perfect agent with no disputes scores 100.

### 2. Time-Based Decay

To penalise inactive agents and prevent stale scores from appearing inflated:

```
decayFactor = e^(−λ × daysSinceLastPayment)
trustScore  = round(rawScore × decayFactor)
```

Where **λ = 0.005**:

| Days inactive | Decay factor |
|--------------|-------------|
| 0            | 1.000       |
| 40           | ~0.819      |
| 100          | ~0.607      |
| 200          | ~0.368      |

The final `trustScore` is clamped to **[0, 100]**.

## Verification Flow Integration

When a payment is verified (Solana on-chain confirmation), the following happens automatically:

1. `verifyAndUpdatePayment` in `transactionsService` calls the Solana RPC.
2. On success, `reputationService.updateReputationOnVerification(payerAddress, true)` is called asynchronously (non-blocking — never fails the API response).
3. The reputation record is upserted: `totalPayments` is incremented, `successRate` and `trustScore` are recomputed.

## API

### GET /api/agents/:agentId/reputation

Returns the current reputation for an agent.

**Parameters**

| Parameter | Type   | Description                        |
|-----------|--------|------------------------------------|
| `agentId` | string | The agent's wallet/payer address   |

**Response (200)**

```json
{
  "success": true,
  "reputation": {
    "agentId": "5YNmS1R9n7VBjnMjhkKLhUXZhiANpvKaQYV8j8PqD",
    "trustScore": 94,
    "totalPayments": 42,
    "successRate": 0.976,
    "disputeRate": 0.0,
    "lastPaymentAt": "2026-02-24T18:00:00.000Z",
    "createdAt": "2026-01-01T00:00:00.000Z",
    "updatedAt": "2026-02-24T18:00:00.000Z"
  },
  "fastTrackEligible": true
}
```

**Response (404)** — agent not found

```json
{ "error": "Agent reputation not found" }
```

## Fast-Track Verification (Stub)

`reputationService.shouldFastTrack(reputation)` returns `true` when an agent meets all of:

- `trustScore >= 80`
- `successRate >= 0.95`
- `totalPayments >= 10`

**This is a stub for future integration.** The intent is to allow the payment verification pipeline to skip certain on-chain confirmation steps for highly-trusted agents, reducing latency. Full integration is deferred to a future milestone.

## Future Work

- Increment `disputeRate` when a dispute event is received from a payment provider.
- Integrate `shouldFastTrack` into the Solana and Stripe confirmation paths.
- Add admin endpoint to manually adjust trust scores (with audit trail).
- Expose aggregate reputation statistics across all agents.
