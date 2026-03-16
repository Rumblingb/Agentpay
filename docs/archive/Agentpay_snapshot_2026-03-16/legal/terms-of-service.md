# AgentPay Terms of Service

**Effective Date:** 2025-01-01  
**Version:** 1.0.0

---

## 1. Non-Custodial Disclaimer

AgentPay is a **non-custodial** payment infrastructure provider. We do not:

- Hold, custody, or control any user funds.
- Take possession of cryptocurrency or fiat on behalf of merchants or agents.
- Act as a money transmitter, payment processor, or financial institution.

All funds flow directly between agent wallets and merchant wallets via smart contracts or blockchain transactions. AgentPay provides the protocol rails and tooling only.

---

## 2. System Responsibility Boundaries

| Party | Responsibility |
|-------|---------------|
| **AgentPay** | Protocol software, API infrastructure, risk engine tooling |
| **Merchant** | Compliance with local laws, KYB/KYC of their customers, fund custody |
| **Agent** | Delivery of agreed services, wallet security, tax obligations |

AgentPay is not liable for:
- Loss of funds due to agent or merchant misconduct.
- Smart contract bugs in third-party contracts.
- Regulatory non-compliance by merchants or agents.

---

## 3. Risk Engine Policy

The AgentPay risk engine provides:
- **Fraud signals** — sybil detection, velocity checks, behavioural analysis.
- **AML flags** — wallet/IP blacklists, region-based alerts, large-transaction monitoring.

Risk engine outputs are **advisory only** unless explicitly configured by the platform operator to block transactions. AgentPay does not guarantee detection of all fraudulent activity.

---

## 4. Dispute & Arbitration Policy

Disputes between hiring agents and working agents are handled as follows:

1. **Step 1 — Direct Resolution (72 hours):** Parties attempt to resolve directly via the dispute API.
2. **Step 2 — Platform Arbitration:** If unresolved, the platform operator reviews evidence and issues a ruling.
3. **Step 3 — AgentPay Escalation:** In exceptional cases, AgentPay may review but is not obligated to adjudicate.

Escrow funds remain locked until a ruling is issued. AgentPay does not hold escrow funds; the smart contract holds them.

---

## 5. Acceptable Use

You may not use AgentPay to:
- Facilitate transactions involving OFAC-sanctioned parties.
- Process payments for illegal goods or services.
- Circumvent AML/KYC requirements in your jurisdiction.

---

## 6. Governing Law

These terms are governed by the laws of Delaware, USA, without regard to conflict-of-law principles.

---

*AgentPay reserves the right to update these terms. Material changes will be announced via the API at `GET /api/legal`.*
