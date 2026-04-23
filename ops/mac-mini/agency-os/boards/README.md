# Agency OS Board Templates

These JSON files are source-controlled templates for the deployed Agency OS boards under:

`~/.openclaw/workspace-agency-os/boards`

Use `ops/mac-mini/bin/agency-os-bootstrap-runtime` to create missing live boards without overwriting live state.

Core lab templates:

- `lab_experiments.json`: bounded self-improvement experiments with owner, surface, hypothesis, budget, metrics, rollback rule, and approval class.
- `lab_archive.json`: append-only evaluated run history and lineage.
- `lab_metrics.json`: evaluator scorecard for contracts, approval gates, outbound readiness, revenue traceability, product truth, and safety.
- `lab_skill_library.json`: reusable practices discovered by the lab.
- `lab_reflections.json`: keep/discard/next-mutation notes after each run.
- `lab_safety_reviews.json`: safety and irreversible-action review queue for lab experiments.
