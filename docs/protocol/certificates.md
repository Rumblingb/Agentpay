# Verification Certificates

A Verification Certificate is a tamper-proof, self-contained proof object that records the details of a verified payment.

Certificates are HMAC-SHA256 signed using `VERIFICATION_SECRET`. Any party with the secret can verify a certificate independently — no database round-trip required.

## Certificate structure

A certificate is a **base64-encoded JSON string**:

```json
{
  "payload": { "intentId": "...", "amount": 1.5, "currency": "USDC", "ts": 1700000000000 },
  "signature": "<hex-encoded HMAC-SHA256 of JSON.stringify(payload)>"
}
```

## POST `/api/certificates/validate`

**Auth:** Public (no API key required)

**Request body:**

```json
{
  "encoded": "<base64 certificate string>"
}
```

**Response `200` – valid:**

```json
{
  "valid": true,
  "payload": {
    "intentId": "550e8400-e29b-41d4-a716-446655440000",
    "amount": 1.5,
    "currency": "USDC",
    "ts": 1700000000000
  }
}
```

**Response `200` – invalid:**

```json
{
  "valid": false
}
```

---

## Signing a certificate (server-side)

```typescript
import { signCertificate } from '../services/certificateService';

const encoded = signCertificate({
  intentId: '550e8400-...',
  amount: 1.5,
  currency: 'USDC',
  ts: Date.now(),
});
```

## Validating a certificate (server-side)

```typescript
import { validateCertificate } from '../services/certificateService';

const payload = validateCertificate(encoded);
if (payload) {
  console.log('Valid certificate:', payload);
} else {
  console.log('Invalid or tampered certificate');
}
```

---

## Security notes

- Uses **timing-safe comparison** (`crypto.timingSafeEqual`) to prevent timing attacks.
- `VERIFICATION_SECRET` must be a cryptographically random string of at least 32 characters.
- Certificates do not expire on their own; embed a `ts` / `expiresAt` field in the payload and check it at validation time if needed.
