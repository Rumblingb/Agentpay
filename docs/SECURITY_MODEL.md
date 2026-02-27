# AgentPay Security Model

## Authentication

- **Merchant API Key**: Bearer token in `Authorization: Bearer <key>` header. Used for merchant-facing routes.
- **Agent Identity + PIN**: Agents register with a PIN (bcrypt-hashed, 12 rounds). PIN is verified before high-value operations.
- **Delegation Keys**: Ed25519 keypairs; public key stored server-side, private key stays on device.

## Transport Security

- All API traffic must use HTTPS in production.
- CORS is restricted to configured `CORS_ORIGIN` environment variable.
- Helmet.js headers are applied to all responses.

## Rate Limiting

- Global: 100 requests per 15 minutes per IP.
- Verify endpoint: 20 requests per minute per IP.

## Webhook Signatures

All outgoing webhooks are signed with HMAC-SHA256 using a per-subscription secret. Signature format: `sha256=<hex>`.

Verify with:
```js
import { verifyWebhookSignature } from 'agentpay/webhooks/handler';
const valid = verifyWebhookSignature(rawBody, req.headers['x-agentpay-signature'], secret);
```

## Transaction Verification

Public endpoint `GET /api/verify/:txHash` returns an HMAC-signed payload so downstream consumers can verify the response integrity without trusting the transport layer alone.

## Secrets Management

Never commit secrets. Use environment variables:
- `DATABASE_URL` - Postgres connection string
- `STRIPE_SECRET_KEY` - Stripe secret key
- `WEBHOOK_SECRET` / `AGENTPAY_HMAC_SECRET` - HMAC signing secret
- `API_KEY_SALT` - Salt for API key hashing
