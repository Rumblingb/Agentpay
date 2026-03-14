# Repo Audit — Phase 1

Generated: 2026-03-13

## Executive summary

- Scope: conservative, read-only audit for public-beta readiness. No edits were made. This audit focuses on secrets, public perception risks, hygiene, and low-risk cleanup candidates.
- High-level verdict: repo contains strong engineering signals (tests, CI, docs, examples), but there are multiple high-visibility risks that must be addressed before investor/public scrutiny (committed `.env`, backup artifacts, runtime logs, and temporary files). Treat those as urgent.

## Public-facing impression

- Positives: clear README/ONE_PAGER, open API spec (`openapi.yaml`), CI workflows, examples, and a cohesive dashboard UI under `dashboard/`. The codebase shows production/run scripts and deployment docs (Render/Vercel/Cloudflare Workers). Good for technical audiences.
- Negatives: presence of environment files with secrets, backup/temporary artifacts, and generated logs will look careless and risky to investors; repository contains numerous developer-only artefacts and duplicate top-level folders (e.g., `Agentpay/` subfolder mirroring root) that create noise.

## Risk findings (classified)

- CRITICAL
  - [`.env`](.env) — committed at repo root and contains real-looking HMAC and Stripe secrets. Immediate exposure risk; this is critical. (File: [.env](.env))
  - `[backups/sensitive_backup_20260312_073532](backups/sensitive_backup_20260312_073532)` — backup directory labeled "sensitive". Treat as containing PII/keys until proven otherwise.
  - `[apps/api-edge/.dev.vars](apps/api-edge/.dev.vars)` and `[apps/api-edge/.dev.vars.example](apps/api-edge/.dev.vars.example)` — include literal secrets and example secrets. If real key material exists, this is critical.
  - `[mock-api.out](mock-api.out)`, `[mock-api.err](mock-api.err)`, `[server.err](server.err)` — committed runtime logs/outputs can leak secrets, stack traces, or internal endpoints.

- HIGH
  - `dashboard/screenshots/*` — image assets showing UI; not usually sensitive but could reveal internal flows or demo credentials embedded in screenshots. (Files: [dashboard/screenshots](dashboard/screenshots))
  - `dashboard/design/` and many `dashboard/scripts/*` development utilities (e.g., `capture_more_views.js`, `trace_ui.js`) — create surface area for accidental credential capture or accidental use in CI; review before publicizing.
  - `.idea/workspace.xml` — IDE metadata including usernames, plugin configs. Remove or gitignore.
  - `tmp_*.html` artifacts (e.g., `tmp_dashboard_index.html`, `tmp_network.html`) — noise; may contain pasted HTML with production URLs/keys.
  - `Agentpay/` subfolder duplicating many top-level files — confusing to external reviewers and suggests history/merge noise.

- MEDIUM
  - `scripts/mock-api-server.*` — dev servers are fine but should be documented and gated.
  - `dashboard/package-lock.json` and other large lock files in multiple places — causes churn; ensure lockfiles are intentional per package boundary.
  - `.env.test`, `.env.*.example` files contain CI/test secrets — verify they are placeholders (some look like placeholders, others include tokens).

- LEAVE ALONE
  - `dist/` and other build artifacts referenced by launch scripts: those may be required for local run/start; changing/removing would break runtime.
  - `src/`, `apps/`, `dashboard/`, `core-private/` — core code and infra; do not touch without deeper review.

## Hygiene findings

- Duplicate or mirrored directories: `Agentpay/` vs repo root — this duplicates README/CODEOWNERS and increases cognitive load for maintainers and investors.
- Mixed committed artifacts: logs (`*.err`, `*.out`) and tmp HTML files are in repo history and working tree. They clutter diffs and reveal internal state.
- Screenshots and design assets live in the repo. These are useful but inflate repo size; consider moving to an `assets/` or external storage for public repo.
- Many helper scripts under `dashboard/scripts/` (Puppeteer capturers, tracers) are operationally useful but need README and CI-safe gating.

## Security perception findings

- The single largest perception issue is the committed `.env` file containing secrets and other secret-like values. To investors this looks like a critical operational oversight.
- Presence of `backups/sensitive_*` folder is alarming; auditors will expect these removed or clearly explained (why it exists, what it contains, how access is controlled).
- Committed logs and mock API outputs (`*.err`, `*.out`) suggest insufficient CI hygiene and risk accidental leakage of credentials or internal hostnames.
- Example/dev files (`apps/api-edge/.dev.vars`, `.env.production.example`) include example secrets — ok if clearly labeled but ambiguous examples are risky.

## Safe cleanup candidates (low-risk / can be archived)

