# Runbook: Solana RPC Outage

**Severity:** P1 High
**Trigger:** `SOLANA_RPC unavailable` errors in logs, circuit breaker open, payments not verifying.

---

## Detect

```bash
# Workers tail — look for circuit breaker
npx wrangler tail agentpay-api --search "RPC" --format pretty

# Node.js listener (Render) — check service logs for connection errors
```

Alert signals:
- `[verify] circuit breaker open` in Workers logs
- `verifyPaymentRecipient` returning `valid: false` with RPC errors
- All fallback endpoints also failing

---

## Triage

1. **Check primary RPC status:**
   - Helius status: https://status.helius.dev
   - Solana status: https://status.solana.com

2. **Test primary RPC manually:**
   ```bash
   curl -X POST $SOLANA_RPC_URL \
     -H "Content-Type: application/json" \
     -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}'
   ```

3. **Test fallback RPCs** — same command with each fallback URL.

4. **Check `SOLANA_RPC_FALLBACKS`** is set in Workers:
   ```bash
   npx wrangler secret list
   ```

---

## Contain

**Option A: Add a working RPC to fallbacks** (fastest)
```bash
npx wrangler secret put SOLANA_RPC_FALLBACKS
# Enter comma-separated list, e.g.:
# https://api.mainnet-beta.solana.com,https://solana-api.projectserum.com,https://rpc.ankr.com/solana
npx wrangler deploy  # redeploy to pick up new secret
```

**Option B: Switch primary RPC**
```bash
npx wrangler secret put SOLANA_RPC_URL
# Enter a working RPC endpoint
```

**Option C: Enable global pause** (if verification is causing cascading errors)
```bash
npx wrangler secret put AGENTPAY_GLOBAL_PAUSE
# Enter: true
# This rejects all non-GET, non-health requests with 503
```

---

## Resolve

1. Once a working RPC is confirmed, remove AGENTPAY_GLOBAL_PAUSE if set:
   ```bash
   npx wrangler secret delete AGENTPAY_GLOBAL_PAUSE
   npx wrangler deploy
   ```

2. Manually re-verify any intents that failed during the outage window (see runbook 01).

3. Update `SOLANA_RPC_FALLBACKS` with at least 2 additional endpoints.

---

## Post-mortem

- How long was the primary RPC down?
- Did the fallbacks kick in? If not, why?
- Add a synthetic health check (uptime monitor) pointing at `/api/health`
- Consider Helius dedicated endpoint for higher reliability
