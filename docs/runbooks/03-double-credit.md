# Runbook: Double Credit Incident

**Severity:** P0 Critical — financial integrity risk
**Trigger:** Reconciler log: `DOUBLE_CREDIT` anomaly, same `transaction_hash` confirmed in multiple `transactions` rows.

---

## Detect

Reconciler fires this every 15 minutes:
```
[cron/reconciliation] DOUBLE_CREDIT {
  transactionHash: "...",
  count: 2,
  anomalyType: "DOUBLE_CREDIT",
  severity: "critical",
  action: "MANUAL_REVIEW_REQUIRED"
}
```

Also check manually:
```sql
SELECT transaction_hash, COUNT(*), ARRAY_AGG(id) AS ids,
       ARRAY_AGG(merchant_id) AS merchants
FROM transactions
WHERE status = 'confirmed' AND transaction_hash IS NOT NULL
GROUP BY transaction_hash
HAVING COUNT(*) > 1;
```

---

## Triage

1. **How many rows share the hash?** (2 = likely bug, 3+ = systematic issue)
2. **Are they for the same merchant or different merchants?**
   - Same merchant → duplicate processing bug
   - Different merchants → possible replay attack: one tx submitted to multiple intent IDs
3. **When did the duplicates occur?** Check `created_at` gap — concurrent listener runs?
4. **Is there an active exploit in progress?** Check if the same agent/IP is involved in multiple duplicates.

---

## Contain

**Immediate:** Freeze payouts for affected merchants while reviewing:
```bash
# Enable global pause if attack is active
npx wrangler secret put AGENTPAY_GLOBAL_PAUSE
# Enter: true
```

**Revoke affected API keys** if a compromised agent is submitting replays:
```sql
-- Deactivate merchant
UPDATE merchants SET is_active = false WHERE id = '<merchantId>';
```

---

## Resolve

1. **Identify the canonical transaction row** (first created, correct merchant):
   ```sql
   SELECT * FROM transactions
   WHERE transaction_hash = '<hash>'
   ORDER BY created_at ASC;
   ```

2. **Void the duplicate(s)**:
   ```sql
   UPDATE transactions
   SET status = 'voided', updated_at = NOW()
   WHERE id = '<duplicate_id>' AND status = 'confirmed';

   -- Also revert the associated payment intent if needed
   UPDATE payment_intents
   SET status = 'pending', updated_at = NOW()
   WHERE id = '<intentId>' AND status = 'completed';
   ```

3. **Notify the affected merchant** if funds were double-released.

4. **Lift global pause**:
   ```bash
   npx wrangler secret delete AGENTPAY_GLOBAL_PAUSE && npx wrangler deploy
   ```

---

## Prevention

- The `UNIQUE` constraint on `(transaction_hash, status='confirmed')` should prevent this at DB level. Verify it exists:
  ```sql
  SELECT * FROM pg_indexes WHERE tablename = 'transactions';
  ```
- Add the constraint if missing:
  ```sql
  CREATE UNIQUE INDEX CONCURRENTLY transactions_confirmed_hash_unique
    ON transactions (transaction_hash) WHERE status = 'confirmed';
  ```

---

## Post-mortem

- Was this a bug or an attack?
- Does the DB have the deduplication index?
- Review the listener concurrency model — two simultaneous polls could cause this
