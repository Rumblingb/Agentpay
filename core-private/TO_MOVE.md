# Candidate modules for future private extraction

This file lists modules that implement private cores and are likely to be moved to `/core-private` in a future split. DO NOT MOVE FILES YET — this is only a planning placeholder.

- `src/services/*` — trust graph, settlement orchestration, dispute resolution services
- `src/agents/*` — constitutional agents (TrustOracle, SettlementGuardian, DisputeResolver, NetworkObserver)
- `src/escrow/*` — escrow implementations and on-chain adapters
- `scripts/*` that manage DB migrations and seeds for private topics
- Any internal infra that references secrets or operator-only config

When performing the split, move implementations into the private repo and keep the interface definitions in `/interfaces` and adapters in `/adapters` within the public repo.
