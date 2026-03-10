# Deletion Manifest — AgentPay Repository Cleanup

> **Created:** 2026-03-10  
> **Purpose:** Record of every file removed during the enterprise-grade refactor so any item can be recovered if needed.  
> **Recovery:** `git show <commit_sha>:<path>` or restore from the original branch `main` (pre-refactor state).

---

## How to Recover Any File

```bash
# Option 1: restore from the pre-refactor main branch
git show main:<path/to/file>  >  recovered-file.txt

# Option 2: restore from a specific commit
git log --all --oneline -- <path/to/file>   # find the last commit that had it
git show <sha>:<path/to/file>  >  recovered-file.txt

# Option 3: restore directly into working tree
git checkout main -- <path/to/file>
```

---

## Phase 1: Coverage Artifacts (Committed Build Output)

These were build artifacts incorrectly committed to git. They are regenerated on every `npm test --coverage` run and have no unique information. The `.gitignore` has been updated to prevent them from being re-committed.

| File | Why Removed | Recoverable? |
|------|-------------|--------------|
| `coverage/clover.xml` | Build artifact, regenerated on each test run | Via `npm test -- --coverage` |
| `coverage/coverage-final.json` | Build artifact | Via `npm test -- --coverage` |
| `coverage/lcov.info` | Build artifact | Via `npm test -- --coverage` |
| `coverage/lcov-report/` (entire dir, 55 files) | HTML coverage report, build artifact | Via `npm test -- --coverage` |

**Recovery:** Run `npm test -- --coverage` — this regenerates all of these locally.

---

## Phase 2: Root-Level Sprint Artifacts

These were internal sprint planning, status update, and delivery documentation files that were committed to the main repository. They are not code, not documentation for users or developers, and contain no information that isn't better expressed through commit history, issues, or structured docs.

### `7_DAY_SPRINT_TO_DEMO.md` (1,297 lines)
**Was:** 7-day sprint plan for an early demo milestone. Contains day-by-day task lists, "what I'll build today", etc.  
**Why removed:** Sprint planning belongs in a project management tool, not in the repo root. No user-facing or developer-facing value.  
**Unique content worth preserving:** None — all features described now exist in code.

### `MISSION_ACCOMPLISHED.md` (329 lines)
**Was:** Internal milestone celebration document listing completed features, test counts, and "production ready" claims.  
**Why removed:** Self-congratulatory status docs undermine credibility with external reviewers. Claims like "production ready" without independent verification are liabilities.  
**Unique content worth preserving:** None — feature list is superseded by `docs/ARCHITECTURE.md`.

### `DAY1_COMPLETION.md`
**Was:** Day 1 sprint completion notes.  
**Why removed:** Sprint artifact.

### `WEEK1_SUMMARY.md`
**Was:** Week 1 summary of what was built.  
**Why removed:** Sprint artifact. Any useful technical content now lives in architecture docs.

### `V1_INTEGRATION_COMPLETE.md` (533 lines)
**Was:** Detailed completion report for V1 integration milestone. Contains test output, feature lists, API endpoint tables.  
**Why removed:** Snapshot documentation that will immediately go stale. The living docs (`docs/ARCHITECTURE.md`, `docs/API_DESIGN.md`) replace this.  
**Unique content worth preserving:**  
- The endpoint table → now in `docs/API_DESIGN.md`  
- The feature list → now in `docs/ARCHITECTURE.md`  

