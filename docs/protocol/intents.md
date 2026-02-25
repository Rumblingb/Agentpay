# Payment Intents

Payment Intents are the core primitive of the AgentPay Orchestration Layer.  
They represent a request for a payment and carry everything an agent needs to execute the transfer.

## POST `/api/intents`

**Auth:** Bearer API key (merchant)

**Request body:**

```json
{
  "amount": 1.50,
  "currency": "USDC",
  "metadata": { "orderId": "abc-123" }
}
```

| Field      | Type     | Required | Notes                     |
|------------|----------|----------|---------------------------|
| `amount`   | `number` | ✅        | Must be positive           |
| `currency` | `string` | ✅        | Only `USDC` supported now  |
| `metadata` | `object` | ❌        | Arbitrary key/value pairs  |

**Response `201`:**

```json
{
  "success": true,
  "intentId": "550e8400-e29b-41d4-a716-446655440000",
  "verificationToken": "APV_1700000000000_a1b2c3d4e5f60708",
  "expiresAt": "2024-01-01T00:30:00.000Z",
  "instructions": {
    "recipientAddress": "<merchant-wallet>",
    "memo": "APV_1700000000000_a1b2c3d4e5f60708",
    "solanaPayUri": "solana:<wallet>?amount=1.5&spl-token=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&memo=APV_..."
  }
}
```

The `verificationToken` doubles as the Solana Pay memo field. The payer must include it verbatim so the payment can be matched back to the intent.

Intents expire **30 minutes** after creation. After expiry the status transitions to `expired`.

---

## GET `/api/intents/:intentId/status`

**Auth:** Bearer API key (merchant)

**Response `200`:**

```json
{
  "success": true,
  "intentId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "pending",
  "amount": 1.5,
  "currency": "USDC",
  "expiresAt": "2024-01-01T00:30:00.000Z",
  "verificationToken": "APV_1700000000000_a1b2c3d4e5f60708"
}
```

Possible `status` values: `pending`, `paid`, `expired`.

---

## Non-custodial design

AgentPay **never holds funds**. The intent contains routing instructions only.  
The verification token in the Solana Pay memo field is the proof-of-payment hook used by Verification Certificates.
