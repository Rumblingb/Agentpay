# Runbook: High Anomaly Rate

**Severity:** P2 Medium (P1 if multiple merchants or coordinated pattern)
**Trigger:** Reconciler logs `ANOMALY_HIGH_FAILURE_RATE`, `ANOMALY_HIGH_VELOCITY`, or `ANOMALY_LARGE_PAYMENT`.

---

## Detect

```bash
npx wrangler tail agentpay-api --search "ANOMALY" --format pretty
```

The three anomaly types:

| Type | Threshold | Risk |
|------|-----------|------|
| `HIGH_FAILURE_RATE` | >10 failed/expired intents per merchant per hour | Possible probe attack or broken integration |
| `HIGH_VELOCITY` | >50 intents per merchant per hour | Possible DDoS or runaway agent loop |
| `LARGE_PAYMENT` | Single intent >$10,000 USDC | Fraud risk or missing approval threshold |

---

## Triage

### HIGH_FAILURE_RATE
```sql
-- What's failing for this merchant in the last hour?
SELECT status, COUNT(*), metadata->>'agentId' AS agent
FROM payment_intents
WHERE merchant_id = '<merchantId>'
  AND created_at > NOW() - INTERVAL '1 hour'
GROUP BY status, metadata->>'agentId'
ORDER BY COUNT(*) DESC;
```
- All the same agentId → broken agent loop or attack via one agent
- Many agentIds → probe attack testing recipient addresses

### HIGH_VELOCITY
```sql
-- What IPs are creating intents? (check rate limit logs)
-- Also check if agent IDs repeat:
SELECT metadata->>'agentId' AS agent, COUNT(*)
FROM payment_intents
WHERE merchant_id = '<merchantId>'
  AND created_at > NOW() - INTERVAL '1 hour'
GROUP BY agent ORDER BY COUNT(*) DESC LIMIT 10;
```

### LARGE_PAYMENT
```sql
SELECT id, amount, agent_id, metadata, created_at
FROM payment_intents
WHERE amount > 10000 AND created_at > NOW() - INTERVAL '1 hour';
```
- Is this a legitimate high-value merchant?
- Does this merchant have a large-amount approval policy configured?

---

## Contain

**Rate limit the offending agent/IP at the Cloudflare zone level:**
1. Cloudflare dashboard → Security → WAF → Rate limiting rules
2. Add rule: IP matches pattern → block for 1 hour

**Temporarily suspend the merchant account** if they're the source:
```sql
UPDATE merchants SET is_active = false WHERE id = '<merchantId>';
```

**For LARGE_PAYMENT:** Flag intent for manual approval before allowing verification:
```sql
UPDATE payment_intents SET status = 'requires_approval' WHERE id = '<intentId>';
```

---

## Resolve

1. Communicate with the affected merchant to understand if the pattern is legitimate.
2. If legitimate high-volume: raise rate limit thresholds for their account, or whitelist their IP at Cloudflare.
3. If attack: keep account suspended, file abuse report, review AgentRank for the offending agentId.
4. For large payments: establish a merchant-level approval threshold in their policy config.

---

## Post-mortem

- Was this a legitimate use case or an attack?
- Do thresholds need tuning (too sensitive or too lenient)?
- Should high-value merchants have a separate policy with higher limits?
