# AgentPay — Non-Custodial Disclaimer

**AgentPay is non-custodial infrastructure.**

- AgentPay **never holds** user funds.
- AgentPay **never controls** private keys.
- AgentPay **never acts** as a financial intermediary.

All payment flows use:
1. On-chain smart contracts (Solana)
2. Direct wallet-to-wallet transfers
3. Stripe Connect (merchant-controlled)

Merchants and agents retain full custody of their funds at all times.

---

## System Responsibility Boundaries

```
┌────────────────────────────────────────────────────────────┐
│                      AgentPay Platform                      │
│                                                              │
│  ┌──────────────┐    ┌─────────────┐    ┌───────────────┐  │
│  │  Protocol    │    │  Risk       │    │  Marketplace  │  │
│  │  Rails       │    │  Engine     │    │  Discovery    │  │
│  └──────────────┘    └─────────────┘    └───────────────┘  │
│         │                                                    │
│         ▼ (signals only, no fund control)                   │
└────────────────────────────────────────────────────────────┘
         │
         ▼
┌────────────────────┐          ┌─────────────────────┐
│  Merchant Wallet   │◄────────►│  Agent Wallet       │
│  (merchant-owned)  │          │  (agent-owned)      │
└────────────────────┘          └─────────────────────┘
```

AgentPay's risk engine and compliance checks are **advisory signals** — the platform operator decides whether to act on them.
