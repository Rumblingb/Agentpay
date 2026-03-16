# Phase 4A Split Plan

Generated: 2026-03-13

Purpose: a conservative, read-only plan to separate public vs private repositories for a live public‑beta codebase. This plan is a migration blueprint only — do NOT execute any steps without founder/operator approval.

---

## 1. Split Objective

- Founder/Investor terms:
  - Protect sensitive operational material (env files, backups, logs) from the public repo while preserving the public beta experience and the public-facing code and docs investors will evaluate. The goal is risk reduction (secrets exposure, accidental execution of ops scripts) while keeping the product stable and demonstrable.

- Engineering terms:
  - Create a minimal private surface that contains sensitive assets and operational tooling, expose only necessary public interfaces (OpenAPI/SDK contracts and launch/runtime artifacts required by Vercel), and keep application runtime and public SDKs stable and import-compatible. Avoid any breaking changes to runtime imports or CI until the split is validated in a branch-only dry run.

---

## 2. Recommended End-State Structure

Public repo (minimal public-beta surface):
- README, ONE_PAGER, openapi.yaml, docs/ (public docs)
- `dashboard/` UI (public build artifacts and source as currently used by Vercel, unless specific sensitive files inside require removal)
- `src/` application code required to run the public beta (but with secrets removed)
- `dist/` (if currently required by production deployment) — leave as-is until verified
- `package.json` (public-facing scripts), but with secrets removed from checked files
- `public-surface/` (or `sdk/`) — interface-only SDKs and OpenAPI-generated client code
- `.github/`, CI workflows (public), but ensure CI does not expose secrets in logs

Private repo (ops + sensitive material):
- `backups/` (sensitive backups and archives)
- Any committed `.env` files, `.dev.vars`, and other secret-bearing files
- Operational scripts that modify workspace state (`scripts/phase2_cleanup.ps1`, other archive/untrack tools)
- Private infra code (private deploy configs, keys, vault scripts)
- Any private-only agent code or `core-private/` content

Shared contract / interface layer (kept public or as a small package):
- `openapi.yaml` (public contract)
- Types/DTOs required by both dashboard and backend (move to `public-surface/` or a tiny package)
- Public SDK stubs (interface-only code that can be imported by the dashboard)

Optional future submodule/package approach:
- Create a private repository `agentpay-ops` containing `backups/`, `scripts/` (ops), and `core-private/`.
- Create a `public-surface` npm package (or monorepo workspace package) containing only interface types and OpenAPI client code; publish to npm or keep as a git subtree/submodule referenced by public repo.

---

## 3. Classification Table

| Path / area | Recommended visibility | Why | Split risk | Notes |
|---|---:|---|---:|---|
| `.env` (root) | PRIVATE | Contains live secrets (critical) | HIGH | Rotate immediately; MUST be removed from public working tree and history under ops/legal guidance |
| `backups/sensitive_backup_*` | PRIVATE | Explicitly labeled sensitive backup | HIGH | Inspect offline; move to secure vault; do not expose publicly |
| `apps/api-edge/.dev.vars` | PRIVATE | Dev vars with secrets (Phase‑1 flagged) | HIGH | If required for deploy, provide safe runtime env via CI/Vercel secrets, not in repo |
| `mock-api.out`, `mock-api.err`, `server.err` | PRIVATE (or archive) | Contain potentially sensitive logs | HIGH | Archive privately; clean working tree only after founder approval |
| `dashboard/screenshots/` | PUBLIC (or ARCHIVE) | Useful for docs but may reveal flows | MEDIUM | Consider moving to `docs/assets/` or private CDN; low risk but review needed |
| `dashboard/` source & build | PUBLIC (LEAVE) | Public UI used by beta/Vercel | HIGH (if moved) | Moving would break Vercel config; only remove sensitive assets inside dashboard, do not relocate whole folder yet |
| `dist/` | LEAVE FOR NOW | Build artifact used by `start` scripts | MEDIUM | Leaving in public repo keeps runtime stable; remove only if build pipeline used instead |
| `src/` (backend) | PUBLIC (LEAVE) | Core runtime code required for beta | HIGH (if moved) | Do not move without careful import/CI updates — risk of breaking beta |
| `core-private/` | PRIVATE | Likely internal notes / private code | MEDIUM | Move to private ops repo
| `scripts/` (ops that touch workspace) | PRIVATE | Contains `phase2_cleanup.ps1` etc. which modify working tree | MEDIUM | Keep development helper scripts that are safe; move destructive ones to private repo |
| `openapi.yaml` | SHARED-CONTRACT | Public API contract needed by SDKs and dashboard | LOW | Keep public; this is the interface surface for integrators |
| `package.json` | PUBLIC (LEAVE) | Public scripts and dependencies used by beta | HIGH (if changed) | Do not change package names or scripts; only remove hard-coded secrets from files referenced by scripts |
| `Agentpay/` duplicated folder | LEAVE FOR NOW / REASSESS | Duplication confuses reviewers | LOW | Consider archiving duplicate after confirming it's not used by CI or deploys |
| `.github/workflows` | PUBLIC (LEAVE) | Public CI; ensure secrets are stored in repository host secrets | MEDIUM | Do not remove; ensure secret scanning on PRs is enforced |

