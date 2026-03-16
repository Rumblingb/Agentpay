# Foundation Agents — Ship Checklist

Pre-production readiness gate for the 4 constitutional layer agents.

---

## ✅ Already Complete (post-PR)

### Schema / Database
- [x] Prisma schema updated — 6 new models + 2 Agent fields + 2 Agent relations
- [x] Migration `030_foundation_agents` added to `scripts/migrate.js`
- [x] All new tables idempotent (IF NOT EXISTS)
- [x] Migration covers: `verification_credentials`, `identity_links`, `reputation_query_logs`, `disputes`, `coordinated_transactions`, `agent_fee_transactions`
- [x] Agent model extended: `operator_id`, `trust_score` columns

### Code
- [x] All 4 agents in `src/agents/` (previously at repo root — wrong)
- [x] Import path fixed: `'../db/client'` → `'../lib/prisma'`
- [x] IdentityVerifierAgent: RS256 → HS256 (hex key works for HMAC; would fail for RSA)
- [x] All `prisma.transaction.create(...)` fee calls → `prisma.agentFeeTransaction.create(...)`
- [x] DisputeResolverAgent: `prisma.transaction.*` → `prisma.agentTransaction.*` with field mapping
- [x] ReputationOracleAgent: fetches buyer + seller transactions separately (no broken bi-directional include)
- [x] Barrel export: `src/agents/index.ts`
- [x] Express router: `src/routes/foundationAgents.ts`
- [x] Mounted in `src/server.ts` at `/api/foundation-agents`
- [x] Build: `npm run build` exits with 0 TypeScript errors
- [x] Tests: 817/817 passing, 0 regressions

### Deployment
- [x] Seed script: `scripts/seed-foundation-agents.ts` (idempotent upsert)
- [x] `npm run seed:foundation-agents` added to `package.json`
- [x] CLI commands: `agentpay foundation list` + `agentpay foundation inspect <name>`
- [x] Deployment guide rewritten: `FOUNDATION_AGENTS_DEPLOYMENT.md`

### Public Visibility
- [x] Foundation agents seeded as `service = 'constitutional-agent'` → appear in leaderboard
- [x] `AgentDossier.tsx`: "Constitutional Foundation Agent" label + violet badge
- [x] `registry/page.tsx`: "⚙ Constitutional" violet badge on registry rows
- [x] `GET /api/agents/:agentId` response: `isFoundationAgent: boolean`
- [x] `GET /api/agents/leaderboard` response: `isFoundationAgent: boolean`

### Documentation
- [x] `docs/FOUNDATION_AGENTS.md` — full developer reference
- [x] `docs/FOUNDATION_AGENTS_READINESS_PLAN.md` — audit findings
- [x] `docs/ARCHITECTURE.md` — Constitutional Agents domain row + API endpoints added
- [x] `docs/API_DESIGN.md` — foundation agent endpoints section added

---

## ✅ Hardened in PR #104 Follow-Up

These issues identified in the PR #104 review were fixed in the hardening pass:

- [x] `authenticateApiKey` added to all `POST /api/foundation-agents/*` routes
  - `GET /api/foundation-agents` manifest intentionally remains public
- [x] `req.merchant.id` used server-side for all fee billing — caller cannot override
- [x] `IDENTITY_VERIFIER_PRIVATE_KEY` absence is an explicit startup warning (not silent)
- [x] Ephemeral key mode is tracked as `keyMode: "ephemeral"` in credential responses
- [x] Trust level capped at `"attested"` when key is ephemeral OR proof stubs are active
- [x] Proof stub methods renamed to `_betaStub_verifySignatureProof` / `_betaStub_verifyDeploymentProof`
- [x] Proof stubs emit per-call `console.warn` with `[IdentityVerifierAgent] BETA:` prefix
- [x] `proofVerificationMode: "beta_stub"` field present in all credential responses
- [x] `DisputeResolverAgent.notificationMode = "disabled"` field + in DisputeCase response
- [x] Dispute notify/resolution stubs emit per-call `console.warn` with case IDs
- [x] `IntentCoordinatorAgent.executionMode = "simulated"` field + in CoordinatedTransaction response
- [x] All `executeVia*` methods have `SIMULATED STUB` doc comments + `simulated: true` in step details
- [x] `executeIntent` emits per-call `console.warn` when `executionMode === "simulated"`

---

## ⚠️ Required Before Production Traffic

These items must be completed before routing real transactions through any of the 4 agents.

### Security
- [ ] Set `IDENTITY_VERIFIER_PRIVATE_KEY` in production environment
  - Without it, credentials cannot be verified across server restarts (ephemeral key)
  - Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
- [ ] Rate-limit foundation agent endpoints
  - Reputation queries and intent coordination could be used to scrape the graph at low cost

### Identity Agent
- [ ] Implement `_betaStub_verifyDeploymentProof(environment, proof)` — currently always `true`
  - Production: ping the claimed deployment URL and verify response signature
  - Change `proofVerificationMode` to `'live'` once implemented