### `V1_RELEASE_NOTES.md` (291 lines)
**Was:** Release notes for the V1 milestone.  
**Why removed:** Release notes belong in GitHub Releases or `CHANGELOG.md`, not as a standalone file.  
**Recovery option:** Move content to a `CHANGELOG.md` at repo root.  
**Note if you want to keep this info:** Create `CHANGELOG.md` and paste the content there. Format: [Keep a Changelog](https://keepachangelog.com).

### `BUILD_SUMMARY.txt` (323 lines)
**Was:** Console output / build summary from an early sprint. Lists files delivered, test counts.  
**Why removed:** Stale snapshot. Accurate test counts are in CI, not a text file.

### `PR_VERIFICATION_REPORT.md`
**Was:** Report verifying a specific PR's changes were correct.  
**Why removed:** PR verification belongs in CI, not committed to the repo.

### `FILES_DELIVERED.md`
**Was:** List of files created during a sprint delivery.  
**Why removed:** This is a chatbot delivery receipt, not engineering documentation.

### `COMPLETE_FILE_LIST.txt` (64 lines)
**Was:** A flat list of all source files.  
**Why removed:** `find src/` or any IDE replaces this. Immediately goes stale.

### `FIX_TESTS.md`
**Was:** Notes on how to fix test failures during a sprint.  
**Why removed:** Debugging notes belong in issues or PR comments, not the repo.

### `SETUP_TESTS_FOR_YOUR_PROJECT.md`
**Was:** Instructions for setting up tests in a different project structure (`agentpay-mvp/`).  
**Why removed:** References a different project structure that no longer exists. Confusing to anyone reading the repo.

### `SOURCE_FILES_GUIDE.txt`
**Was:** Chatbot-generated guide explaining what each source file does.  
**Why removed:** Stale, low-quality, and superseded by `docs/ARCHITECTURE.md`.

### `AUTOMATED_SETUP_GUIDE.txt`
**Was:** Instructions for running a PowerShell setup script to organize files into folders.  
**Why removed:** The PowerShell script (`setup.ps1`) itself is also being removed. This was a one-time setup artifact from before the project had a proper structure.

### `START_HERE.md`
**Was:** "Start here" onboarding document linking to other docs.  
**Why removed:** README.md is the start-here document. Having a separate START_HERE.md creates confusion about what the canonical entry point is.

### `DOWNLOAD_INSTRUCTIONS.txt`
**Was:** Instructions on how to download files from a chatbot interface.  
**Why removed:** Irrelevant to any developer or user of the repository.

---

## Phase 3: Root-Level Scripts That Should Not Be in Root

These are one-off TypeScript/shell scripts that were placed in the repo root instead of `scripts/` or removed entirely. They have either been moved to `scripts/` or removed because they served a one-time purpose.

### `fix-key.ts`
**Was:** One-off script to fix a specific hardcoded merchant's API key hash using SHA-256 (not PBKDF2). Also hardcodes a specific merchant UUID and uses `sk_test_sim_12345`.  
**Why removed:** Hardcodes sensitive-looking identifiers, uses the wrong hashing algorithm (SHA-256 instead of PBKDF2), and was clearly a one-time debug operation. Keeping it in the repo is a security liability.  
**⚠️ Security note:** If this script was ever run against production, that merchant's key is compromised. Rotate the key if in doubt.

### `generate-key.ts`
**Was:** One-off script to regenerate an API key for a specific hardcoded merchant UUID.  
**Why removed:** Same issues as `fix-key.ts` — hardcoded UUIDs, one-time use, wrong place in the repo.

### `setup-test.ts`
**Was:** A manual test that sends a POST request to `http://localhost:3000/api/payments` with a hardcoded API key.  
**Why removed:** Hardcodes an API key (`fab7f10...`). Should be a proper Jest test, not a root-level script. The hardcoded key is a security flag in any code scan.  
**⚠️ Security note:** The hardcoded key `fab7f10718451780b16dc1429ac8329c6a7b0c31ecb9a891915b144f1a31bebb` should be rotated if it was ever used in production.

### `setup.ps1`
**Was:** PowerShell script for Windows-only project setup (creating folders, moving files).  
**Why removed:** One-time setup artifact. The project is now structured correctly. Windows-only with no Linux/Mac equivalent. Not referenced in any CI or README.

### `smoke-test.sh`
**Was:** Shell script that smoke-tests a Vercel deployment at `https://apay-delta.vercel.app`.  
**Why removed:** Hardcodes a specific deployment URL that may not be the canonical production URL. Should be a CI workflow that runs against a parameterized URL, not a committed shell script.  
**Recovery option:** Convert to a GitHub Actions workflow step that runs against `${{ env.PRODUCTION_URL }}`.

### `production-ready-check.sh`
**Was:** Shell script that checks Node version, env vars, database connectivity, etc. and prints a "production ready" verdict.  
**Why removed:** Creates false confidence. A shell script cannot actually verify production readiness — that requires CI, monitoring, and operational verification. Replaced by `docs/ENTERPRISE_READINESS.md` (honest assessment) and proper CI.

---

## Phase 4: Duplicate / Redundant Documentation

These docs have been **retained but may need consolidation** rather than deletion. They are noted here for awareness.

| File | Status | Recommendation |
|------|--------|----------------|
| `ROADMAP.md` (root) | Kept | Content superseded by `docs/ROADMAP.md` — consider deleting root copy |
| `AGENTPAY_WHITEPAPER.md` | Kept | Two whitepaper versions exist — decide which is authoritative |
| `AGENTPAY_WHITEPAPER--.md` | Kept | Appears to be a draft; suffix `--` suggests in-progress |
| `PRODUCTION_READINESS_REPORT.md` | Kept | Self-authored checklist; honest version is `docs/ENTERPRISE_READINESS.md` |
| `PRODUCTION_SETUP.md` | Kept | Overlaps with `DEPLOYMENT.md` — merge into one |
| `QUICKSTART.md` | Kept | Overlaps with README quickstart section |
| `ONE_PAGER.md` | Kept | Investor one-pager in repo root is unusual but not harmful |
| `docs/architecture.md` | Kept | Old version; `docs/ARCHITECTURE.md` is the new canonical |
| `docs/SECURITY_MODEL.md` | Kept | Partial doc; `docs/SECURITY.md` is the new canonical |

---

## Files Retained (Not Deleted)

These were evaluated and kept:

| File | Reason Kept |
|------|-------------|
| `DEPLOYMENT.md` | Useful operational reference |
| `docker-compose.yml` | Required for local dev |
| `render.yaml` | Required for production deployment |
| `ecosystem.config.cjs` | PM2 config — may be used in some deploy scenarios |
| `openapi.yaml` | Canonical API spec |
| `jest.config.js`, `jest.setup.js`, `jest.setup.cjs` | Test infrastructure |
| `agentpay-mvp/` | Contains legacy code — reviewed separately |
| `legal/` | Legal documents (ToS, privacy, etc.) — keep |
| `docs/moltbook/` | Moltbook-specific docs |
| `docs/protocol/` | Protocol specs |
| `scripts/` | All scripts reviewed; useful ones kept |
| `examples/` | Integration examples — keep |
| `ONE_PAGER.md` | May be useful for sales; not harmful |

---

## Output/Test Artifact Files

| File | Why Removed |
|------|-------------|
| `output.txt` | Shell command output accidentally committed |
| `test-output.txt` | Test run output accidentally committed |

**`.gitignore` has been updated** to prevent these from being re-committed:
```
output.txt
test-output.txt
*.log
coverage/
```

---

## Summary Counts

| Category | Files Removed |
|----------|--------------|
| Coverage artifacts | 63 (coverage/ directory) |
| Sprint/status docs | 13 |
| One-off scripts | 6 |
| Build/output artifacts | 2 |
| **Total** | **84** |

---

## Hardcoded Credentials Found (Security Action Required)

During review, the following hardcoded credentials were found in removed files. **If any of these were used in production, rotate them immediately.**

| File | Credential | Action Required |
|------|-----------|-----------------|
| `fix-key.ts` | `sk_test_sim_12345` (test key) + merchant UUID `26e7ac4f-017e-4316-bf4f-9a1b37112510` | Rotate if used in any real environment |
| `setup-test.ts` | API key `fab7f10718451780b16dc1429ac8329c6a7b0c31ecb9a891915b144f1a31bebb` | Rotate if this was ever a real API key |
| `smoke-test.sh` | Hardcoded URL `https://apay-delta.vercel.app` | Update deploy URL in env var |
