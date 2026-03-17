# Runbook: API Key Compromise

**Severity:** P0 Critical
**Trigger:** Merchant reports unauthorized usage, unexpected payment intents, or key appearing in public (GitHub, etc.).

---

## Detect

Signs of compromise:
- Merchant reports charges they didn't initiate
- Unusual geographic pattern in request logs (Cloudflare Analytics)
- API key found in a public GitHub repo scan
- `POST /api/intents` calls from unknown IPs with the merchant's key

---

## Contain (within 15 minutes)

### Step 1: Rotate the key immediately

The merchant can self-rotate:
```bash
curl -X POST https://agentpay-api.apaybeta.workers.dev/api/merchants/rotate-key \
  -H "Authorization: Bearer <current-key>"
```

If the merchant can't authenticate (key lost), use the recovery flow:
```bash
# Request recovery token
curl -X POST https://agentpay-api.apaybeta.workers.dev/api/merchants/recover/request \
  -H "Content-Type: application/json" \
  -d '{"email": "<merchant-email>"}'

# Confirm with token from email
curl -X POST https://agentpay-api.apaybeta.workers.dev/api/merchants/recover/confirm \
  -H "Content-Type: application/json" \
  -d '{"email": "<merchant-email>", "recoveryToken": "<token>"}'
```

### Step 2: Directly invalidate via DB if merchant is unreachable

```sql
-- Generate a garbage hash to instantly invalidate the current key
UPDATE merchants
SET api_key_hash = 'REVOKED_' || gen_random_uuid()::text,
    api_key_salt = 'revoked',
    key_prefix   = 'REVOKED',
    updated_at   = NOW()
WHERE email = '<merchant-email>';
```

### Step 3: Void suspicious intents from the compromise window

```sql
-- Find intents created with the compromised key during the window
SELECT id, amount, status, created_at, metadata
FROM payment_intents
WHERE merchant_id = '<merchantId>'
  AND created_at BETWEEN '<compromise_start>' AND '<rotation_time>'
  AND status = 'pending';

-- Expire/void them
UPDATE payment_intents
SET status = 'expired', updated_at = NOW()
WHERE id IN ('<id1>', '<id2>');
```

---

## Investigate

```sql
-- All intents in the last 7 days for this merchant
SELECT id, amount, status, metadata->>'agentId' AS agent,
       created_at, updated_at
FROM payment_intents
WHERE merchant_id = '<merchantId>'
  AND created_at > NOW() - INTERVAL '7 days'
ORDER BY created_at DESC;
```

Identify:
- Were any funds actually transferred? (check `status = 'confirmed'`)
- What agentId(s) were used? Are they known to the merchant?

---

## Resolve

1. Issue merchant a new API key (rotation returns it in the response).
2. Send merchant a security advisory with the compromise window timeline.
3. If funds were stolen, escalate to legal/finance for chargeback/recovery options.
4. File a report if the compromised key was found in a public repo — contact GitHub/GitLab security.

---

## Prevention

- Remind merchants: API keys should be in environment variables, never in code
- Implement webhook notification when a key is rotated from an unknown IP
- Consider adding IP allowlisting at the merchant level
