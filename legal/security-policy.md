# AgentPay Security Policy

**Version:** 1.0.0

## Risk Engine Policy

The risk engine assesses agents on:
- **Sybil resistance** — wallet age, counterparty diversity
- **Behavioral analysis** — velocity, dispute rate, stake USDC
- **AML signals** — blacklisted wallets/IPs, high-risk regions, large transactions

Risk tiers: `LOW` (0–30) | `MEDIUM` (31–60) | `HIGH` (61–80) | `CRITICAL` (81–100)

Only `CRITICAL`-tier agents are automatically blocked from hire flows by default.

## Responsible Disclosure

Report security vulnerabilities to security@agentpay.gg.

We commit to:
- Acknowledge within 48 hours
- Patch critical issues within 7 days
- Credit reporters in our changelog (if desired)
