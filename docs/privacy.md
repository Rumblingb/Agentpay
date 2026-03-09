# AgentPay — Privacy Policy

**Last updated: March 9, 2026**

## 1. Introduction

AgentPay ("we", "us", "our") respects your privacy. This Privacy Policy describes what data we collect, how we use it, and your rights regarding that data when you use the AgentPay API, dashboard, and related services ("Services").

## 2. Information We Collect

### 2a. Information You Provide
- **Merchant account data**: name, email address, wallet address, webhook URL.
- **API keys**: stored as PBKDF2 hashes; plaintext is never retained after initial display.
- **Payment data**: payment intent amounts, recipient addresses, transaction hashes.
- **Agent identity data**: agent IDs, delegation records, KYA (Know Your Agent) submissions.

### 2b. Information Collected Automatically
- **Server logs**: IP addresses, HTTP method, endpoint path, response codes, and timestamps (Morgan / Render logs).
- **Error reports**: stack traces and contextual metadata via Sentry (when `SENTRY_DSN` is configured).
- **Analytics**: aggregate API usage metrics (no personally identifiable information in metrics).

### 2c. Blockchain Data
Transactions settled on Solana are publicly visible on-chain. AgentPay reads on-chain data (transaction signatures, SPL-token transfers) to verify payments; we do not control or modify on-chain records.

## 3. How We Use Your Information

| Purpose | Lawful Basis |
|---------|--------------|
| Provide and operate the Services | Contract performance |
| Detect fraud and prevent abuse | Legitimate interests |
| Comply with AML/KYC obligations | Legal obligation |
| Send service notifications (downtime, API changes) | Legitimate interests |
| Improve the Services | Legitimate interests |
| Respond to support requests | Contract performance |

We **do not** sell, rent, or share your personal data with third-party advertisers.

## 4. Data Sharing

We share data only with:
- **Infrastructure providers**: Render (API hosting), Vercel (dashboard), Supabase/Neon (Postgres database). All are governed by their own privacy policies and data processing agreements.
- **Blockchain networks**: Solana — publicly visible by design.
- **Error monitoring**: Sentry — error traces only, no payment amounts.
- **Law enforcement**: when required by valid legal process.

## 5. Data Retention

| Data Type | Retention Period |
|-----------|-----------------|
| Merchant account data | Duration of account + 7 years (AML compliance) |
| Payment audit log | 7 years (regulatory requirement) |
| Server/access logs | 90 days |
| Sentry error events | 30 days |
| Deleted account data | Anonymised within 30 days of deletion request |

## 6. Security

AgentPay applies industry-standard security measures:
- API keys hashed with PBKDF2-SHA256 (100,000 iterations).
- Webhook payloads signed with HMAC-SHA256.
- Wallet private keys encrypted with AES-256-GCM.
- TLS in transit; Postgres at rest encryption via hosting provider.
- Rate limiting and IP-level abuse detection.

No system is perfectly secure. If you discover a vulnerability, please report it to **rajivbaskaran@gmail.com** using responsible disclosure.

## 7. Your Rights (GDPR / CCPA)

Depending on your jurisdiction, you may have the right to:
- **Access** the personal data we hold about you.
- **Correct** inaccurate data.
- **Delete** your account and associated personal data (subject to legal retention requirements).
- **Object** to certain processing activities.
- **Data portability** — receive your data in a machine-readable format.

To exercise any of these rights, email **rajivbaskaran@gmail.com**. We will respond within 30 days.

## 8. Cookies

The AgentPay dashboard uses a single session cookie (HMAC-signed, HTTP-only, Secure) for authentication. No third-party tracking cookies are used.

## 9. Children's Privacy

The Services are not directed at individuals under 18 years of age. We do not knowingly collect personal data from minors.

## 10. International Transfers

Data may be processed in the United States and other countries where our infrastructure providers operate. By using the Services, you consent to such transfers, which are governed by standard contractual clauses or equivalent safeguards.

## 11. Changes to This Policy

We may update this Privacy Policy at any time. We will notify registered merchants via email of material changes. Continued use of the Services after the effective date constitutes acceptance.

## 12. Contact

**Data Controller**: AgentPay  
**Email**: rajivbaskaran@gmail.com  
**GitHub Issues**: https://github.com/Rumblingb/Agentpay/issues
