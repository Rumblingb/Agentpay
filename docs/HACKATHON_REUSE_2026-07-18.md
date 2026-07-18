# AgentPay Commerce - Hackathon Reuse Packet

Verified: 2026-07-18. Recheck every date, eligibility rule, account state, and submission field immediately before any external action.

This packet keeps one canonical product and repository. It does not authorize registration, account creation, Discord access, API credentials, public posting, deployment, or submission.

## Portfolio Decision

| Priority | Event | Current decision | Exact fit | Gate |
|---|---|---|---|---|
| 1 | [OpenAI Build Week](https://openai.devpost.com/) | **Submit first** | Work and Productivity; meaningful Codex + GPT-5.6 commerce extension | Jul 21, 2026 at 5:00 PM PDT; real GPT demo, `/feedback`, public voiced video, source/demo access, and final rules acceptance remain |
| 2 | [Agentic Commerce Hackathon](https://agentic-commerce.devfolio.co/) | **Apply now, build later** | A shopping agent must discover, decide, and complete a transaction through Prava | Rolling application, acceptance, three-day RSVP, mandatory Discord, and a clearly new Prava workflow built during the event |
| 3 | [Brainwave 2026 - X402 Blockchain Track](https://brainwave-2026.devpost.com/) | **Conditional go** | Agentic commerce/payment infrastructure, spend policy, receipts, registry, and x402 | Jul 31, 2026 at 5:00 PM IST; verify event build window and build a new complete x402 flow during it |
| - | [Agentic Commerce Pioneers](https://pioneers.agnic.ai/) | **No-go** | Strong conceptual fit | Applications closed May 14 and submissions closed May 25 |

Do not submit to generic AI events merely because AgentPay contains AI. A suitable event must reward at least two of: agentic commerce, governed payments, merchant discovery, MCP/developer tooling, verifiable receipts, or human spending controls.

## Canonical Reuse Rules

1. Keep `Rumblingb/Agentpay` as the only source repository.
2. Preserve the dated five-commit Build Week stack as disclosed pre-existing work.
3. Start event-specific implementation only after the event's permitted build window opens.
4. Record the exact event-start commit, event-end commit, tests, demo URL, and third-party integration evidence.
5. Never describe a sandbox transaction as money movement or a supplied catalog as a verified merchant feed.
6. Never add a payment partner merely as a logo or wrapper. The event integration must own a necessary step in the working user journey.
7. Keep trading, hedge, Bill, broker, portfolio, and market-execution work outside these submissions and outside this repo lane.

## Agentic Commerce Hackathon

### Application Position

**Product:** AgentPay Commerce

**One-line pitch:** A proof-carrying shopping workspace where AI can compare eligible products, but a human constitution and a merchant-scoped payment mandate control what can actually be bought.

**What exists before the event:**

- visual need-led shopper and seller studio
- deterministic catalog, budget, delivery, returns, freshness, and fit controls
- closed-world GPT-5.6 ranking with opaque candidate references
- signed decision packets, exact human approval, MCP, and OpenAPI
- simulated checkout only; no live merchant, Prava, customer, order, or payment claim

**What will be new during the event:** **Prava Mandate Relay**.

After the user approves the exact product and total, AgentPay will convert the signed decision packet into a Prava payment session constrained to that merchant, amount, and expiry. The user grants the mandate with Prava's approval flow. Prava supplies the one-time merchant-scoped credential for checkout; AgentPay never handles raw card data. AgentPay then binds the transaction result back to the approved product and signed decision, rejects merchant or amount drift, and produces a portable completion receipt. Integration details must be selected from the current [Prava documentation](https://docs.prava.space/) during the event.

This is a real division of responsibility:

- GPT-5.6 compares policy-eligible evidence.
- AgentPay owns deterministic choice policy, provenance, and receipt verification.
- The human owns the approval.
- Prava owns the passkey-backed mandate and one-time merchant-scoped payment credential.

### Application Draft

> I am building AgentPay Commerce, a governed shopping layer for humans and the agents helping them buy. Today it turns a visual need into a policy-safe shortlist, constrains GPT-5.6 to opaque candidates and verified rationale codes, and requires approval of the exact item and total. During the hackathon I will build a new Prava Mandate Relay: the signed AgentPay decision becomes a merchant-scoped, amount-capped Prava session; the user approves it; Prava supplies the one-time checkout credential; and AgentPay verifies the result against the original mandate. The goal is a working purchase flow where the model can help decide but cannot quietly change the merchant, amount, or rules. The existing AgentPay foundation will be disclosed, and all Prava integration and end-to-end transaction work will be completed during the event.

### Event-Window Build List

1. Capture event-start commit and create the Prava adapter inside the existing provider boundary.
2. Use the official sandbox/API, SDK, MCP, or CLI path selected from current Prava documentation.
3. Create a session only from an approved, signed AgentPay decision packet.
4. Bind merchant, amount, currency, product reference, expiry, and idempotency key.
5. Demonstrate the real Prava approval and one-time credential flow without exposing card data.
6. Reject amount, merchant, expiry, replay, or candidate drift before completion.
7. Return a signed completion receipt and show a truthful failure path.
8. Add focused tests, setup instructions, architecture diagram, event commit evidence, and a narrated demo.

Target awards: overall, OpenAI, Best Visa Intelligent Commerce Implementation only if the actual event integration qualifies, and Most Startup-Ready Product. Do not claim eligibility from sponsor logos alone.

## Brainwave 2026 X402 Track

### Conditional Product

**AgentPay Catalog Truth Exchange:** a merchant or agent pays per signed catalog-truth audit through a new x402 endpoint. The successful response includes the audit, settlement receipt, evidence timestamp, and verification signature.

The event requires a complete `Challenge -> Sign -> Retry -> Settle` flow, a clearly identified paying user, pay-per-call economics, receipts in successful responses, clean setup instructions, a working MVP built during the hackathon, and preferably mainnet-ready architecture. Existing AgentPay x402/payment infrastructure is foundation only and must be disclosed.

### Go/No-Go Gate

Proceed only when all are true:

- registration and geographic eligibility are confirmed
- the permitted build window is unambiguous
- a new event-start commit is recorded
- the selected x402 stack can be exercised end to end in an approved sandbox or test network
- the demo can prove challenge, signed retry, settlement, receipt, replay rejection, and one customer-shaped use case

No-go if the submission would be only an existing endpoint, a mocked payment, a wallet screenshot, or an unverifiable customer/revenue claim.

## External Action Queue

1. Finish OpenAI Build Week's real-model, source, video, `/feedback`, and Devpost gates.
2. Separately approve the Devfolio application using the draft above; application submission and Discord joining are account mutations.
3. If accepted, RSVP within the organizer's three-day window and freeze the event-start commit before Prava implementation.
4. Verify Brainwave's schedule/rules near the event and join only if the event-window build requirement can be met honestly.

No application or submission has been made by this packet.
