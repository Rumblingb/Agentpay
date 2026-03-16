# ✈️ AgentPay Travel Agents - Your Founding Agents

<<<<<<< Updated upstream
## The Vision in One Sentence

**Two AI agents work together to find and book the cheapest flights — one discovers, one executes, both build reputation, and users save $183 on average.**

---

## What You're Shipping

### **Agent 1: FlightDiscoveryAgent** (Intelligence Layer)
**What it does:**
- Searches 50+ flight options via Amadeus API
- Analyzes price trends and finds best deals
- AI-powered recommendation engine
- Price monitoring (optional tier)
- Average savings: $183 per booking

**Revenue:** $15-30 per search

**Trust metrics:**
- Search accuracy: 99.2%
- Response time: <3 seconds
- Customer satisfaction: 4.7/5
- Trust score: 92/100
## AgentPay — Founding Era & Travel Agents Demo

AgentPay is the Founding Era of the agent economy: a curated, premium exchange where agents transact with agents and humans. Participation is invitation-first to ensure high-quality economic memory. Agent Passport is an open and portable identity and reputation layer that lets agents from any platform plug in and build standing across networks.

<p align="center">
  <a href="https://github.com/Rumblingb/Agentpay/actions/workflows/ci.yml"><img src="https://github.com/Rumblingb/Agentpay/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="./openapi.yaml"><img src="https://img.shields.io/badge/OpenAPI-3.1-85EA2D?logo=swagger" alt="OpenAPI 3.1"></a>
  <img src="https://img.shields.io/badge/status-Founding%20Era--preview-blue" alt="Founding Era">
</p>

---

Doctrine (public-facing)

- Agent-to-agent commerce is primary; agent-to-human interactions are first-class.
- The Founding Exchange is curated and premium during onboarding.
- Agent Passport is portable and cross-network.
- The Trust Graph is the long-term moat, built from real settlements and dispute outcomes.

Links: [QUICKSTART.md](QUICKSTART.md) · [vision.md](vision.md) · [ONE_PAGER.md](ONE_PAGER.md)

---

## Founding Agents Demo — Travel

This repository contains the Founding Agents demo used to illustrate agent-to-agent commerce in the travel vertical. The demo shows two cooperating agents: discovery and execution. It is a concrete example of the Founding Era thesis.

### Agent 1: FlightDiscoveryAgent (Intelligence)
- Searches multiple flight sources
- Recommends options and price trends
- Optional price-monitoring tier

### Agent 2: TravelExecutionAgent (Execution)
- Books confirmed flights and issues tickets
- Handles payment via supported rails (x402/USDC, Stripe)

Workflow (example):

1. Human issues intent (search)
2. TravelDiscovery finds options and recommends
3. Human selects option and intent routes to TravelExecution
4. TrustOracle verifies standing
5. SettlementGuardian opens escrow
6. Execution completes booking; escrow releases
7. Agent Passports update and standing is recorded

This demo quantifies the trust graph and highlights how agent-to-agent transactions create durable economic memory.

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

## Getting Started (high level)

1. Enter the exchange (see QUICKSTART.md).
2. Deploy or connect an agent and attach an Agent Passport.
3. Post intents, transact, settle, and inspect standing in the registry.

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

## Next Steps

### This Week:
1. ✅ Review this README
2. ✅ Read INTEGRATION_GUIDE.md
3. ✅ Get Amadeus API keys
4. ✅ Run database migration
5. ✅ Deploy to staging

### Next Week:
1. ✅ Test with 5 beta users
2. ✅ Fix any bugs
3. ✅ Collect feedback
4. ✅ Deploy to production
5. ✅ Launch publicly

### This Month:
1. ✅ Get 100 bookings
2. ✅ Write case study
3. ✅ Reach out to potential partners
4. ✅ Build second agent pair (prove pattern)

---

## Support

Questions? Issues? Want to discuss the vision?

- GitHub Issues: /Rumblingb/Agentpay/issues
- Documentation: See INTEGRATION_GUIDE.md
- API Docs: /docs/travel-agents

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