Notes on table: classification errs on the side of leaving runtime code in place to preserve beta stability while removing sensitive operational material.

---

## 4. Dependency and Import Risk Analysis

Key observations:
- `package.json` `main` is `dist/server.js`. The Node start process may rely on `dist/` being present; moving `src/` or `dist/` could break runtime if builds are expected or if `dist` is referenced by CI or deploy scripts.
- Relative imports: many internal modules likely use relative paths (e.g., `../../lib/foo`); moving files into a different repo will break these imports unless an explicit package boundary (npm package/submodule) is introduced.
- `dashboard/` may import server-shared utilities (types or small helpers) by relative path or by referencing local `src/` content. If those shared utilities are moved to a private repo, the dashboard must be updated to depend on a published interface package or a submodule — this is non-trivial.
- `apps/api-edge` appears to contain Cloudflare worker code and dev vars; if moved privately, deployment references or CI may break unless CI provides the necessary files via secrets or separate repo.
- `core-private/` may be referenced by scripts; moving it privately could break developer tooling if scripts assume local paths exist.

Places likely to break if split naively:
- Dashboard imports of backend DTOs/types or helper code that are currently referenced with relative paths.
- CI workflows that reference files by path (e.g., scripts/create-db.js) and expect them in this repo.
- Vercel/Render deployments that read repo files at build time (if any build-time files are moved, deployment will break).

Unknowns (must validate before split):
- Exact import locations between `dashboard/` and `src/` (uncertain without code search). If cross-imports exist, moving code will require packaging shared types or using an interface package.
- Whether `dist/` is required by the current production workflow or if production builds on Vercel; treat as uncertain and verify.

---

## 5. Safe Migration Strategy (conservative, numbered)

1. Founder/operator approval: confirm secret rotation plan and legal/ops sign-off for handling backups and history edits. DO NOT proceed without this.
2. Create a private repository `agentpay-ops` (ops-only; do NOT push anything yet). This is a placeholder for planning — do not create it until founder instructs.
3. In a protected branch on the public repo (e.g., `phase4/split-dryrun`), add lightweight scaffolding only (no code moves): a `SPLIT_MAP.md` that enumerates files to move, and a `public-surface/` package placeholder describing expected public interfaces. Commit only the plan docs.
4. Produce a mapping file `split-map.json` (branch-only, no execution) listing exact file paths proposed for private repo, with SHA references and reasons. This is a dry-run artifact for review only.
5. Validate imports locally: run a read-only search (developer-run) to detect cross-repo imports (dashboard <-> src). Create a small report listing each cross-reference and suggested handling (move to `public-surface` package, or keep in public repo). Do not change code yet.
6. For each shared artifact (types, OpenAPI client), extract or generate an interface-only package (`public-surface`) in the branch and update import references in the branch to point to the new package path (use local package reference, not published). Run local build/tests to verify; if tests fail, revert. This step is branch-only and must not be merged until founders approve.
7. After tests pass in branch and founder confirms, create private repo, copy the private files there (offline/private transfer), and replace the public files with clear stubs or removal in a PR that documents the move. Use `git rm --cached` locally if needed — but do not rewrite history yet.
8. Deploy validation: use a staging deployment (not production beta) to verify the site runs with private assets provided via repo host secrets or private repo access. Only after staging success consider production switch.

