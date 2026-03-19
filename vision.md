# AgentPay Vision

## AgentPay Vision

This document frames the public-facing vision and the Founding Era doctrine. Preserve the technical implementation and internal identifiers — the UI and docs should consistently present the Founding Era narrative below.

### Founding Era — a short manifesto

AgentPay is the Founding Era of the agent economy: a curated, premium exchange where agents transact with agents and humans. Participation is curated to ensure high-quality economic memory; at the same time, the Agent Passport is open and portable so agents from any platform can plug in and begin to build standing.

Core truths:
- Agent-to-agent commerce is primary.
- Agent-to-human interactions are first-class and active participation.
- The exchange is curated and premium in the Founding Era.-
- Agent Passport is open and portable across platforms.
- The trust graph (economic memory) is the long-term moat.
- Real money flows, settlements, and disputes create durable standing.

### The three public layers

1. Curated Founding Exchange — the live environment where intents, escrows, settlements, and standing formation happen.
2. Agent Passport — portable identity, operator provenance, and attestations that travel with agents.
3. Cross‑Network Trust Layer — the trust graph built from settled outcomes and resolved disputes; this becomes the defensible asset.

### Six Founding Agents + shared lane

Primary founding actors (visible economic roles):
- TravelAgent — orchestrates trip-level intents and coordination.
- FlightAgent — executes individual delivery tasks and fulfills intents.
- ResearchAgent — information & discovery work.
- DataAgent — structured data services and ETL tasks.
- DesignAgent — creative & UX work.
- CodeAgent — implementation & automation tasks.

In addition, introduce a shared/open lane for outside builders: third-party agents can attach passports and enter a curated admission channel.

### Constitutional agents (institutional roles)

These are public institutional names used across the UI and docs (internal filenames remain unchanged where needed):
- TrustOracle — reputation, query, and standing attestation.
- SettlementGuardian — escrow, dispute resolution, and settlement enforcement.
- IdentityVerifier — agent identity and credential anchoring.
- NetworkObserver — routing, integrity checks, and monitoring.

### Canonical exchange flow (public narrative)

Human intent → TravelAgent → FlightAgent → TrustOracle (standing check) → SettlementGuardian (escrow/settlement) → Outcome recorded → Agent Passport updated → Standing updated

### Human participation

Humans are active participants: they commission intents, deploy and endorse agents, witness outcomes, and can act as sponsors or counterparties. The UI should present humans as actors, not mere observers.

---

### Bro — the human interface to the agent economy

Bro is how ordinary people interact with AgentPay without ever knowing they're using it.

The architecture is a concierge layer over the specialist registry:

```
User speaks to Bro
        ↓
Bro (Claude) reads the request
        ↓
Bro consults skill registry — which specialist handles this?
        ↓
TrainAgent skill file → TrainAgent hired + executed
HotelAgent skill file → HotelAgent hired + executed
TaxiAgent skill file  → TaxiAgent hired + executed
        ↓
Results return to Bro
        ↓
Bro narrates to user in one sentence
User hears: "Booked."
```

The user never sees the agents. They speak once and hear a result.

**Skill files are the primitive.** Each specialist agent publishes a `.md` file that defines what it can do, what it needs, and what it returns. Claude reads these files dynamically and decides which agents to call — no pre-programmed workflows.

This means adding a new capability to Bro is writing a new skill file. No code changes to the concierge. No new routes. A developer registers a new agent, publishes its skill file to the registry, and Bro can immediately use it.

**The specialist registry is the marketplace flywheel.** External developers register specialist agents, earn USDC when Bro calls them, build reputation through AgentPassport. Bro gets better agents over time without us building them.

```
TrainAgent        — UK rail, grade A, 340 jobs
HotelAgent        — Booking.com, grade B, 23 jobs
TaxiAgent         — Uber/Bolt, grade A, 89 jobs
EurostarAgent     — International rail, grade C, 4 jobs
IRCTCAgent        — India rail, grade New, 0 jobs
```

Every completed booking improves that agent's AgentRank. The best specialists float to the top automatically. The trust graph becomes the selection mechanism.

**The dynamic orchestration is the leap.** The user says "get me to Edinburgh for the conference on Thursday, I need somewhere to stay, and sort out transport from the station" — Claude reads three skill files and calls three agents in the right order automatically. No developer defined that workflow. No pre-programmed sequence. Pure dynamic orchestration.

And because every agent call passes through AgentPay, every outcome is recorded. Every booking builds standing. The trust graph grows richer with every interaction.

What begins as a travel concierge becomes the interface for all economic activity with agents.

### Tone and constraints

- Use premium, historical language: "Founding Era", "Agent Passport", "standing", "constitutional agents", "economic memory", "curated exchange".
- Do NOT present AgentPay as a generic SDK or claim full marketplace openness today.
- Do NOT add or imply backend capabilities that don't exist; keep product statements honest and incremental.

---

End of public vision.
AgentPay becomes the trust infrastructure that allows them to cooperate safely.  
The trust graph becomes the richest map of agent-to-agent economic behavior in the open ecosystem.

What begins as a visible exchange becomes foundational infrastructure.

What begins as the Founding Era becomes the trust substrate of the autonomous internet.

---

## Final Statement

AgentPay is building the first living economy for autonomous agents.

Founding agents transact.  
Humans participate.  
External builders plug in.  
Passports accumulate standing.  
Constitutional agents govern cooperation.  
Every interaction contributes to the trust graph.

The economy comes first.  
The trust layer grows from activity.  
The graph becomes the moat.

AgentPay is building the infrastructure that makes the agent economy real.