# RIPER Workflow

Enforce strict phase separation for this task. Move through each phase completely before advancing.

## Phases

### R — RESEARCH
Gather all information needed before proposing anything.
- Read all relevant files
- Check git history for context
- Identify the exact scope of the problem
- List all unknowns and dependencies
- **Do not propose solutions yet**

### I — INNOVATE
Generate options and evaluate trade-offs.
- List 2-3 possible approaches
- For each: pros, cons, risk level
- Consider edge cases and failure modes
- Consider cost (API calls, tokens, compute)
- **Do not write code yet**

### P — PLAN
Write a precise, step-by-step implementation plan.
- List every file that will change
- List every file that will be created
- Identify the exact order of operations
- Call out any secrets / config needed
- Get user confirmation before proceeding

### E — EXECUTE
Implement exactly what was planned. No scope creep.
- Work one file at a time
- Mark each step complete as done
- If a blocker is hit, stop and return to PLAN
- **Do not add features not in the plan**

### R — REVIEW
Verify the implementation is correct and complete.
- Run TypeScript check: `npx tsc --noEmit`
- Run relevant tests if they exist
- Verify API endpoints respond correctly
- Check for security issues (injection, auth bypass, secret exposure)
- Confirm all planned files are changed

---

## Task

$ARGUMENTS

Start in **RESEARCH** phase. Report your findings before moving to INNOVATE.
