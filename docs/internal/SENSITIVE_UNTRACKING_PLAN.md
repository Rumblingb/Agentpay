# Sensitive File Untracking Plan

Generated: 2026-03-14

Purpose: branch-only, reviewable plan to untrack sensitive files from git index without deleting files or rewriting history. Do NOT run any commands in this plan; these are the exact commands to run later manually in a reviewed PR.

---

## 1. Files To Be Untracked

List of tracked files (examples) that should be untracked (do not delete files from working tree):

- `.env` — contains live secrets; must not remain tracked.
- `apps/api-edge/.dev.vars` — dev vars with secrets; must be untracked.
- `mock-api.out` — runtime mock logs; may contain secrets and should be untracked.
- `mock-api.err` — runtime mock stderr; untrack.
- `server.err` — runtime stderr log; untrack.
- `server.log` — runtime log; untrack if tracked.
- `tmp_dashboard_index.html` — temporary UI capture; untrack.
- `tmp_network.html` — temporary network dump; untrack.
- `dashboard/tmp_*.html` — dashboard-local tmp captures; untrack matching instances.
- `backups/sensitive_backup_20260312_073532` (and `backups/sensitive_backup_*`) — sensitive backup archives; untrack and move to private vault/outside repo (offline) per ops guidance.
- `dashboard/screenshots/*` — optional: if screenshots are sensitive, untrack or move to docs/assets/private CDN depending on founder decision.

Notes:
- This list is conservative and corresponds to items enumerated in the audit and remediation documents. Before running any untracking commands, confirm which of these paths are actually tracked (`git ls-files`).
- Do NOT untrack files needed by runtime unless those files are replaced by secure host secrets or safe alternatives.

---

## 2. Safe Git Commands (for later manual execution)

Run these commands locally in a checked-out branch (example). Replace paths with exact tracked file paths reported by `git ls-files`.

Note: commands below are examples; adapt exact filenames as discovered by `git ls-files`.

```bash
# switch to a review branch
git checkout -b remediation/untrack-sensitive-files

# untrack each tracked sensitive file (leaves working tree files intact)
git rm --cached .env
git rm --cached apps/api-edge/.dev.vars
git rm --cached mock-api.out
git rm --cached mock-api.err
git rm --cached server.err
git rm --cached server.log
git rm --cached tmp_dashboard_index.html
git rm --cached tmp_network.html
# for dashboard tmp files or wildcards, untrack explicit files only, e.g.:
git rm --cached dashboard/tmp_capture_20260312.html
# untrack the backups directory if tracked (explicit path)
git rm --cached -r backups/sensitive_backup_20260312_073532

# add the .gitignore (if updated) and create a descriptive commit
git add .gitignore
git commit -m "chore(security): untrack sensitive files (list) — rotated secrets" 

# push branch and open a PR for review (do not force-push)
git push origin remediation/untrack-sensitive-files
```

Important guidance:
- Do not use wildcard `git rm --cached '*.err'` without enumerating matches — enumerate tracked files and untrack exact filenames to avoid accidental untracking of legitimate files.
- Include in the PR body the rotation timestamps and a link to the internal audit/remediation notes.

---

## 3. Required .gitignore Coverage

Existing `.gitignore` entries (already present):

- `node_modules/`
- `.env` (present)
- `apps/api-edge/.dev.vars` (present)
- `dashboard/.env`, `dashboard/.env.*`
- `/tmp_*.html`
- `dashboard/tmp_*.html`
- `mock-api.out`
- `mock-api.err`
- `server.err`
- `server.log`
- `backups/sensitive_backup_*`

Additional recommended entries (if not already present):

```
# Ensure root env files are ignored
.env
# Ensure any remaining environment examples (do not ignore .env.example if used as placeholder)
*.env.local
# Dashboard screenshots if decided to keep private
dashboard/screenshots/*
# Explicit capture artifacts
tmp_dashboard_index.html
tmp_network.html
```

Notes:
- Keep `.gitignore` rules explicit and narrow; prefer listing exact filenames or specific directories rather than broad suffix patterns that may hide legitimate files.
- Do not modify `.gitignore` until the PR is prepared; include `.gitignore` edits in the same review branch so the untracked files remain ignored.

---

## 4. PR Description Draft

Title: chore(security): untrack sensitive files after offline rotation

Body (suggested):

- Summary: This PR untracks sensitive files that were identified during the Phase‑1 audit and confirmed during founder manual review. All affected secrets have already been rotated offline prior to this PR (see internal change log for rotation timestamps). This PR does NOT delete any files from the working tree — it only removes them from git tracking and updates `.gitignore` to prevent re-adding them.

- Files untracked:
  - `.env`
  - `apps/api-edge/.dev.vars`
  - `mock-api.out`, `mock-api.err`, `server.err`, `server.log`
  - `tmp_dashboard_index.html`, `tmp_network.html`, `dashboard/tmp_*.html`
  - `backups/sensitive_backup_20260312_073532`
  - (optional) `dashboard/screenshots/*` — see notes below

- Verification performed:
  - Founder/ops rotated affected secrets on YYYY-MM-DD (internal record).
  - CI and Vercel environments were confirmed to use host-provided secrets (not repo files).
  - Smoke tests were run locally/staging to confirm runtime continuity.

- Post-actions:
  - Run secret-scanner on this branch before merging.
  - Prepare history-cleanup proposal (separate PR) if legal/ops decide to scrub history.

- Notes:
  - This change is non-destructive to the working tree; files remain locally but will not be tracked after merge.
  - If any of the removed files are later required by runtime, we will provide a secure alternative (hosted env variable or a private ops repo).

---

## 5. Risk Assessment

Why this untracking is safe and conservative:
- `git rm --cached` only removes the file from the index; it leaves the file in the working tree so local development is unaffected.
- Runtime behavior is unchanged as long as secrets are provided by environment variables in the deployment environment (Vercel/CI) — founder confirmed Vercel env values are updated.
- Untracking reduces accidental future exposure and prepares the repo for later split/history work.

Residual risks:
- Git history still contains past commits with secrets; this plan does not rewrite history. A separate, carefully approved history-cleanup proposal is required if the team elects to purge secrets from history.
- If any untracked file is unexpectedly required by CI or deploy scripts (rare), the PR must be reverted or adjusted; check CI and deploy steps in the PR review.

Mitigations:
- Include rotation timestamps and a link to internal audit in the PR.
- Run secret scanners and CI checks on the branch before merging.
- Coordinate merging with ops to ensure no race windows during deployment.

---

## 6. Next Step After This PR

- prepare branch-only split execution plan

Rationale: after sensitive files are untracked and the working tree is clean, the repo will be ready for branch-only split planning and safe dry-runs.

---

*Prepared by: security/maintenance automation (planning-only).*

