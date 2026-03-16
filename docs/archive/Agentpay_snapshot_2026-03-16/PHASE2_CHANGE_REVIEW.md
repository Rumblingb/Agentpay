# Phase 2 Change Review

## Changes Detected
- `.gitignore` — modified (appended Phase‑2 ignore rules)
- `scripts/phase2_cleanup.ps1` — added (new PowerShell cleanup script)

## Exact Diff Summary

- `.gitignore`:
  - Appended a Phase‑2 block of ignore entries at the end of the file. The new lines added are, in order:
    - `tmp_*.html`
    - `*.err`
    - `*.out`
    - `server.log`
    - `mock-api.*`
    - `backups/sensitive_backup_*`
  - Existing ignore content above the new block was not changed.

- `scripts/phase2_cleanup.ps1`:
  - New PowerShell script added to `scripts/` that performs a conservative archive-and-untrack of matched temporary/runtime files.
  - Behavior summary:
    - Creates `backups/phase2_archive_<timestamp>` and moves matched files there.
    - Looks for file patterns: `tmp_*.html`, `*.err`, `*.out`, `server.log`, `mock-api.*` across the repo (recursively).
    - If `git` is available and a matched file is tracked, the script runs `git rm --cached -- <path>` to untrack it (no commit performed by the script).
    - Preserves subdirectory layout inside the archive directory.
    - Prints a short summary and suggests manual follow-up commands (e.g., run `git status`, then optionally commit the removal).

## Safety Assessment

- `.gitignore`: KEEP WITH EDITS
  - Rationale: adding ignores for temporary captures and runtime logs is appropriate and aligns with Phase‑2 goals. However, several patterns are broad (`*.err`, `*.out`) and may hide unrelated files used by developers or CI; they should be narrowed or scoped to known directories.

- `scripts/phase2_cleanup.ps1`: KEEP WITH EDITS
  - Rationale: the script is useful as a conservative, reversible local tool. BUT it includes an automated `git rm --cached` step that will change tracked files in the working tree (untrack them) if run. That behavior is potentially surprising and could close gaps without explicit human review. The script is safe if kept but should be edited to default to a dry‑run and require an explicit `--apply` flag to perform untracking and moves.

## Risk Analysis

- Broad `.gitignore` patterns:
  - `*.err` and `*.out` match any file with those extensions anywhere in the repo. If a legitimate project artifact or CI log file uses those suffixes intentionally, it will be ignored going forward and may be harder to notice or re-add. Broad patterns can mask unrelated files.

- Ignoring tracked files:
  - Adding patterns to `.gitignore` does not automatically remove already tracked files. The script attempts to untrack matched tracked files with `git rm --cached`; this is a staged change the script makes to the working tree (it does not commit). Untracking without a deliberate manual review could lead to accidental loss of visibility for files that should remain in the repo.

- Accidentally hiding useful artifacts:
  - Some `*.out`/`*.err` files may be intentionally kept for debugging, CI artifacts, or examples; ignoring them silently could remove useful signals for maintainers.

- Adding a cleanup script that can change the working tree:
  - The current script will move files and untrack tracked files when executed. If run accidentally (or by an automated runner), it will modify the working tree and require manual reconciliation. The script has no explicit `--dry-run` or `--confirm` flag, and it detects `git` availability at runtime; that increases accidental-impact risk.

- Mismatch with the original “low‑risk cleanup only” goal:
  - The intent of Phase 2 was conservative, read‑only identification and safe archival (manual). The `.gitignore` change is consistent with a low‑risk intent, but the addition of an executable script that performs untrack-and-move steps crosses into making automated workspace changes. That makes the change less conservative than intended unless the script is modified to be read‑only by default (dry run) and clearly documented.

## Recommendation

Keep the `.gitignore` change but remove the executable cleanup script from the repository for now (or keep it outside the public repo). The single safest next action is: **keep `.gitignore` but remove the script**.

Rationale: the `.gitignore` additions align with the low‑risk goal and prevent future accidental commits of tmp/log files. The cleanup script is valuable operationally but should be retained only in a private/ops repo or updated to be read‑only by default and explicitly gated (e.g., an opt‑in `--apply` flag), then re‑introduced after founder/operator review.

## Manual Founder Review Checklist

1. Confirm that no live secrets remain in tracked files (especially `.env`). If any secret was found, rotate immediately — do not rely on git history rewrites alone.
2. Inspect `backups/` contents (especially any `sensitive_backup_*`) and move truly sensitive backups to secure vault/storage; document who has access.
3. Confirm the list of files matched by the Phase‑2 patterns in a dry run locally: run the script after it is edited to a dry‑run mode, capturing `Get-ChildItem` matches only.
4. Review and narrow `.gitignore` patterns as needed (scope to directories where tmp/log files are expected). Example: prefer `dashboard/tmp_*.html` or `*/tmp_*.html` over a repo‑wide `tmp_*.html` if appropriate.
5. Decide whether to archive `dashboard/screenshots/` to `docs/assets/` or external storage; coordinate with product/design owners on canonical location.
6. If you want to untrack files that are currently tracked, create a small review PR on a non‑protected branch that shows `git rm --cached` changes and have maintainers approve before committing.

---

This review is conservative: no operations were executed. If you approve, I can proceed to either:

- Edit the script to be dry‑run by default and add `--apply` flag, then re-run the review; or
- Remove `scripts/phase2_cleanup.ps1` from the public repo and keep a copy in a private ops repo; or
- Narrow `.gitignore` patterns before any further action.
