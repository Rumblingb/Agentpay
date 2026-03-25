# RIPER: Execute Phase

**Mode: FULL ACCESS. Implement exactly what was planned. No scope creep.**

$ARGUMENTS

If a step number is provided (e.g. `/riper:execute 2`), implement only that step.
If no argument, implement the full plan from the last `/riper:plan`.

## Rules

- Follow the plan exactly — do not add features not in the plan
- Work one file at a time
- Run `npx tsc --noEmit` after each file change
- If a blocker is hit, STOP and report — do not work around it silently
- Mark each step complete as you finish it

## After Each File

Check: does `npx tsc --noEmit` pass in the relevant workspace?
- `cd apps/api-edge && npx tsc --noEmit`
- `cd apps/meridian && npx tsc --noEmit`
- `cd dashboard && npx tsc --noEmit`

## When Done

Run `/riper:review` to validate the implementation.
