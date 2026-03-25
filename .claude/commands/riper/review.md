# RIPER: Review Phase

**Mode: READ + TEST EXECUTION. Validate against the plan.**

$ARGUMENTS

## Checklist

### TypeScript
- [ ] `cd apps/api-edge && npx tsc --noEmit` — zero errors
- [ ] `cd apps/meridian && npx tsc --noEmit` — zero errors
- [ ] `cd dashboard && npx tsc --noEmit` — zero errors (if dashboard changed)

### Against the Plan
- [ ] Every file in "Files to Change" was changed
- [ ] Every file in "Files to Create" exists
- [ ] Every step is marked complete
- [ ] No unplanned files were changed (`git diff --name-only`)

### Security (from `/check`)
- [ ] No SQL injection vectors in new routes
- [ ] Auth checks on all new endpoints
- [ ] No secrets in code or logs
- [ ] Edge-compatible (no Node built-ins)

### Smoke Test
- [ ] `curl https://api.agentpay.so/api/health` returns 200
- [ ] New endpoints return expected responses

## Output Format

```
## Result: PASS / FAIL

## TypeScript: ✓ / ✗
[errors if any]

## Plan Coverage: ✓ / ✗
[missing items if any]

## Security: ✓ / ✗
[findings if any]

## Deviations from Plan
[list any — none is ideal]
```

If FAIL: return to `/riper:execute <step>` for the failing step.
If PASS: ready to commit and deploy.
