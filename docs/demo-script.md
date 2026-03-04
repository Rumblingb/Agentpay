# AgentPay Demo Script

> Internal notes for the product demo video / live walkthrough.

---

## 1. Opening (30 s)

- Show the **Dashboard Overview** — metric cards (Total Intents, Revenue, Confirmed, Success Rate).
- Point out the **Network Health — Total Value Secured (TVS)** chart.
  - "This is the aggregate USDC flowing through active escrows and confirmed payments. Right now we're at 40 transactions totalling $454."

## 2. AgentRank Deep Dive (60 s)

- Query `GET /api/agentrank/agent-alpha` — show the 5-factor scoring.
- Highlight Sybil flags: wallet age, stake, counterparty diversity.
- **Mention in video:** "AgentRank pulls from Helius for global data, making scores comprehensive. We are currently testing Helius and QuickNode ingestion to incorporate on-chain history — DEX volume, stake-weight — into every agent's trust score."

## 3. A2A Escrow Flow (90 s)

- Create escrow → mark complete → approve.
- Show reputation delta (+10 / −20).
- Trigger a dispute and show the **Behavioral Oracle** alert.

## 4. Insurance Pool (60 s)

- Explain the insurance_pool table: 10 000 USDC reserve, max $100 payout per claim.
- Show a critical alert triggering the insurance payout logic.
- "When an agent is caught gaming the system, we slash their reputation *and* refund the counter-party from the insurance pool — no human intervention required."

## 5. Closing (30 s)

- Recap: Trust Layer = AgentRank + Escrow + Oracle + Insurance.
- Call to action: "Integrate in one line with the TypeScript SDK."

---

## Key Talking Points

| Topic | Script |
|---|---|
| **TVS Chart** | "Total Value Secured is our north-star metric — it shows how much value the trust layer protects." |
| **Helius Ingestion** | "We're integrating Helius and QuickNode so AgentRank reflects global on-chain behaviour, not just AgentPay-local data." |
| **Insurance Pool** | "10 000 USDC backstops every escrow. If the Oracle detects fraud, the counter-party is made whole automatically." |
| **216+ Tests** | "94 % coverage. Every critical path is tested, including fraud detection and dispute resolution." |
