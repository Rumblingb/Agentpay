# Untracking PR Checklist

## 1. Branch Preparation

Create a branch for the untracking PR from the current `main` (or chosen protected branch). Replace the branch name with your convention and the date.

```bash
git fetch origin
git checkout -b untrack/sensitive-files-YYYYMMDD
```

Do not push yet. This branch will hold only the index changes (files removed from Git index but kept locally).

## 2. File Verification

Confirm which sensitive files are currently tracked (exact commands). If any command returns output, that file is tracked.

```bash
# Check specific known sensitive paths (replace or add paths as needed)
git ls-files -- .env
git ls-files -- apps/api-edge/.dev.vars
git ls-files -- mock-api.out
git ls-files -- mock-api.err
git ls-files -- server.err
git ls-files -- server.log
git ls-files -- tmp_dashboard_index.html
git ls-files -- tmp_network.html
git ls-files -- backups/sensitive_backup_20260312_073532

# Show staged/unstaged status for these files
git status --porcelain | grep -E '\.env|api-edge/.dev.vars|mock-api|server.err|server.log|tmp_'

# Show full index entries for pattern matches (optional)
git ls-files -s | grep -E '\.env|mock-api|server.err|server.log|tmp_'
```

Before proceeding, ensure the outputs match expectations documented in `SENSITIVE_UNTRACKING_PLAN.md`.

## 3. Safe Untracking Commands

These are the exact `git rm --cached` commands that will be executed later (copy/paste into the branch when ready). They remove the files from the index but keep local copies.

```bash
git rm --cached .env
git rm --cached apps/api-edge/.dev.vars
git rm --cached mock-api.out
git rm --cached mock-api.err
git rm --cached server.err
git rm --cached server.log
git rm --cached tmp_dashboard_index.html
git rm --cached tmp_network.html
git rm --cached -r backups/sensitive_backup_20260312_073532
```

Notes:
- The `-r` flag is used for the backup directory to remove tracked files under it from the index.
- Do not run any other `git rm` variants that delete the working tree files (avoid `git rm` without `--cached`).

## 4. Commit Step

Stage and commit the index-only removals with a single, clear commit message.

Exact commands to run (when ready):

```bash
# Stage all index changes (after running the git rm --cached commands above)
git add -A

# Exact commit message to use (copy verbatim):
git commit -m "chore(secrets): untrack sensitive files (remove from index, keep local copies)"
```

Staged files summary (expected):

```
.env
apps/api-edge/.dev.vars
mock-api.out
mock-api.err
server.err
server.log
tmp_dashboard_index.html
tmp_network.html
backups/sensitive_backup_20260312_073532/*
```

Confirm `git show --name-only --pretty="" HEAD` shows only the above paths before pushing.

## 5. PR Creation

Push the branch and open a PR for review. The PR should reference `SENSITIVE_UNTRACKING_PLAN.md`, `REMEDIATION_STATUS.md`, and `PHASE6_BRANCH_SPLIT_EXECUTION_PLAN.md`.

```bash
git push --set-upstream origin HEAD
```

Suggested PR title (copy):

```
chore(secrets): untrack sensitive files (remove from index, keep local copies)
```

Suggested PR body template (copy/paste and fill placeholders):

```
This PR removes the listed sensitive files from the Git index while keeping local copies. It is a non-destructive index-only change required to avoid committing secrets/logs/backups into future history.

Files affected (index only):
- .env
- apps/api-edge/.dev.vars
- mock-api.out
- mock-api.err
- server.err
- server.log
- tmp_dashboard_index.html
- tmp_network.html
- backups/sensitive_backup_20260312_073532/

See: SENSITIVE_UNTRACKING_PLAN.md, REMEDIATION_STATUS.md, PHASE6_BRANCH_SPLIT_EXECUTION_PLAN.md

Before merging, reviewers must confirm the PR review checklist below is satisfied.
```

## 6. PR Review Checklist

Before merging, confirm all items below. Reviewers should check each box in the PR description or CI.

- [ ] Secrets for any exposed credentials were rotated and rotation confirmed (see `REMEDIATION_STATUS.md`).
- [ ] A secret-scan was run on the PR branch and passes (examples below).
- [ ] CI (all builds and tests) passes for the branch.
- [ ] Vercel/hosting build preview runs successfully (or a local production build was validated).
- [ ] The untracking commands were scoped and match the files listed in the PR (no unrelated files removed from index).
- [ ] Confirm local files still exist on developer machines (not deleted from working tree).
- [ ] Legal/ops have approved history-retention decisions (if history purge is considered later).

Recommended secret-scan commands (examples):

```bash
# Gitleaks (example)
npx gitleaks detect --source=.

# Or: GitGuardian/GitLeaks enterprise scanner configured in CI; ensure it ran.
```

Vercel / build verification (examples):

```bash
# From repo root, run the standard production build steps used in the repo's CI
npm ci
npm run build

# Also build the dashboard
cd dashboard && npm ci && npm run build
```

## 7. Post-Merge Verification

After the PR merges, run these checks locally or on a clean clone to ensure files are no longer tracked but still present locally.

```bash
# In an existing local clone where the branch was merged into main:

# 1) Confirm files are no longer tracked
git ls-files -- .env || true
git ls-files -- apps/api-edge/.dev.vars || true
git ls-files -- mock-api.out || true
git ls-files -- mock-api.err || true
git ls-files -- server.err || true
git ls-files -- server.log || true
git ls-files -- tmp_dashboard_index.html || true
git ls-files -- tmp_network.html || true
git ls-files -- backups/sensitive_backup_20260312_073532 || true

# If any of the above commands return output, that indicates the file is still tracked.

# 2) Confirm local copies still exist (cross-platform):
# Bash / WSL / Git Bash
[ -f .env ] && echo ".env present locally" || echo ".env NOT present locally"

# PowerShell (Windows)
PowerShell -Command "if (Test-Path -Path .env) { Write-Host '.env present locally' } else { Write-Host '.env NOT present locally' }"

# 3) Confirm Git history was not rewritten in main (merge commit exists and is ordinary):
git log --merges --oneline | head -n 10

# 4) Run a final secret-scan on the `main` branch after merge
npx gitleaks detect --source=.
```

Troubleshooting:
- If a file still appears tracked, re-run `git ls-files` to identify the exact path and confirm the `git rm --cached` command used the correct path. If necessary, create a targeted follow-up PR to correct the index entry.

---

**Reference artifacts:** `SENSITIVE_UNTRACKING_PLAN.md`, `REMEDIATION_STATUS.md`, `PHASE6_BRANCH_SPLIT_EXECUTION_PLAN.md`.

---

Document author: Untracking operations checklist (documentation only). Do NOT execute these commands in this step.
