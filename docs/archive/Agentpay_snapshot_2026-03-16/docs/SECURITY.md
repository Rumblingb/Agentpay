# Security Policy — AgentPay

> **Version:** 1.0  
> **Last Updated:** 2026-03-10  
> **Owner:** Engineering / Security

---

## Responsible Disclosure

If you discover a security vulnerability in AgentPay, please report it responsibly:

**Email:** security@agentpay.gg  
**Expected response time:** 48 hours for acknowledgment, 7 days for initial assessment  
**Do not:** open a public GitHub issue for security vulnerabilities

We commit to:
1. Acknowledge receipt within 48 hours
2. Provide an initial severity assessment within 7 days
3. Notify you when the vulnerability is patched
4. Credit you in our security changelog (with your permission)

---

## Security Architecture

### Authentication

- **API Keys:** PBKDF2-SHA256 with per-key salt. Key prefix (first 8 chars) stored plaintext for fast lookup; full key never stored.
- **Admin Endpoints:** Separate `ADMIN_SECRET_KEY` required via `X-Admin-Secret` header
- **JWT:** Used for dashboard session management; signed with `VERIFICATION_SECRET`

-### Transport Security

- TLS enforced at the edge/load balancer (Render or Cloudflare)
- Helmet.js sets security headers: CSP, HSTS, X-Frame-Options, X-Content-Type-Options
- CORS configured via `CORS_ORIGIN` environment variable; no wildcard in production

### Rate Limiting

| Endpoint Group | Limit |
|----------------|-------|
| Global | 100 req / 15 min |
| Auth endpoints | 10 req / 15 min |
| Admin endpoints | 20 req / 15 min |

### Webhook Security

- All webhook deliveries signed with HMAC-SHA256 using `WEBHOOK_SECRET`
- Signature in `X-AgentPay-Signature` header
- Recipients must verify signature before processing
- Webhook URL validation: HTTPS required in production; `http://localhost` only in test

### Secret Management

All secrets validated on startup:
- `WEBHOOK_SECRET` — must be ≥32 chars, not a known placeholder
- `AGENTPAY_SIGNING_SECRET` — must be ≥32 chars, used for wallet encryption
- `VERIFICATION_SECRET` — must be ≥32 chars, used for JWT signing
- `DATABASE_URL` — required in production

Generate secrets: `npm run generate:secrets`

---

## Production Security Controls

| Control | Implementation |
|---------|---------------|
| Startup validation | `src/server.ts` — refuses to start with insecure defaults in production |
| Input validation | Zod schemas on all critical routes |
| SQL injection prevention | Parameterized queries throughout; Prisma ORM |
| XSS prevention | Helmet CSP; output encoding |
| CSRF | Not applicable (API-only; no cookie auth) |
| Audit logging | All payment events logged to `payment_audit_log` |
| Test mode hard-block | `AGENTPAY_TEST_MODE=true` blocked in production startup |

---

## Encryption

| Data | Encryption |
|------|-----------|
| Agent private keys (custodial wallets) | AES-256-GCM via `walletEncryption.ts`, keyed from `AGENTPAY_SIGNING_SECRET` |
| API key hash | PBKDF2-SHA256 with unique salt per key |
| Data in transit | TLS 1.2+ via Render load balancer |
| Data at rest | Render PostgreSQL managed encryption |

**Key Rotation:**  
Rotating `AGENTPAY_SIGNING_SECRET` requires re-encrypting all custodial wallets. See [Key Rotation Playbook](#key-rotation-playbook).

---

## Least Privilege

- Database credentials restricted to the application database
- No database user has DDL rights in production (migrations run separately)
- Admin role assigned explicitly; not granted to new merchants by default
- Stripe keys: use restricted keys in production (webhook only, charge only)

---

## Audit Logging

Every critical payment and admin action is logged to `payment_audit_log` with:
- Timestamp
- Merchant ID
- IP address
- Endpoint + method
- Outcome (success/failure)
- Failure reason (if applicable)

Logs are append-only; no delete/update paths exist.

---

## Key Rotation Playbook

### API Key Rotation (Merchant)

1. Merchant calls `POST /api/merchants/rotate-key` (planned)
2. New key is generated and hashed
3. Old key is invalidated
4. Merchant notified via email/webhook

### WEBHOOK_SECRET Rotation

1. Generate new secret: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
2. Set new secret in environment as `WEBHOOK_SECRET_NEW`
3. Sign new deliveries with both old and new secret (dual-signing period)
4. After 24 hours, retire old secret
5. Update all webhook consumers

### AGENTPAY_SIGNING_SECRET Rotation (Custodial Wallets)

1. ⚠️ This affects all encrypted private keys — plan carefully
2. Deploy a migration job that:
   - Decrypts each `agent_wallets.encrypted_private_key` with the old secret
   - Re-encrypts with the new secret
3. Do NOT change the secret until migration is complete and verified
4. Keep old secret available in case rollback is needed

---

## Incident Response Runbook

### Severity Levels

| Level | Description | Response Time |
|-------|-------------|---------------|
| P1 | Active breach, data exfiltration, unauthorized fund movement | Immediate |
| P2 | Suspected breach, auth bypass, secret exposure | 1 hour |
| P3 | Security misconfiguration without active exploitation | 24 hours |
| P4 | Hardening/improvement opportunities | Next sprint |

### P1/P2 Response Steps

1. **Contain:** Rotate all secrets immediately. Disable affected API keys. Block affected IPs at load balancer.
2. **Assess:** Review audit logs for unauthorized access patterns. Identify scope of exposure.
3. **Notify:** Notify affected merchants via email within 72 hours (GDPR/legal requirement).
4. **Remediate:** Deploy fix. Verify fix with security test.
5. **Post-mortem:** Write a blameless post-mortem within 7 days. Identify systemic gaps.

---

## Security Tests

Security-specific tests are in `tests/security/`:

- `authMiddleware.test.ts` — API key verification, invalid key rejection
- `webhookSignature.test.ts` — HMAC verification, signature forgery rejection
- `pbkdf2Validation.test.ts` — Key hashing correctness
- `agentOwnership.test.ts` — Cross-agent ownership enforcement
- `receiptSanitization.test.ts` — Output encoding, XSS prevention

Run: `npm run test:security`

---

## Branch Protection (Recommended)

For the `main` branch:

```
✅ Require pull request reviews (≥1 approval)
✅ Require status checks to pass (CI)
✅ Require signed commits
✅ Do not allow force pushes
✅ Do not allow branch deletion
✅ Require linear history
```

See `CODEOWNERS` for required reviewers on security-sensitive paths.
