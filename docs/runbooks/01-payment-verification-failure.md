# Runbook: Payment Verification Failure

**Severity:** P2 Medium (P1 if >10% of payments affected)
**Trigger:** Merchants report payments stuck in `pending`, `/api/verify/:txHash` returning errors, or Solana listener not picking up confirmed transactions.

---

## Detect

```bash
# Live log stream — look for verify errors
npx wrangler tail agentpay-api --search "verify" --format pretty

# Check how many intents are stuck pending
# Run in Supabase SQL editor:
SELECT COUNT(*), MIN(created_at) FROM payment_intents
WHERE status = 'pending' AND expires_at > NOW();
```

Alert signals:
- Reconciler log: `STALE_PENDING` count > 20 in one run
- Merchant support tickets about unconfirmed payments
- `[verify]` route returning 500 or circuit-breaker errors

---

## Triage

1. **Is the Solana RPC down?** → See [02-solana-rpc-outage.md](02-solana-rpc-outage.md)
2. **Is the verify endpoint returning an error?**
   ```bash
   curl https://api.agentpay.so/api/verify/<txHash>
   ```
3. **Is the intent expired?** Check `expires_at` in DB — intents expire after 30 min.
4. **Was the tx sent to the wrong wallet?** Verify `recipient_address` in DB matches merchant's `wallet_address`.
5. **Is the amount mismatched?** Check on-chain amount vs `payment_intents.amount`.

---

## Contain

If the RPC is intermittently failing:
- The Workers API has an RPC fallback list (`SOLANA_RPC_FALLBACKS`). Verify the fallbacks are set:
  ```bash
  npx wrangler secret list
  # If SOLANA_RPC_FALLBACKS is missing, add it:
  npx wrangler secret put SOLANA_RPC_FALLBACKS
  # Enter: https://api.mainnet-beta.solana.com,https://solana-api.projectserum.com
  ```

If the Solana listener (Render) is down:
- Merchants can still manually verify by calling `POST /api/intents/:id/verify` with the tx hash.

---

## Resolve

1. **Manual re-verification** for stuck intents with a known tx hash:
   ```bash
   curl -X POST https://api.agentpay.so/api/verify/<txHash> \
     -H "Content-Type: application/json" \
     -d '{"intentId": "<intentId>"}'
   ```

2. **Re-open expired intents** (requires direct DB access — use sparingly):
   ```sql
   UPDATE payment_intents
   SET status = 'pending', expires_at = NOW() + INTERVAL '30 minutes', updated_at = NOW()
   WHERE id = '<intentId>' AND status = 'expired';
   ```

3. **Restart Solana listener** (Render dashboard → service → restart).

---

## Post-mortem

- Document: root cause, time-to-detect, time-to-resolve, affected intents count
- Check: did the fallback RPC work? Add more fallbacks if not
- Consider: Durable Objects alarm for sub-minute Solana polling
