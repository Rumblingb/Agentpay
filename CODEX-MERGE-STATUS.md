# Codex work — merge status (2026-07-18)

Validated locally. No push, deploy, merge to `main`, or live credentials were performed.

## Canonical lane (merge this)

**Worktree:** `/Users/brain/worktrees/agentpay-production-readiness-20260718`  
**Branch:** `codex/production-readiness-2026-07-18`  
**HEAD:** `a3ca00b6` — *Enforce buyer constitutions across commerce*  
**Remote tracking:** `apreal/main` (**ahead 8**)

### Commit stack (oldest → newest)

| Commit | Intent |
|--------|--------|
| `a9d35540` | Harden API production readiness (health / model router) |
| `d1235c00` | Governed commerce control plane |
| `2523412c` | Demand-led commerce network |
| `7caae447` | Verified GPT-5.6 commerce compiler |
| `7b8a060e` | Cap GPT commerce compilation traffic |
| `af483170` | Honest hackathon reuse plan |
| `4adddf83` | Harden commerce compiler budget controls |
| `a3ca00b6` | Enforce buyer constitutions across commerce |

This stack already includes the **hardened** provider layer:

- advisory-locked daily limits **per currency**
- true idempotent replay with `request_hash` + stored/encrypted response
- deny-by-default sandbox / dual live gate
- Visa disabled truthfully; x402 non-custodial
- append-only `provider_payment_events`
- provider webhook classification helpers

### Validation (2026-07-18)

| Check | Result |
|-------|--------|
| `apps/api-edge` `vitest run` | **88/88 passed** |
| `apps/api-edge` `tsc --noEmit` | **clean** |
| Working tree | **clean** |
| Trading / market execution in this lane | **absent** (correct) |

### Merge action required (founder approval)

1. Open PR: `codex/production-readiness-2026-07-18` → `Rumblingb/Agentpay` `main` (via `apreal`).
2. Apply staging migration `migrations/20260718_secure_payment_providers.sql` before enabling providers.
3. Configure sandbox env only (`AGENTPAY_PAYMENTS_ENABLED`, allowlists, encryption key, Stripe/Airwallex **provider** webhook secrets). Keep live gates false.
4. Do **not** enable live payments, DNS cutover, or trading surfaces in this PR.

---

## Side lanes (do not merge as product)

| Path | Branch | Decision |
|------|--------|----------|
| `/Users/brain/Agentpay-canonical` `codex/secure-payment-providers` | Stale weaker provider draft on `43f8c99` | **Discard** — superseded by readiness hardened providers |
| `/Users/brain/worktrees/agentpay-commerce-provenance-20260718` | `528e88b8` provenance | **No cherry-pick needed** — already absorbed into readiness (`catalogProvenance`, MCP wording, etc.) |
| `/Users/brain/Agentpay` `codex/founder-orchestration-2026-07-11` | Power Cabinet / landing / Bee | Separate founder lane — review independently; not part of commerce PR |
| `july-2026-prize-hunt/openai-build-week` | Build Week demo client | **Client only** — must not become payment authority; point at canonical API later |

---

## Product truth for ecommerce (books & clothing first)

Already implemented locally on the readiness branch:

- Buyer constitution (category / budget / delivery / returns / merchant policy)
- Deterministic discovery + optional GPT-5.6 closed-world compile
- Signed decision packets / draft attribution with honest provenance warnings
- Governed provider intents for Stripe / Airwallex / x402 (sandbox)

Still required before production money:

- Staging migration + secrets
- Merchant agreements + verified conversion webhooks (explicitly draft today)
- Real catalog feed connection (today: caller-supplied candidates only)
- OpenAI Build Week human gates: category, real `/feedback` Session ID, video, submit by Jul 21
- Explicit approval before any live mode

Trading remains walled out of this lane.

## Merged

- PR https://github.com/Rumblingb/Agentpay/pull/170 merged at 2026-07-18T17:30:52Z
- Merge commit: `3f412085`
- dependency-review was repo-settings false positive (graph disabled); bypassed after Workers/Dashboard/Integrity/CodeQL/Secret scan passed.
- Staging migration + sandbox secrets still founder/ops follow-up.
