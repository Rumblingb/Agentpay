# Repo Stability Cleanup Plan - 2026-04-21

## Purpose

This plan exists to keep the repo stable after the terminal-native AgentPay merge to `main`.

Nothing in this document is a deletion instruction for today.
It is a review list for later cleanup once product direction, ownership, and proof surfaces are clearer.

## What We Preserved On Purpose

These files and surfaces were kept during the merge so the branch would not be destructive:

- `ops/mac-mini/*`
- older dashboard RCM helper routes and components
- legacy test files that still existed on `main`
- older iOS Meridian files
- historical helper files like `apps/api-edge/src/lib/requestBody.ts`

Keeping them was the correct move for merge safety.

## Cleanup Candidates For A Later Pass

### 1. Generated Growth Artifacts

Review whether these should stay committed or move to a generated/runtime-only model:

- `ops/growth/drafts/*-latest.md`
- `ops/growth/reports/weekly-latest.md`
- `ops/growth/research/patterns-latest.md`
- `ops/growth/signals/latest.json`
- dated generated growth artifacts under `ops/growth/*/2026-*.{md,json}`

Recommendation:

- keep templates, README, and intentionally curated examples
- consider moving volatile generated snapshots out of the canonical repo history later

### 2. `ops/mac-mini` Ownership

`ops/mac-mini/*` was preserved because the merge should not delete anything.

Later decision needed:

- keep as an actively supported operator surface
- move to `docs/archive/` if it is historical
- split to a dedicated ops repo if it remains important but should not live in the main product tree

Important:

- `.gitignore` currently blocks `ops/mac-mini/` even though the files are tracked again
- that mismatch should be reconciled in a future hygiene pass

### 3. Legacy RCM And Dashboard Helpers

Review whether these older surfaces are still canonical or now superseded:

- `dashboard/app/(authed)/rcm/OnboardingChecklist.tsx`
- `dashboard/app/api/rcm/workspaces/[workspaceId]/connect-account/route.ts`
- `dashboard/app/api/rcm/workspaces/[workspaceId]/connect-status/route.ts`
- `dashboard/app/api/rcm/workspaces/[workspaceId]/demo-claim/route.ts`
- `dashboard/lib/invoiceFollowUp.ts`

Decision rule:

- if a surface is still used, keep and explicitly mark it supported
- if it is superseded, archive or remove it in a dedicated cleanup pass with QA coverage

### 4. Legacy Tests Restored For Safety

These were restored to avoid destructive merge behavior:

- `apps/api-edge/tests/concierge-execution.test.ts`
- `apps/api-edge/tests/health.test.ts`
- `apps/api-edge/tests/model-router.test.ts`
- `tests/unit/invoiceFollowUp.test.ts`

Later review:

- determine whether they still test live seams
- either modernize or retire them in a dedicated test-hygiene PR

### 5. Meridian iOS Legacy Files

Review:

- `apps/meridian/ios/Ace/AppDelegate.mm`
- `apps/meridian/ios/Ace/Info.plist`

If the mobile runtime has moved on, these may be archive candidates.
Do not remove without confirming current iOS build ownership.

### 6. Docs Drift

The merge restored missing canonical direction docs, but docs are still crowded.

Later cleanup should review:

- duplicate pitch/investor docs
- stale dashboard-first docs
- documents that describe superseded runtime models

Priority docs to keep current:

- `docs/EXECUTION_PROGRAM.md`
- `docs/AGENT_NATIVE_NORTH_STAR.md`
- `docs/REPO_BOUNDARIES.md`
- `docs/TERMINAL_NATIVE_CONTROL_PLANE_20260419.md`
- `README.md`
- `QUICKSTART.md`

## Recommended Next Cleanup Sequence

1. Reconcile `.gitignore` with tracked surfaces, especially `ops/mac-mini`.
2. Decide whether generated growth outputs belong in Git.
3. Mark legacy-but-preserved files as either supported, archived, or pending removal.
4. Run a dedicated archive/remove pass only after ownership is explicit.

## Rule For The Cleanup Pass

Do not mix cleanup with product-seam changes.

When cleanup happens later:

- one PR for generated artifacts policy
- one PR for `ops/mac-mini`
- one PR for legacy dashboard/RCM surfaces
- one PR for stale tests

That keeps trust high and makes it obvious what changed.
