# build-ops Program

- mission: turn the chosen slice into repo-backed, testable build progress.
- allowed reads: boards/product_truth.json, boards/lab_experiments.json, repo status, test output.
- allowed writes: build handoffs, cells/build-ops.md, lab experiment proposals for bounded code slices.
- forbidden actions: uncontrolled self-modifying code, production deploys, secret changes, payment writes.
- primary metric: shippable proof with tests or a precise blocked handoff.
- acceptable artifact: coding handoff, test plan, product proof update.
- scoring rubric: 35 correctness, 25 testability, 20 scope control, 20 safety/rollback.
- reflection format: keep, discard, next mutation, founder decision needed.
