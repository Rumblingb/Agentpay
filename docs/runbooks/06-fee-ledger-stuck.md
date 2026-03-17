# Runbook: Fee Ledger Stuck

**Severity:** P1 High (revenue not collected)
**Trigger:** Reconciler logs `FEE_TRANSFER_STUCK` or `FEE_TERMINAL` — fee_ledger_entries cannot progress.

---

## Detect

```bash
npx wrangler tail agentpay-api --search "FEE_TRANSFER_STUCK\|FEE_TERMINAL" --format pretty
```

```sql
-- How many entries are stuck?
SELECT status, COUNT(*), MIN(last_attempted_at), MAX(attempt_count)
FROM fee_ledger_entries
GROUP BY status;

-- View stuck/terminal entries
SELECT id, intent_id, gross_amount, platform_fee_amount,
       treasury_destination, status, attempt_count, failure_reason,
       last_attempted_at
FROM fee_ledger_entries
WHERE status IN ('processing', 'terminal')
ORDER BY last_attempted_at ASC
LIMIT 20;
```

---

## Triage

### FEE_TRANSFER_STUCK (status = 'processing' > 2 hours)

The reconciler marks entries as `processing` when a payment is confirmed. They should
transition to `complete` once the treasury transfer executes. If they stay in `processing`
more than 2 hours, the transfer hasn't happened.

Root causes:
1. `PLATFORM_SIGNING_KEY` is not set — on-chain transfers need a signing key
2. `PLATFORM_TREASURY_WALLET` is wrong or unreachable
3. The treasury signing service (if separate) is down

### FEE_TERMINAL (attempt_count >= 5)

The entry has been retried 5 times and failed each time. Funds are confirmed on-chain but
the platform fee has not been collected.

---

## Resolve

### If PLATFORM_SIGNING_KEY is not configured (most common)

The platform fee system logs obligations but doesn't auto-transfer until a signing key exists.
This is by design in the current beta. To resolve:

1. Document the amounts owed in a treasury spreadsheet from the logs:
   ```bash
   npx wrangler tail agentpay-api --search "TREASURY_TRANSFER_PENDING" --format json | \
     jq '{intentId: .intentId, platformFeeAmount: .platformFeeAmount, treasury: .treasuryDestination}'
   ```

2. Manually execute the Solana USDC transfers from the treasury wallet for each entry.

3. Mark entries as complete after manual transfer:
   ```sql
   UPDATE fee_ledger_entries
   SET status = 'complete',
       settled_at = NOW(),
       failure_reason = 'manual_transfer_executed',
       updated_at = NOW()
   WHERE id = '<entryId>';
   ```

### If PLATFORM_TREASURY_WALLET is wrong
```bash
npx wrangler secret put PLATFORM_TREASURY_WALLET
# Enter correct Solana wallet address
npx wrangler deploy
```

### Re-queue terminal entries for retry
```sql
-- Reset terminal entries to pending so reconciler retries them
UPDATE fee_ledger_entries
SET status = 'pending',
    attempt_count = 0,
    failure_reason = NULL,
    last_attempted_at = NULL,
    updated_at = NOW()
WHERE status = 'terminal'
  AND created_at > NOW() - INTERVAL '7 days';
```

---

## Post-mortem

- Total USDC platform fees affected
- Was this a configuration gap or a system failure?
- Timeline for implementing the treasury signing service
- Add monitoring alert when `terminal` count crosses a threshold
