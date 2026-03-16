# Sensitive Remediation Plan

Generated: 2026-03-13

Purpose: founder-controlled planning for remediation of sensitive material in a live public‑beta repository. This document is planning-only: do not execute any remediation steps without founder/operator approval.

---

## 1. Risk Summary

Current sensitive-material risks identified:
- Committed `.env` at repo root (contains live secrets) — CRITICAL.
- `backups/sensitive_backup_*` directory containing unknown, labelled-sensitive content — CRITICAL.
- Committed runtime logs and temp artifacts (`mock-api.out`, `mock-api.err`, `server.err`, `tmp_*.html`) — HIGH.
- Dev/private var files under `apps/api-edge/.dev.vars` (and similar) — HIGH.
- Ops scripts that modify the working tree present in `scripts/` (e.g., `phase2_cleanup.ps1`) — MEDIUM risk if left public.
- Screenshots/design assets that may reveal internal flows or credentials — MEDIUM.
- Sensitive items may also appear in git history (past commits) — unknown scope until inventory.

---

## 2. Likely Secret Categories

Without exposing values, these are the categories of secrets likely present:
- API keys (third‑party services like Stripe, Solana providers, travel APIs)
- Webhook/shared‑secret tokens (for incoming webhook verification)
- Service account credentials (cloud provider keys, CI service tokens)
- Database URLs / DB credentials (Postgres connection strings)
- Vercel/project tokens and other deploy tokens
- OAuth / third‑party provider credentials (travel providers, payment gateways)
- Auth/session secrets (session cookies, admin secret keys, signing keys)
- Misc signing or HMAC keys (used for internal verification)

---

## 3. Founder Manual Review Checklist

Do these inspections manually (do not commit or push any changes). Record findings in a private, auditable log.

A. Inventory and verify presence
1. Open `.env` and all `*.env*` files (locally, offline). Note which keys are present and tag each with a category (API key, DB URL, webhook secret, etc.).
2. Inspect `apps/api-edge/.dev.vars` and other dev var files.
3. List files under `backups/sensitive_backup_*` and review contents offline (do not copy contents to public places).
4. Identify any `*.out`, `*.err`, `tmp_*.html` files in the working tree and note if they are tracked by git (`git ls-files` locally) — do not run git history rewrite.

B. Map usage and blast radius
1. For each identified secret, map where it is used: which services, which CI jobs, which Vercel project, and any external dashboards (Stripe, Postgres host, Sentry, etc.).
2. Identify which secrets are production-facing vs development-only.
3. For DB URLs, identify which database instance they point to (production or preview).

C. Access & scope
1. Confirm who has access to the systems these secrets unlock (list team members, cloud accounts, and third‑party dashboards).
2. Check Vercel environment variables for the beta project — compare values with committed files to find overlaps.

D. Risk sign-off points
1. Document any secrets that are definitely live/active. These require immediate rotation.
2. For backups, determine whether data contains PII/production DB dumps — if yes, flag for legal/ops.

---

## 4. Rotation Plan (practical order)

Goal: rotate compromised secrets with minimal beta disruption.

Pre-rotation preparation (founder/operator):
- Assemble operations point-of-contact and list of external provider dashboards (Stripe, Postgres, Sentry, Vercel, cloud provider). Have credentials and access owners available.
- Create a private change ticket and communication plan (who will update Vercel envs, who will rotate keys, rollback plan).

Rotation order (recommended):
1. Invalidate and rotate high-privilege admin keys and signing keys used for internal admin access (e.g., `ADMIN_SECRET_KEY`, admin API keys).
2. Rotate webhook/shared-secret tokens (these can break incoming webhooks; coordinate with providers to apply new secret quickly).
3. Rotate payment provider keys (Stripe) and any keys that could enable financial actions.
4. Rotate database credentials and update DB credentials in Vercel/hosting before deactivating old credentials. If changing DB host/credentials require app restart, schedule brief maintenance window.
5. Rotate service account / cloud provider credentials (if any) and update CI/hosted secrets.
6. Rotate lower‑risk API keys and developer tokens.

Validation after each rotation:
- Update the secret in the target environment first (Vercel/CI/etc.), verify the running service accepts the new secret, then revoke the old secret.
- Run a smoke-test (local or staging) that exercises core flows; confirm no regressions before moving to the next secret.

Notes:
- Always update secrets in the hosting environment (Vercel) before revoking the old value to avoid service disruption.
- Prioritize secrets that, if leaked, allow data exfiltration or financial operations.

---

## 5. Post-Rotation Repository Actions

After rotation and confirmation, perform these repository actions in a controlled, reviewable manner (branch + PR):
1. Create a PR that untracks sensitive files from the working tree using `git rm --cached <file>` for each tracked sensitive file (e.g., `.env`, `mock-api.out`). Include a detailed PR description listing all rotated secrets and confirmation timestamps.
2. Update `.gitignore` to include explicit entries for any temp/log patterns (confirm they match observed files). Keep patterns narrow and explicit.
3. Add `SECURITY.md` describing secret handling policy and contact for incident response.
4. Do NOT perform a history rewrite until legal/ops confirm and a communication plan is prepared. Prepare a separate proposal/plan for history purge (BFG/git-filter-repo) if required.
5. Run secret scanners on the cleaned branch to verify no live secrets remain in the working tree or newly introduced files.
6. Confirm Vercel and CI are using secrets from repository host vaults (not committed files). Ensure deploy logs do not print secrets.
7. Record all changes, rotates, and PRs in an internal change log for audit.

---

## 6. What Not To Do Yet

- Do NOT rewrite git history (BFG/git-filter-repo) until secrets are rotated and legal/ops approve — history rewrite is disruptive and irreversible for collaborators.
- Do NOT perform the public/private split until rotation is complete and validated.
- Do NOT run or push any cleanup scripts that modify the working tree (e.g., `phase2_cleanup.ps1`) without explicit dry-run + approval.
- Do NOT commit or push any remediation artifacts containing secret values (e.g., rotated keys in files). Use environment host secrets.
- Do NOT remove or move `dashboard/`, `src/`, `package.json`, or CI files until split and rotation are complete and tested in a branch/staging.

---

## 7. Recommended Next Step (choose exactly one)

- founder manual review now

Rationale: before any rotation or repo changes, the founder must manually validate the inventory, confirm which secrets are live, and authorize the rotation plan and the communication plan.

---

## Appendix — Quick Practical Commands (for founder/ops to run locally)

Run these locally and privately as part of the review (do not push results):

- List tracked files matching common patterns:

```powershell
git ls-files | Select-String -Pattern "(^|/)\.env$|tmp_.*\.html$|\.err$|\.out$|backups/sensitive_backup_"
```

- Search for likely secret-looking strings (do this locally; do not paste results):

```powershell
Select-String -Path "**/*" -Pattern "(?i)(api_key|webhook|secret|ADMIN_SECRET|STRIPE|DATABASE_URL|postgres|password)" -SimpleMatch
```

(Use care: do not copy secret values into public places.)

---

Single recommended next step:
- founder manual review now

Three most urgent founder actions:
1. Inventory `.env` and `apps/api-edge/.dev.vars` offline and mark which keys are live.
2. Rotate highest-privilege keys (admin/signing/DB) in the hosting environment and verify service continuity.
3. Inspect `backups/sensitive_backup_*` offline and decide secure archival or deletion.

NO REMEDIATION EXECUTED
