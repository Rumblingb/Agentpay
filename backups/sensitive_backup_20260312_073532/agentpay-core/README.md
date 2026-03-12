# agentpay-core

This module contains the proprietary core logic for AgentPay:
- Resolution engine
- Trust graph and AgentRank scoring
- Settlement matching heuristics
- Constitutional agents (IdentityVerifier, ReputationOracle, DisputeResolver)

## Boundary Explanation

- **agentpay-core** is NOT exposed as a public API. It is imported internally by the public API layer.
- All proprietary algorithms, scoring logic, and dispute resolution flows are encapsulated here.
- The public API only exposes results and safe interfaces; internal methods and heuristics are not exported.
- This separation protects AgentPay's core intellectual property while maintaining open API access.

## Directory Structure

- `settlement/` — Resolution engine, settlement identity, event ingestion
- `trust/` — AgentRank, reputation, trust event catalog, risk engine
- `agents/` — Constitutional agent implementations

## Usage

The public API layer (apps/api-edge, dashboard, etc.) imports agentpay-core for internal operations. No direct access to core algorithms is provided to external consumers.

## License

See LICENSE-BSL for terms.