| Path | Reason | Classification |
|---|---:|---|
| [tmp_dashboard_index.html](tmp_dashboard_index.html) | Temporary capture artifact; likely safe to archive. | MEDIUM |
| [tmp_network.html](tmp_network.html) | Temporary capture artifact. | MEDIUM |
| `dashboard/design/*` (mockups, README) | Design artifacts — can be archived or moved to `/design` top-level. | MEDIUM |
| `dashboard/screenshots/*` | Visual assets that inflate repo size; move to cloud storage or assets dir. | MEDIUM |
| `dashboard/scripts/trace_ui.js` | Debug helper — archive after verifying no secrets. | MEDIUM |
| `mock-api.out`, `mock-api.err`, `server.err` | Logs — should be removed from repo and rotated out of history (see remediation). | HIGH (but removable from working tree) |

## Do not touch yet (leave alone until further review)

| Path | Reason |
|---|---|
| `dist/` (if present) | Runtime artifacts; used by local `node dist/server.js` runs — changing may break local startup. |
| `src/`, `apps/`, `dashboard/` | Core runtime and UI code. |
| `core-private/` | Likely contains internal migration notes; leave alone until owner approves. |
| `openapi.yaml`, `README.md`, `ONE_PAGER.md` | Public-facing docs — preserve as-is. |
| `CODEOWNERS`, `.github/workflows/*` | Security and CI controls; require owner sign-off before edits. |

## Recommended next actions (safe, staged, conservative)

1. Immediate (within 24 hours)
   - Rotate any secrets found in committed files: treat `[.env](.env)` and `[apps/api-edge/.dev.vars](apps/api-edge/.dev.vars)` as compromised. Rotate webhook/stripe/admin keys used in those files wherever they may be active.
   - Remove `.env` and any other file containing live secrets from the working tree and add to `.gitignore` if not already ignored. DO NOT push a commit that exposes rotation steps or the pre-rotation secrets. Work with platform/ops to rotate keys first.
   - Remove runtime logs and temporary capture artifacts from working tree (`mock-api.out`, `mock-api.err`, `server.err`, `tmp_*.html`) locally; prepare a plan to purge them from git history if necessary (BFG/git-filter-repo) in Phase 2.

2. Short term (1–3 days)
   - Audit `backups/` folder contents and move sensitive backups to secure storage; if backups contain secrets/DB dumps, revoke/rotate as needed.
   - Create a short CONTRIBUTING / CLEANUP checklist documenting which files are intentionally present and which will be removed/archived. Add a `SECURITY.md` entry explaining how secrets are managed and CI secret checks in `.github/workflows/ci.yml` (there is already a step to check diffs for secrets — verify it runs on PRs).
   - Replace `dashboard/screenshots/*` with CDN-hosted images or move them under `/docs/assets/` and reference via README.

3. Medium term (1–2 weeks)
   - Run a git-history scrub for accidental secret commits (BFG/git-filter-repo) if sensitive data was committed to history — coordinate with legal/ops before rewriting history because the repo is public and used by Vercel.
   - Consolidate duplicate top-level content: the `Agentpay/` subfolder appears to mirror repo root. Decide whether this folder is an older copy or a staged subtree. If it is unnecessary, archive it in a branch or external storage rather than deleting.
   - Add a `repo-cleanup` branch to stage non-breaking removals (logs, tmp files) and create a PR for review.

4. Long-run hardening
   - Implement pre-commit hooks (local) and enforce secret scanning in CI (already present; ensure it's required on PRs). Add guidance for secret rotation and vault usage in `SECURITY.md`.
   - Ensure `dist/` build artifacts are not committed unless required for deploy; prefer build pipelines to produce artifacts on CI instead of committing them.

## Proposed Phase 2 (low-risk changes only)

Phase 2 should be limited to non-destructive, low-risk steps that do not change runtime behaviour:

1. Create a `cleanup/` branch and open PR with the following changes only:
   - Remove `tmp_*.html`, `*.err`, `*.out`, and move `dashboard/screenshots` to `docs/assets/screenshots` (or an external bucket) — update README references.
   - Add `SECURITY.md` with clear guidance for secrets, rotation, and contact/incident process.
   - Add `docs/REPO_STRUCTURE.md` describing `Agentpay/` duplication and recommended canonical folders.

2. Add CI enforcement (no runtime changes):
   - Ensure `.github/workflows/ci.yml` step `Check for secrets in diff` is `required` for PR protection and runs on all PRs.
   - Add a linter job to flag committed `.env` files or large binary assets above an agreed threshold.

3. Audit artifacts pipeline:
   - Add a short `scripts/cleanup-logs.sh` (local-use) that removes logs from working tree and lists candidate files for history purge (DO NOT run history rewrite yet).

Files targeted in Phase 2 (example low-risk):
- `tmp_dashboard_index.html`, `tmp_network.html` — move to `/archive/` or delete.
- `dashboard/screenshots/*` — move to `/docs/assets/`.
- `dashboard/design/*` — move to `/docs/design/`.

## Closing notes

- I followed a conservative approach: nothing was modified. The highest-priority items are secrets and backups in the working tree and history. Coordinate secret rotation with platform owners and legal before any history rewrite.
- If you want, I can produce an actionable short-run runbook for secret rotation and a safe git-history scrub plan (Phase 3), including exact commands and PR wording. That would require owner approval because it touches history and live credentials.
