# AgentPay Webhook Delivery System (V2)

The V2 webhook system lets merchants subscribe to specific event types and receive signed HTTP POST notifications when those events occur.

---

## Overview

| Feature | Description |
|---|---|
| Transport | HTTPS POST |
| Signing | HMAC-SHA256 (`X-AgentPay-Signature: sha256=<hex>`) |
| Retry schedule | 1 s → 10 s → 60 s (3 total attempts) |
| Auth required | `Authorization: Bearer <apiKey>` |

---

## Supported Event Types

| Event Type | Trigger |
|---|---|
| `payment_verified` | A payment intent has been verified on-chain |

---

## Endpoints

### Subscribe to Webhooks

```
POST /api/webhooks/subscribe
Authorization: Bearer <apiKey>
Content-Type: application/json
```

**Request body**

```json
{
  "url": "https://your-server.example.com/webhook",
  "eventTypes": ["payment_verified"]
}
```

**Response `201`**

```json
{
  "success": true,
  "subscription": {
    "id": "uuid",
    "merchantId": "uuid",
    "url": "https://your-server.example.com/webhook",
    "eventTypes": ["payment_verified"],
    "createdAt": "2026-01-01T00:00:00.000Z"
  }
}
```

**Validation errors `400`**

- `url` must be a valid HTTPS URL.
- `eventTypes` must be a non-empty array containing only supported event types.

---

### List Subscriptions

```
GET /api/webhooks
Authorization: Bearer <apiKey>
```

**Response `200`**

```json
{
  "success": true,
  "subscriptions": [
    {
      "id": "uuid",
      "merchantId": "uuid",
      "url": "https://your-server.example.com/webhook",
      "eventTypes": ["payment_verified"],
      "createdAt": "2026-01-01T00:00:00.000Z"
    }
  ]
}
```

---

### Delete a Subscription

```
DELETE /api/webhooks/:id
Authorization: Bearer <apiKey>
```

**Response `200`**

```json
{ "success": true }
```

**`404`** — Subscription not found or does not belong to the authenticated merchant.

---

## Payload

When a `payment_verified` event is triggered, AgentPay sends the following JSON body to each matching subscription URL:

```json
{
  "type": "payment_verified",
  "intentId": "<transactionId>",
  "txHash": "<on-chain transaction signature>",
  "amount": 100.0,
  "certificate": "<optional certificate string>"
}
```

---

## Signature Verification

Every delivery includes an `X-AgentPay-Signature` header:

```
X-AgentPay-Signature: sha256=<hex-encoded HMAC-SHA256>
```

The HMAC is computed over the raw JSON request body using the `WEBHOOK_SECRET` environment variable.

**Node.js verification example**

```js
const crypto = require('crypto');

function verifySignature(rawBody, signatureHeader, secret) {
  const expected = 'sha256=' + crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(expected),
    Buffer.from(signatureHeader)
  );
}
```

---

## Retry Logic

Deliveries are retried up to **3 times total** with increasing wait before each retry:

| Attempt | Delay before attempt |
|---------|---------------------|
| 1       | Immediate            |
| 2       | 1 second             |
| 3       | 10 seconds           |

If all attempts fail, the delivery log is marked `failed`.

---

## Delivery Logs

Each delivery attempt is recorded in the `webhook_delivery_logs` table:

| Column | Type | Description |
|---|---|---|
| `id` | UUID | Log ID |
| `subscription_id` | UUID | FK to `webhook_subscriptions` |
| `payload` | JSONB | Delivered payload |
| `status` | VARCHAR | `pending` / `sent` / `failed` |
| `attempts` | INT | Number of attempts made |
| `last_attempt_at` | TIMESTAMP | Timestamp of last attempt |

---

## Environment Variables

```env
# Shared secret for HMAC-SHA256 webhook signing
WEBHOOK_SECRET=change-me-to-a-random-32-char-string
```

> The `WEBHOOK_SECRET` is distinct from any certificate signing secret and should be kept confidential.
