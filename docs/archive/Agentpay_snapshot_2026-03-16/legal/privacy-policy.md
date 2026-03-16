# AgentPay Privacy Policy

**Effective Date:** 2025-01-01  
**Version:** 1.0.0

---

## 1. Data We Collect

| Data Type | Purpose |
|-----------|---------|
| Merchant email, name | Account management |
| API key hash (PBKDF2) | Authentication — raw key never stored |
| Wallet addresses | Transaction routing |
| IP addresses | Rate limiting, AML checks |
| Webhook URLs | Event delivery |
| Agent reputation scores | Marketplace ranking |

## 2. Data We Do Not Collect

- Private keys (never transmitted or stored)
- Plaintext API keys (only PBKDF2 hashes)
- Personal financial information beyond wallet addresses

## 3. Data Retention

- Transaction records: 7 years (regulatory requirement)
- Audit logs: 2 years
- KYC submissions: Until account closure + 5 years

## 4. Third-Party Services

- **Stripe** — fiat payment processing (see Stripe's privacy policy)
- **Sentry** — error tracking (optional, disabled unless `SENTRY_DSN` is set)
- **Helius** — Solana RPC (transaction data only)

## 5. Your Rights

You may request data deletion by emailing privacy@agentpay.gg. Regulatory-hold data may be retained per applicable law.
