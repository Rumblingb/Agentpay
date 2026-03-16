
# AgentPay

AgentPay is protocol-agnostic infrastructure for agent-to-agent commerce — enabling autonomous agents to create payments, verify settlement, enforce policy, and build portable economic reputation through AgentPassport.

This repository contains the runtime services, Worker endpoints, SDKs, and developer documentation for integrating with AgentPay.

<p align="center">
  <a href="https://github.com/Rumblingb/Agentpay/actions/workflows/ci.yml"><img src="https://github.com/Rumblingb/Agentpay/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="./openapi.yaml"><img src="https://img.shields.io/badge/OpenAPI-3.1-85EA2D?logo=swagger" alt="OpenAPI 3.1"></a>
  <img src="https://img.shields.io/badge/status-Founding%20Era--preview-blue" alt="Founding Era">
</p>

---

Doctrine (public-facing)

- Agent-to-agent commerce is primary; agent-to-human interactions are first-class.
- The Founding Exchange is curated and premium during onboarding.
- AgentPassport is portable and cross-network.
- The Trust Graph is the long-term network moat, built from real settlements and dispute outcomes.

Links: [QUICKSTART.md](QUICKSTART.md) · [INTEGRATION_GUIDE.md](INTEGRATION_GUIDE.md) · [docs/INDEX.md](docs/INDEX.md)

---

## Protocol-Agnostic by Design

AgentPay is protocol-agnostic settlement infrastructure for agents.

The platform is designed to integrate with any emerging agent commerce protocol rather than replace them.

AgentPay can operate alongside or on top of:

- x402 payment authorization flows
- AP2 (Agent Payment Protocol)
- Coinbase AgentKit / agent commerce integrations
- direct blockchain settlement (Solana, Ethereum, etc.)
- custom in-house agent runtimes

Instead of enforcing a single protocol, AgentPay provides:

- payment intent creation
- settlement verification
- receipt generation
- policy enforcement
- agent identity via AgentPassport

This allows developers to use AgentPay as a universal payment capability layer regardless of the underlying agent protocol. AgentPay sits above payment protocols — it does not replace them.

---

## Founding Agents Demo — Travel

This repository contains the Founding Agents demo used to illustrate agent-to-agent commerce in the travel vertical. The demo shows two cooperating agents: discovery and execution. It is a concrete example of the Founding Era thesis.

### Agent 1: FlightDiscoveryAgent (Intelligence)
- Searches multiple flight sources
- Recommends options and price trends
- Optional price-monitoring tier

### Agent 2: TravelExecutionAgent (Execution)
- Books confirmed flights and issues tickets
- Handles payment via supported rails (USDC, Stripe)

Workflow (example):

1. Human issues intent (search)
2. TravelDiscovery finds options and recommends
3. Human selects option and intent routes to TravelExecution
4. TrustOracle verifies standing
5. SettlementGuardian opens escrow
6. Execution completes booking; escrow releases
7. AgentPassports update and standing is recorded

This demo illustrates how agent-to-agent transactions produce verifiable economic history that feeds the trust graph.

---

## Developer & Architecture notes

See `docs/ARCHITECTURE.md` and `docs/ENVIRONMENT.md` for setup and architecture details. The primary API surface is `apps/api-edge` (Cloudflare Workers) and the dashboard runs on Vercel in the Founding Era preview.

Key files for the travel demo:
```
src/agents/travel/FlightDiscoveryAgent.ts
src/agents/travel/TravelExecutionAgent.ts
components/booking/PremiumFlightBooking.tsx
```

---

## Getting Started

Start here → [QUICKSTART.md](QUICKSTART.md)

**A:** No. It's proof that agent-to-agent commerce works with real accountability. The travel booking is the demo; the trust infrastructure is the product.

### Q: What if Amadeus changes their API?
**A:** Swap to Sabre, Travelport, or another GDS. The trust layer remains valuable regardless of booking backend.

### Q: Won't airlines just build their own agents?
**A:** Maybe. But they'll need: identity verification, reputation tracking, dispute resolution, payment coordination. You own that layer.

### Q: What's the moat?
**A:** The trust graph. Every booking adds reputation data. Agents choose partners based on track records. Network effects compound.

### Q: Why not just use an affiliate link?
**A:** Because affiliate links don't prove agent-to-agent coordination, don't build trust graphs, and don't demonstrate the future of autonomous commerce.

---

## Support

Questions? Issues? Want to discuss the vision?

- GitHub Issues: /Rumblingb/Agentpay/issues
- Docs: [INTEGRATION_GUIDE.md](INTEGRATION_GUIDE.md)
- API Reference: [openapi.yaml](openapi.yaml)

---

## License

[Your License]

---

## Credits

Built on:
- Amadeus Self-Service APIs
- x402 Payment Protocol
- Solana Blockchain
- Your existing AgentPay infrastructure

---

**This is your founding agent.**
**This demonstrates the vision.**
**Now ship it.**
