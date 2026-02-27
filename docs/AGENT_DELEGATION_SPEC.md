# Agent Delegation Specification

## Overview

Delegated spending keys allow an AI agent to authorize sub-agents or services to spend on its behalf up to a defined limit, without exposing the primary private key.

## Non-Custodial Design

Private keys **never leave the device**. AgentPay only stores delegation metadata:
- `delegationId` - unique identifier
- `agentId` - owning agent
- `publicKey` - the delegated public key (hex-encoded DER)
- `spendingLimit` - maximum spend amount in USD
- `isActive` - whether delegation is currently active
- `expiresAt` - optional expiry timestamp
- `createdAt` - creation timestamp

## Lifecycle

1. **Create**: `POST /api/agents/delegation/create` with `agentId`, `publicKey`, and optional `spendingLimit`/`expiresAt`. Returns `delegationId`.
2. **Authorize**: `POST /api/agents/delegation/authorize` with `delegationId` and `agentId` to activate it.
3. **Revoke**: `POST /api/agents/delegation/revoke` with `delegationId` and `agentId` to deactivate it.

## Key Generation

Use the JS SDK helper:
```js
import { generateKeyPair } from 'agentpay/auth/keys';
const { publicKey, privateKey } = generateKeyPair();
// Store privateKey securely on device; send publicKey to the delegation API
```

## Security Notes

- Spending limits are enforced at the application layer during intent creation.
- Revoke delegations immediately when a sub-agent is decommissioned.
- Keys are Ed25519; signatures are hex-encoded.
