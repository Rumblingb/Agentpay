# RIPER Workflow

**R**esearch → **I**nnovate → **P**lan → **E**xecute → **R**eview

Use the sub-commands for phase-specific control:

```
/riper:research <task>   — investigate codebase (read-only)
/riper:plan <task>       — create implementation plan
/riper:execute [step]    — implement the plan
/riper:review            — validate against plan
```

## Full Session for: $ARGUMENTS

If arguments provided, run all phases in sequence:

1. Start with `/riper:research $ARGUMENTS`
2. Review findings, then run `/riper:plan $ARGUMENTS`
3. Confirm the plan, then run `/riper:execute`
4. When done, run `/riper:review`

## When to Use RIPER

**Use RIPER for:**
- New API routes or Workers integrations
- Adding a new travel vertical (EU rail, Duffel flights)
- Payment or webhook changes
- Any multi-file feature touching >3 files

**Skip RIPER for:**
- Single-line bug fixes
- Updating a constant or config value
- Adding a comment or type annotation
