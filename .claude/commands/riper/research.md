# RIPER: Research Phase

**Mode: READ ONLY. No code changes in this phase.**

Investigate the codebase to understand the current state before proposing anything.

## Task to Research
$ARGUMENTS

## Instructions

1. Read all files relevant to the task — routes, types, components, schemas
2. Check recent git commits for context: `git log --oneline -10`
3. Identify the exact scope and all dependencies
4. List what exists, what's missing, and what's ambiguous
5. Note any edge cases, failure modes, or constraints

## Output Format

```
## Current State
[what exists today]

## Relevant Files
[file paths and what they do]

## Gaps / Unknowns
[what's missing or unclear]

## Constraints
[edge-compat, auth requirements, DB patterns, etc.]
```

**Do not propose solutions. Do not write code. Stop after the research output.**

When done, the next phase is: `/riper:plan <task>`