- [ ] Implement `_betaStub_verifySignatureProof(agentId, signature)` — currently always `true`
  - Production: verify Ed25519/secp256k1 signature against agent's registered public key
  - Change `proofVerificationMode` to `'live'` once implemented
  - Once live, `"verified"` trust level will become issuable

### Dispute Agent
- [ ] Implement `notifyRespondent(dispute)` — currently logs warning, no actual delivery
  - Production: send webhook or email to respondent with case ID and 48h deadline
  - Change `notificationMode` to `'live'` once implemented
- [ ] Implement `notifyResolution(dispute)` — currently logs warning, no actual delivery
  - Production: notify both parties with outcome and reputation delta
- [ ] Implement `beginResolution(caseId)` — currently logs warning, no auto-scheduling
  - Production: schedule an async job (cron/queue) to call `resolveDispute` after evidence window

### Intent Coordinator
- [ ] Wire Stripe execution in `executeViaStripe()` — currently simulated
  - Production: `await stripe.paymentIntents.create({...})`
  - Change `executionMode` to `'live'` once all protocols are implemented
- [ ] Wire Solana execution in `executeViaSolana()` — currently simulated
  - Production: `await connection.sendTransaction({...})`
- [ ] Wire x402/AP2 execution — currently simulated
- [ ] Wire bank/ACH execution — currently simulated

### Operational
- [ ] Run `node scripts/migrate.js` on all environments (staging, production)
- [ ] Run `npm run seed:foundation-agents` on all environments after migration
  - Set `API_BASE_URL` env var to the deployed API base before running
- [ ] Verify seeded agents appear in `GET /api/agents/leaderboard`
- [ ] Verify `agentpay foundation list` returns all 4 agents in production

---

## ℹ️ Deferred (No Hard Blocker)

These are real gaps but not blockers for initial deployment with low traffic.

| Item | Notes |
|---|---|
| `IDENTITY_VERIFIER_PRIVATE_KEY` rotation | One key per process; rotation path not implemented |
| Dispute evidence hash verification | `contentHash` is stored but not verified against actual content |
| Foundation agent fee real debit | `agent_fee_transactions` records are created; no actual token transfer |
| Reputation score persistence | `trust_score` is written by `DisputeResolverAgent.updateReputationScores` but not by `ReputationOracleAgent.getReputation` (calculate-and-return only) |
| Foundation agent availability monitoring | No health check or circuit breaker |
| Multi-tenancy | All 4 agents are platform-global; no per-merchant isolation |

---

## How to Verify After Deployment

```bash
# 1. Check migration ran
node scripts/migrate.js

# 2. Seed agents
npm run seed:foundation-agents

# 3. List agents via CLI
AGENTPAY_API_BASE=https://your-api.example.com node cli/agentpay/index.js foundation list

# 4. Spot-check one agent
curl https://your-api.example.com/api/foundation-agents

# 5. Test reputation query (no auth required currently)
curl -X POST https://your-api.example.com/api/foundation-agents/reputation \
  -H 'Content-Type: application/json' \
  -d '{"action":"get_trust_score","agentId":"00000000-fa00-0000-0000-000000000001","requestingAgentId":"any"}'

# 6. Verify agents appear in registry
curl https://your-api.example.com/api/agents/leaderboard | jq '.leaderboard[] | select(.isFoundationAgent)'
```

---

## Files Changed in This PR

| File | Change |
|---|---|
| `prisma/schema.prisma` | 6 new models, 2 Agent fields, 2 Agent relations |
| `scripts/migrate.js` | Migration 030_foundation_agents |
| `scripts/seed-foundation-agents.ts` | NEW — seeds 4 agents into DB |
| `package.json` | Added `seed:foundation-agents` script |
| `src/agents/IdentityVerifierAgent.ts` | NEW — moved from root, imports + JWT fixed |
| `src/agents/ReputationOracleAgent.ts` | NEW — moved from root, imports + query fixed |
| `src/agents/DisputeResolverAgent.ts` | NEW — moved from root, imports + model refs fixed |
| `src/agents/IntentCoordinatorAgent.ts` | NEW — moved from root, imports fixed |
| `src/agents/index.ts` | NEW — barrel export |
| `src/routes/foundationAgents.ts` | NEW — Express router at /api/foundation-agents |
| `src/server.ts` | Import + mount foundationAgentsRouter |
| `src/routes/agents.ts` | `isFoundationAgent` added to leaderboard + detail responses |
| `cli/agentpay/index.js` | `foundation list` + `foundation inspect` commands |
| `FOUNDATION_AGENTS_DEPLOYMENT.md` | Rewritten — accurate commands, no stale content |
| `dashboard/app/network/agents/[id]/AgentDossier.tsx` | Constitutional badge + label |
| `dashboard/app/registry/page.tsx` | Constitutional chip in registry table |
| `docs/FOUNDATION_AGENTS.md` | NEW — full developer reference |
| `docs/FOUNDATION_AGENTS_READINESS_PLAN.md` | NEW — audit findings |
| `docs/ARCHITECTURE.md` | Constitutional domain row + API endpoints |
| `docs/API_DESIGN.md` | Foundation agents endpoint section |
