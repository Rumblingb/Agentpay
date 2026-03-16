# Foundation Agents Readiness Plan

**Audit date:** 2026-03-10  
**Status after this PR:** Phase 1 complete — agents moved, routes registered, schema extended.

---

## 1. Audit Summary

Four "constitutional layer" TypeScript files were present at the repository **root** with the following issues:

| File (root) | What worked | What was broken |
|---|---|---|
| `IdentityVerifierAgent.ts` | Logic complete | Wrong import (`../db/client`), RS256 JWT with hex key (throws at runtime), missing Prisma models (`VerificationCredential`, `IdentityLink`, missing Agent fields) |
| `ReputationOracleAgent.ts` | Logic complete | Wrong import, missing Prisma models (`ReputationQueryLog`), missing Agent fields (`trustScore`), missing Agent→AgentTransaction relation |
| `DisputeResolverAgent.ts` | Logic complete | Wrong import, `prisma.transaction` references wrong model (fields mismatch), missing `Dispute` model |
| `IntentCoordinatorAgent.ts` | Logic complete | Wrong import, missing `CoordinatedTransaction` Prisma model, `prisma.transaction` fee calls reference non-existent model |

A deployment guide (`FOUNDATION_AGENTS_DEPLOYMENT.md`) existed at root but was aspirational — the described tables and routes did not exist.

---

## 2. What Was Already Complete

- All four agent class implementations (business logic, route decision algorithms, evidence scoring)
- `src/lib/prisma.ts` — Prisma client singleton
- `prisma/schema.prisma` — Agent, AgentTransaction, AgentEscrow, AgentReputation base models
- `scripts/migrate.js` — migration runner pattern (migrations 001–029)
- `src/server.ts` — express app with route mounting pattern
- `jsonwebtoken` package already in `package.json`

---

## 3. What Was Missing

- Correct file location: agents were at repo root, not in `src/agents/`
- Correct Prisma import path (`../db/client` does not exist; correct path is `../lib/prisma`)
- Prisma models:
  - `AgentFeeTransaction` — agent-to-agent fee ledger
  - `VerificationCredential` — identity attestations
  - `IdentityLink` — cross-platform identity graph
  - `ReputationQueryLog` — reputation query audit log
  - `Dispute` — dispute cases with evidence and resolution
  - `CoordinatedTransaction` — intent coordinator routing log
- Agent model fields: `operatorId`, `trustScore`
- Agent model relations: `verificationCredentials`, `identityLinks`
- DB migration for all new tables
- Express routes for the 4 agents (`/api/foundation-agents/...`)
- Server-level registration of the foundation agents router
- IdentityVerifierAgent: RS256 algorithm fix (hex string key cannot sign RS256; changed to HS256)

---

## 4. Misleading / Stale Items

- `FOUNDATION_AGENTS_DEPLOYMENT.md` references `prisma.schema` additions that were not yet applied.
- The deployment guide's "Day 1" database setup instructions reference the old Prisma schema format — the repo uses both raw-SQL migrations (`scripts/migrate.js`) and Prisma schema. The guide only covers the Prisma side.
- The guide's `import { prisma } from '../db/client'` is wrong in context — the correct path after moving to `src/agents/` is `../lib/prisma`.
- The guide assumes `agent.transactions`, `agent.verificationCredentials`, etc. are already set up as Prisma relations — they were not.

---

## 5. Implementation Order (Completed in This PR)

1. **Prisma schema** — add 6 new models + 2 Agent fields + 2 Agent relations
2. **DB migration** — migration `030_foundation_agents` adds all new tables
3. **`src/agents/`** — move and fix all 4 agent files
4. **`src/routes/foundationAgents.ts`** — express router mounting all 4 action handlers
5. **`src/server.ts`** — mount router at `/api/foundation-agents`

---

## 6. API Surface (Post-PR)

All endpoints accept `POST /api/foundation-agents/<agent>` with `{ "action": "...", ...params }`.

| Agent | Endpoint | Actions |
|---|---|---|
| IdentityVerifierAgent | `POST /api/foundation-agents/identity` | `verify`, `link`, `verify_credential`, `get_identity` |
| ReputationOracleAgent | `POST /api/foundation-agents/reputation` | `get_reputation`, `compare`, `get_trust_score`, `batch_lookup` |
| DisputeResolverAgent | `POST /api/foundation-agents/dispute` | `file_dispute`, `submit_evidence`, `resolve_dispute`, `get_case`, `get_history` |
| IntentCoordinatorAgent | `POST /api/foundation-agents/intent` | `create_intent`, `get_status`, `recommend_route` |

---

## 7. Known Remaining Gaps

- `notifyRespondent`, `beginResolution`, `notifyResolution` in DisputeResolverAgent are no-ops (stubs) — production would need webhook/email integration.
- Protocol execution methods in IntentCoordinatorAgent (Stripe, Solana, x402, AP2, bank) are stubs — production would wire in actual payment rail clients.
- `verifyDeploymentProof` and `verifySignatureProof` in IdentityVerifierAgent are permissive stubs — production would verify actual deployment records.
- `IDENTITY_VERIFIER_PRIVATE_KEY` env var is used if present; otherwise a random key is generated per process (credentials cannot be verified across restarts without setting this env var).
- The foundation agents charge fees via `AgentFeeTransaction` — fee amounts are hardcoded; production would read from a pricing config.
- No authentication middleware on foundation agent routes — add `authenticateApiKey` before exposing externally.
