Do not execute git commands yet.

First generate the branch-only split execution plan so you know exactly:

what moves first

what stays public

what becomes private

what interfaces need to be preserved

what can break Vercel/build/runtime

After that

You’ll have the full repo roadmap finished.

Then we switch hard into:

onboarding compression

SDK/default adoption

live exchange polish

GTM execution

Next prompt

Use this exactly:

You are performing Phase 6: branch-only public/private split execution planning for a live public-beta repository.

Critical constraints:
- Do NOT commit.
- Do NOT push.
- Do NOT move files.
- Do NOT rename files or folders.
- Do NOT change imports.
- Do NOT modify runtime code, routes, env handling, package config, build config, deployment config, SDK/API surface, or app behavior.
- Do NOT execute the split.
- Do NOT create or delete repos.
- This step is planning only.

Context:
- Audit, cleanup, verification, split planning, sensitive remediation planning, remediation status, and sensitive-file untracking planning are complete.
- The next step is to prepare a branch-only execution map for the public/private split.
- The goal is to protect core IP while preserving beta stability and public developer adoption.

Your task:

1. Read:
   - PHASE4A_SPLIT_PLAN.md
   - REMEDIATION_STATUS.md
   - SENSITIVE_UNTRACKING_PLAN.md
   - package.json
   - .gitignore
   - any workspace/package config files needed to understand structure

2. Create a markdown file at repo root named:
   PHASE6_BRANCH_SPLIT_EXECUTION_PLAN.md

That file must include:

# Phase 6 Branch Split Execution Plan

## 1. Objective
State the purpose of the split in engineering and founder terms.

## 2. Preconditions
List everything that must be true before execution begins, including:
- sensitive files untracked
- secrets rotated
- backups archived
- Vercel/CI sourcing secrets from host vaults
- founder approval

## 3. Minimum Viable Split Boundary
Define the smallest safe split that protects core IP without destabilizing the beta.

## 4. Public vs Private Mapping
Create a table with columns:
- Path / area
- Destination (PUBLIC REPO / PRIVATE REPO / SHARED CONTRACT / LEAVE TEMPORARILY)
- Why
- Risk if moved
- Execution notes

## 5. Import / Build / Runtime Risk Map
List the likely breakpoints if files are moved later in a branch:
- import path risks
- workspace/package assumptions
- dashboard/backend cross-references
- build/deploy assumptions
- Vercel risks

## 6. Branch-Only Execution Sequence
Provide a numbered dry-run sequence for how the split would later be executed in a branch, such as:
1. create split branch
2. copy private-core candidates into new private repo mirror
3. introduce interface boundary files
4. update internal references in controlled steps
5. run verification checks
6. compare build/runtime behavior
7. only then decide on merge

Do NOT execute these steps.

## 7. Files/Folders That Must Not Move Yet
Be explicit.

## 8. Verification Checklist For Future Split Branch
List the exact checks that should be run once branch execution begins.

## 9. Recommended Next Step
Choose exactly one:
- founder review before branch execution
- prepare split-map artifacts
- hold pending untracking PR
- hold pending history-cleanup proposal

Rules:
- Planning only
- No file moves
- No code edits
- No repo creation
- Be conservative
- Prefer minimal viable separation over idealized redesign

At the end of the chat output print:
- the single recommended next step
- the 3 highest-risk split breakpoints
- whether the repo is ready for branch-only split execution after the untracking PR
- “NO SPLIT EXECUTED”