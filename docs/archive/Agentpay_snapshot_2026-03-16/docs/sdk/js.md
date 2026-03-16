# AgentPay JavaScript / TypeScript SDK

The `@agentpay/sdk` package is an ESM-first TypeScript library for interacting with the AgentPay API from Node.js (≥ 20) or any modern browser/edge runtime that exposes the global `fetch` API.

## Installation

```bash
npm install @agentpay/sdk
# or
pnpm add @agentpay/sdk
```

## Quick start

```ts
import {
  createIntent,
  getIntentStatus,
  waitForVerification,
  validateCertificate,
} from '@agentpay/sdk';

const config = {
  baseUrl: 'https://api.agentpay.gg',
  apiKey: process.env.AGENTPAY_API_KEY!,
};

// 1. Create a payment intent
const intent = await createIntent(config, 500, { orderId: 'ord_abc' });
console.log(intent.intentId); // "intent_xyz"

// 2. Poll until verified (throws on expiry / failure / timeout)
const verified = await waitForVerification(config, intent.intentId);
console.log(verified.status); // "verified"

// 3. Validate an agent certificate
const result = await validateCertificate(config, {
  certificate: '<base64-encoded-cert>',
  algorithm: 'RS256',
});
console.log(result.valid); // true
```

## API reference

All functions accept an `AgentPayConfig` object as their first argument.

```ts
interface AgentPayConfig {
  baseUrl: string;   // e.g. "https://api.agentpay.gg"
  apiKey: string;
  timeoutMs?: number; // default 10 000
}
```

### `createIntent(config, amount, metadata?)`

Creates a new payment intent.

| Parameter  | Type                         | Description                        |
|------------|------------------------------|------------------------------------|
| `config`   | `AgentPayConfig`             | SDK configuration                  |
| `amount`   | `number`                     | Amount to charge                   |
| `metadata` | `Record<string, unknown>`    | Optional key/value metadata        |

**Returns** `Promise<CreateIntentResponse>`

---

### `getIntentStatus(config, intentId)`

Retrieves the current status of a payment intent.

**Endpoint:** `GET /api/intents/:intentId/status`

**Returns** `Promise<IntentStatusResponse>`

---

### `waitForVerification(config, intentId, timeoutMs?, pollIntervalMs?)`

Polls `getIntentStatus` until the intent is `verified`, `expired`, or `failed`, or until `timeoutMs` elapses.

| Parameter        | Type     | Default   |
|------------------|----------|-----------|
| `timeoutMs`      | `number` | `60_000`  |
| `pollIntervalMs` | `number` | `2_000`   |

**Throws**

- `IntentExpiredError` — intent reached `expired` status
- `VerificationFailedError` — intent reached `failed` status
- `VerificationTimeoutError` — polling timed out

**Returns** `Promise<IntentStatusResponse>`

---

### `validateCertificate(config, certificate)`

Validates an agent certificate against the AgentPay certificate store.

**Endpoint:** `POST /api/certificates/validate`

**Returns** `Promise<ValidateCertificateResponse>`

---

## Error classes

| Class                    | `code`                | HTTP status |
|--------------------------|-----------------------|-------------|
| `AgentPayError`          | varies                | varies      |
| `IntentExpiredError`     | `INTENT_EXPIRED`      | 410         |
| `VerificationFailedError`| `VERIFICATION_FAILED` | 402         |
| `VerificationTimeoutError`| `VERIFICATION_TIMEOUT`| 408        |

All error classes extend `AgentPayError` which extends `Error`.

```ts
import { AgentPayError, IntentExpiredError } from '@agentpay/sdk';

try {
  await waitForVerification(config, 'intent_123');
} catch (err) {
  if (err instanceof IntentExpiredError) {
    console.error('Intent expired:', err.intentId);
  } else if (err instanceof AgentPayError) {
    console.error('API error:', err.message, err.statusCode, err.code);
  }
}
```

## Building from source

```bash
cd sdk/js
npm install
npm run build   # emits ESM to dist/
npm test        # Jest unit tests with mocked fetch
```