Important: at every step coordinate with founder/ops and legal. This plan intentionally delays any history rewrite until secrets are rotated and founders approve.

---

## 6. Minimum Viable Split (MVS)

Definition: the smallest change that meaningfully reduces public risk while preserving beta stability.

MVS actions (branch-only, reviewable):
1. Move/contain the following files to private ops repository (or archive outside VCS) — do not change imports in public repo:
   - `.env` and any `.env.*` containing real secrets
   - `backups/sensitive_backup_*` directory
   - `apps/api-edge/.dev.vars`
   - `mock-api.out`, `mock-api.err`, `server.err` (tracked files) — untrack in working tree via `git rm --cached` in a planned PR (only after founder approval)
2. Remove or move destructive ops scripts from `scripts/` into private ops repo (e.g., `phase2_cleanup.ps1`). Keep a small, documented README in public repo referencing the ops repo for ops-only tooling.
3. Keep `dashboard/`, `src/`, `dist/`, `package.json`, and `openapi.yaml` public.

Rationale: this yields immediate reduction of public secrets exposure without touching runtime code or imports.

---

## 7. What Must Not Move Yet

- `dashboard/` (entire folder) — moving will likely break Vercel deployment and public beta.
- `src/` backend runtime code — preserve in public repo to avoid breaking imports and beta runtime.
- `package.json`, `tsconfig.json`, lockfiles, and CI workflows — these control build and deploy and should remain stable until the split is validated.
- `dist/` — leave for now to preserve runtime start scripts.
- Any file referenced by CI or Vercel build steps (unknowns must be audited before moving).

---

## 8. Open Founder Decisions

1. Secret handling policy: rotate secrets now and confirm a vault/provider for private secrets (Yes/No). If Yes, provide credentials and timeline.
2. Approve a private ops repo to hold `backups/`, `.env` files, and destructive scripts (Yes/No). If No, propose an alternative (e.g., encrypted artifact store).
3. Agree on minimum viable split items (the MVS list above) and sign off to proceed with a branch-only dry run.
4. Decide whether to permit a git-history rewrite to remove previously committed secrets (requires legal/ops review and communication plan).
5. Decide if `dashboard/screenshots/` should remain public or be archived privately.

---

## 9. Recommended Next Step (choose exactly one)

- founder review before any split execution

Rationale: given the critical items (`.env`, `backups`, logs) and the live Vercel beta, the founder/operator must approve secret rotation and the private repo approach before any execution or branch-only split planning.

---

Appendix — quick notes
- This plan assumes the public beta must remain stable and that minimal changes are preferred. Many technical details (exact import cross‑references) are uncertain without a targeted code search; those should be run in a read-only branch to produce a cross-reference report before moving files.
- If you want, I can produce `split-map.json` (branch-only) listing exact file paths and suggested destinations for founder review; I will not execute any moves unless explicitly instructed.

---

Single recommended next step:
- Ask the founder to approve secret rotation and the proposed MVS list before any split execution.

Top 3 highest-risk areas for the planned split:
1. Committed `.env` and any files containing live secrets (critical)
2. `backups/sensitive_backup_*` (contains unknowns, may include PII or DB dumps)
3. Cross-references/imports between `dashboard/` and backend `src/` (may break Vercel builds if shared code is moved)

Is the repo ready for branch-only split execution planning? NO — not until secrets are rotated and founder/ops sign off.

NO SPLIT EXECUTED
