# AgentPay Incident Response Runbooks

Operational playbooks for production incidents. Each runbook follows the same structure:
**Detect → Triage → Contain → Resolve → Post-mortem**.

## Index

| Runbook | Trigger |
|---------|---------|
| [01-payment-verification-failure.md](01-payment-verification-failure.md) | Payments stuck pending, verify endpoint returning errors |
| [02-solana-rpc-outage.md](02-solana-rpc-outage.md) | Solana RPC unreachable, circuit breaker open |
| [03-double-credit.md](03-double-credit.md) | Same tx hash credited more than once (DOUBLE_CREDIT alert) |
| [04-high-anomaly-rate.md](04-high-anomaly-rate.md) | Reconciler firing HIGH_FAILURE_RATE, HIGH_VELOCITY, or LARGE_PAYMENT alerts |
| [05-api-key-compromise.md](05-api-key-compromise.md) | Suspected merchant API key leak or unauthorized usage |
| [06-fee-ledger-stuck.md](06-fee-ledger-stuck.md) | FEE_TRANSFER_STUCK or FEE_TERMINAL alerts from reconciler |

## Severity Levels

| Level | Response Time | Examples |
|-------|--------------|---------|
| **P0 Critical** | < 15 min | DOUBLE_CREDIT, mass API key compromise |
| **P1 High** | < 1 hr | RPC outage, fee ledger stuck |
| **P2 Medium** | < 4 hr | High anomaly rate, payment stuck |
| **P3 Low** | < 24 hr | Single payment failure, stale entries |

## Contacts

- Cloudflare Workers dashboard: https://dash.cloudflare.com
- Supabase dashboard: https://supabase.com/dashboard
- Wrangler tail (live logs): `npx wrangler tail agentpay-api --env production`
- Wrangler tail (staging): `npx wrangler tail agentpay-api-staging --env staging`
