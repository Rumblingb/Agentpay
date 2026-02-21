# AgentPay — Security Policy

## 1. API Key Management

### Generation
- Each API key is 32 random bytes encoded as a 64-character hex string.
- Keys are generated server-side using `crypto.randomBytes(32)`.
- The plaintext key is returned to the merchant **once** at registration; it is never stored.

### Storage (PBKDF2 Hashing)
- The key is hashed with PBKDF2-SHA256: 100 000 iterations, 32-byte output.
- A unique 16-byte random salt is generated per key.
- Only `(api_key_hash, api_key_salt)` are stored in the database.

### Fast Authentication — `key_prefix`
- The first 8 hex characters of the key are stored as `key_prefix` (indexed).
- Authentication queries `WHERE key_prefix = $1` — O(1) lookup instead of full-table scan.
- Only the matching row(s) undergo PBKDF2 verification, limiting the PBKDF2 cost to a single operation per login.

### Key Rotation
- `POST /api/merchants/rotate-key` — requires the current valid Bearer token.
- Immediately invalidates the old key.
- Rate-limited to 10 calls per merchant per hour.

---

## 2. Payment Recipient Verification (CRITICAL)

Every transaction verification confirms that the USDC recipient in the on-chain transaction **exactly matches** the merchant's registered wallet address.

**Attack Prevented:**
```
Attacker sends USDC to their own wallet (0xAttacker).
Attacker submits that tx hash to AgentPay claiming payment to merchant.
AgentPay fetches the transaction, extracts the SPL-token destination.
destination (0xAttacker) ≠ merchant.walletAddress → REJECTED (400).
```

---

## 3. Rate Limiting

| Scope | Limit | Window |
|-------|-------|--------|
| Global (all routes) | 100 req | 15 min |
| Payment verification | 20 req | 1 min |
| Key rotation | 10 req | 1 hour |

---

## 4. Webhook Signatures (HMAC-SHA256)

Outgoing webhook payloads are signed so merchants can verify authenticity:

- Header: `X-AgentPay-Signature: sha256=<hex>`
- Algorithm: HMAC-SHA256, key = `WEBHOOK_SECRET` env var.

**Verification example (Node.js):**
```js
const crypto = require('crypto');
const expected = 'sha256=' + crypto
  .createHmac('sha256', process.env.WEBHOOK_SECRET)
  .update(JSON.stringify(req.body))
  .digest('hex');
if (req.headers['x-agentpay-signature'] !== expected) {
  return res.status(401).send('Invalid signature');
}
```

---

## 5. Solana RPC Circuit Breaker

If the Solana RPC endpoint fails 3 consecutive times, the circuit opens for 30 seconds.  
All verification requests during that window receive a `402 System congested` response rather than hanging.  
The circuit enters half-open state after 30 s and resets on the next successful RPC call.

---

## 6. Audit Log (FCA AML Compliance)

Every payment verification attempt (success or failure) is appended to `payment_audit_log`, capturing:
- Merchant identity
- Requester IP address
- Transaction signature submitted
- Outcome (succeeded / failure_reason)
- Timestamp

**The table is append-only — no UPDATEs or DELETEs are ever performed on it.**

---

## 7. Other Controls

| Control | Implementation |
|---------|---------------|
| SQL injection | Parameterised queries throughout (`pg` library) |
| XSS / clickjacking | `helmet` security headers |
| Input validation | `joi` schemas on all request bodies |
| CORS | Configurable `CORS_ORIGIN` env var |
| Secrets | Never logged; never returned after initial registration |
| Database SSL | Enforced in production (`ssl: { rejectUnauthorized: false }`) |
