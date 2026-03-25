# RIPER: Plan Phase

**Mode: READ + WRITE to memory bank only. No production code changes.**

Create a precise implementation plan before any code is written.

## Task to Plan
$ARGUMENTS

## Instructions

1. Review the research findings (run `/riper:research <task>` first if not done)
2. List 2-3 implementation approaches with trade-offs
3. Select the best approach with justification
4. Write a step-by-step plan — every file, every change, in order

## Plan Format

```
## Approach Selected
[which approach and why]

## Files to Change
| File | Change |
|------|--------|
| apps/api-edge/src/routes/X.ts | Add Y endpoint |
| apps/meridian/app/(main)/X.tsx | Update confirm card |

## Files to Create
| File | Purpose |
|------|---------|
| apps/api-edge/src/lib/X.ts | Helper for Y |

## Implementation Steps
1. [ ] Step one — file:function
2. [ ] Step two — file:function
3. [ ] Step three — file:function

## Secrets / Config Required
- `WRANGLER_SECRET_NAME` — what it's for

## Risks
- [risk] → [mitigation]
```

**Stop after the plan. Get confirmation before executing.**

When confirmed: `/riper:execute`
