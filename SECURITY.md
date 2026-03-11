# Security Policy — AgentPay

---

## Responsible Disclosure

If you discover a security vulnerability in AgentPay, report it responsibly.

**Email:** security@agentpay.gg  
**Expected response:** 48-hour acknowledgment, 7-day initial assessment  
**Do not** open a public GitHub issue for security vulnerabilities.

We will acknowledge your report, assess severity, notify you when a patch ships, and credit you in our security changelog (with your permission).

---

## Do Not Commit Secrets

Never commit credentials, API keys, or secrets to this repository. The following must remain outside version control at all times:

- `DATABASE_URL` / `DIRECT_URL`
- `WEBHOOK_SECRET`, `AGENTPAY_SIGNING_SECRET`, `VERIFICATION_SECRET`
- `ADMIN_SECRET_KEY`
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
- Solana private keys
- `apps/api-edge/.dev.vars`
- `.env` files

These are all listed in `.gitignore`. If you believe a secret has been exposed, rotate it immediately.

---

## Secret Management by Surface

### Cloudflare Workers (primary API)

Secrets are stored in Cloudflare's encrypted secret store — never in `wrangler.toml` or source code.

```bash
wrangler secret put DATABASE_URL
wrangler secret put WEBHOOK_SECRET
wrangler secret put AGENTPAY_SIGNING_SECRET
wrangler secret put VERIFICATION_SECRET
wrangler secret put ADMIN_SECRET_KEY
```

For local Workers development, use `apps/api-edge/.dev.vars` (git-ignored). See [docs/ENVIRONMENT.md](docs/ENVIRONMENT.md) for the full reference.

### Legacy Node.js Backend

Secrets live in `.env` (git-ignored). Generate strong values with:

```bash
npm run generate:secrets
```

The server refuses to start in production if any required secret is missing, shorter than 32 characters, or set to a known placeholder value.

### Supabase

- Use the Supabase Direct connection string (port 5432) for `DATABASE_URL`
- Rotate database credentials via the Supabase dashboard
- Enable Row Level Security on sensitive tables

### Stripe

- Use restricted Stripe API keys in production (grant only the permissions your integration requires)
- Rotate Stripe keys via the Stripe dashboard
- Verify `STRIPE_WEBHOOK_SECRET` signatures on every incoming webhook — the Workers API enforces this

---

## Security Controls

| Control | Implementation |
|---------|---------------|
| API key hashing | PBKDF2-SHA256 with per-key salt |
| Webhook signing | HMAC-SHA256 via `WEBHOOK_SECRET` |
| Wallet encryption | AES-256-GCM via `AGENTPAY_SIGNING_SECRET` |
| Security headers | Set on every response (CSP, HSTS, X-Frame-Options, etc.) |
| Rate limiting | Applied to all endpoints |
| Audit logging | All payment events logged to `payment_audit_log` |
| Input validation | Zod schemas on all critical routes |
| CORS | Restricted to configured origins — no wildcard in production |

---

## Severity Levels

| Level | Description | Response |
|-------|-------------|----------|
| P1 | Active breach, data exfiltration, unauthorized fund movement | Immediate |
| P2 | Suspected breach, auth bypass, secret exposure | 1 hour |
| P3 | Security misconfiguration without active exploitation | 24 hours |
| P4 | Hardening opportunities | Next sprint |

---

## Full Security Reference

For the complete security architecture, threat model, key rotation playbooks, and incident response runbook, see:

- [docs/SECURITY.md](docs/SECURITY.md) — security architecture and controls
- [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md) — STRIDE threat model and attack trees
