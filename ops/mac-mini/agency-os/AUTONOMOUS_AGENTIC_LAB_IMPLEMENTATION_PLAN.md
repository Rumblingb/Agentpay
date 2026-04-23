# Autonomous Agentic Lab Implementation Plan

Updated: 2026-04-22

## Thesis

AgentPay Labs should not copy HyperAgents or autoresearch literally.

We should steal the operating principles:

- one editable surface
- one measurable score
- one sandboxed run
- one archive of attempts
- one parent-selection policy
- one explicit budget
- one human approval gate for irreversible actions

Then apply those principles to company-building work:

- product proof
- MCP billing gateway
- platform distribution
- outbound
- partnerships
- revenue
- customer success
- safety/evals

The goal is a self-sustaining agentic lab that learns how to improve AgentPay Labs end-to-end without letting agents rewrite the whole company blindly.

Bill/Hedge remains separate.

## What The Repos Teach Us

### HyperAgents

Useful pattern:

- Combine task agent and meta agent into an editable program.
- Keep an archive of generated agents and evaluation results.
- Select parents from the archive instead of only greedily continuing from the current best.
- Run generated variants in isolated containers.
- Store diffs, metadata, scores, and lineage.
- Allow the improvement process itself to be improved, not just the task solution.

AgentPay translation:

- The "task agent" is a cell worker: outbound, revenue, build, partnerships, customer, media.
- The "meta agent" is an improvement agent that edits cell prompts, board schemas, runbooks, and evaluator policies.
- The archive is not random chat history; it is a versioned set of run packets with scorecards.
- Parent selection should preserve diversity: best revenue packet, best outbound packet, best support packet, best build packet, not just the latest.
- Sandboxing is mandatory for code/tool changes.

Do not copy:

- Unbounded self-modification.
- Direct production writes.
- Broad access to secrets, payment tools, email sends, ads, or customer promises.

### Autoresearch

Useful pattern:

- Keep the repo tiny.
- Declare exactly which file the agent can edit.
- Keep evaluation fixed and trusted.
- Use a hard time budget.
- Compare every run on the same metric.
- Keep good changes, discard bad changes.
- Log every experiment in a table.
- Let the human program the agent through a compact `program.md`-style instruction file.

AgentPay translation:

- Each Agency OS cell needs its own `program.md` equivalent.
- Each experiment should edit one allowed artifact: a cell file, a board row, a proposal draft, a script, or a small product slice.
- Each run needs a fixed budget: time, model spend, external-action permission, and scope.
- Each run needs a scorecard: not vibes.
- Most failed experiments should be discarded or parked, not merged into working memory.

## Newer Research Patterns To Adopt

### Darwin Godel Machine / HyperAgents

Adopt:

- Archive of variants.
- Open-ended but evaluated exploration.
- Parent selection that avoids premature convergence.
- Metadata for lineage, scores, and failure reasons.

### AI Scientist-v2

Adopt:

- Hypothesis -> experiment -> analysis -> report loop.
- Experiment manager agent.
- Tree search over ideas.
- Reviewer loop for outputs and figures/proof artifacts.

### Agent Laboratory

Adopt:

- Human-provided research idea.
- Three stages: literature review, experimentation, report writing.
- Human feedback checkpoints between stages.
- Cost-aware research automation.

### AgentRxiv

Adopt:

- Shared internal preprint/report server.
- Agents retrieve prior reports before repeating work.
- Reports become reusable stepping stones across cells.

### OpenEvolve / AlphaEvolve-style Systems

Adopt:

- Evolve small code/prompt/tool units against deterministic evaluators.
- Use multi-objective scoring, not one magic number.
- Track Pareto front: revenue, safety, cost, latency, quality.

### Reflexion / Voyager

Adopt:

- Verbal reflection after each run.
- Skill library of things that worked.
- Automatic curriculum: next task should be just beyond current capability.

## Core Implementation

### 1. Experiment Contract

Create a canonical experiment packet:

```json
{
  "id": "lab-exp-YYYYMMDD-001",
  "owner": "outbound-ops",
  "surface": "boards/send_queue.json",
  "hypothesis": "A founder-approved MCP billing gateway pitch to MCP builders will produce more replies than generic AgentPay positioning.",
  "editable_paths": [],
  "read_paths": [],
  "budget": {
    "time_minutes": 45,
    "model_budget_usd": 0.50,
    "external_actions": "none"
  },
  "metrics": [],
  "approval_required": true,
  "status": "proposed"
}
```

Required fields:

- owner
- hypothesis
- allowed edit surface
- fixed evaluator
- budget
- rollback rule
- human approval class
- expected artifact

### 2. Lab Boards

Add these boards:

- `boards/lab_experiments.json`
- `boards/lab_archive.json`
- `boards/lab_metrics.json`
- `boards/lab_skill_library.json`
- `boards/lab_reflections.json`
- `boards/lab_safety_reviews.json`

These become the AgentPay equivalent of autoresearch `results.tsv` plus HyperAgents archive metadata.

### 3. Cell Programs

Create one compact instruction file per cell:

- `cells/programs/offer-strategy.program.md`
- `cells/programs/build-ops.program.md`
- `cells/programs/outbound-ops.program.md`
- `cells/programs/media-ops.program.md`
- `cells/programs/revenue-ops.program.md`
- `cells/programs/ads-ops.program.md`
- `cells/programs/partnerships-ops.program.md`
- `cells/programs/customer-ops.program.md`
- `cells/programs/chief-agent.program.md`

Each program should define:

- mission
- allowed reads
- allowed writes
- forbidden actions
- primary metric
- acceptable artifact
- scoring rubric
- reflection format

### 4. Evaluator Harness

Build `ops/mac-mini/scripts/agency-os-evaluate.mjs`.

It should score:

- board freshness
- packet completeness
- founder approval readiness
- blocked action clarity
- product proof availability
- follow-up dates
- safety gate compliance
- external-action violations
- revenue movement category
- customer/support loop closure

The first score should be simple and deterministic.

Example dimensions:

- `completeness`: required fields present
- `specificity`: named buyer/contact/product/payment/action
- `safety`: no unauthorized send/spend/money movement
- `freshness`: updated today or with valid follow-up date
- `proof`: links to repo/demo/log/customer signal
- `revenue`: cash collected/payment requested/trial advanced/blocked reason

### 5. Archive And Parent Selection

Build `agency-os-lab-loop` with this flow:

1. Read lab archive and current boards.
2. Select parent packet:
   - 50% best score
   - 25% most promising stale area
   - 25% diverse/underexplored cell
3. Create one child experiment.
4. Run one bounded agent or deterministic worker.
5. Evaluate output.
6. If score improves and safety passes, keep it.
7. If score fails, archive with failure reason and revert/park.
8. Write reflection.

This is HyperAgents-style parent selection without unsafe self-rewriting.

### 6. Research Report Server

Create:

- `research/reports/YYYY-MM-DD-topic.md`
- `research/index.json`
- `research/lit_cache.json`

Before any cell researches, it must:

1. Search existing reports.
2. Search the web only if needed.
3. Write a compact report with sources, claims, uncertainty, and next experiment.

This is the AgentRxiv idea inside the company.

### 7. Safety Gates

External actions require founder approval:

- email send
- public post
- ad spend
- payment request
- charge/refund/discount
- partner submission
- customer promise
- deployment
- live trading or Bill action

Autonomous actions allowed:

- draft packets
- update boards
- run tests
- inspect docs/repos
- create local experiment reports
- prepare PR branches
- evaluate artifacts

### 8. Hermetic Code Runs

Borrow HyperAgents' container discipline.

For code-modifying experiments:

- run in a git worktree
- require clean diff
- run syntax/type/test subset
- store patch
- store score
- do not commit/push without explicit publishing flow

For product/ops experiments:

- run against local board copies first
- diff against live board
- apply only if safety passes

## What To Build In AgentPay Labs

### Phase 0: This Week

1. Add lab boards.
2. Add cell program files.
3. Add deterministic evaluator script.
4. Add one lab loop script in dry-run mode.
5. Wire Hermes cron to run one daily lab experiment.
6. Build first evaluator around outbound/revenue packet completeness.

Exit criteria:

- one experiment packet created
- one scored run
- one archived result
- one reflection
- no external action taken

### Phase 1: 7-14 Days

1. Add parent selection.
2. Add skill library.
3. Add research report index.
4. Add safety review board.
5. Add reviewer agent for generated packets.
6. Start using the loop for:
   - outbound packet improvement
   - revenue packet improvement
   - MCP billing gateway product spec
   - partner submission pack

Exit criteria:

- repeated runs improve packet score
- stale cells shrink
- founder sees fewer vague asks

### Phase 2: 14-30 Days

1. Add sandboxed code experiments for small product slices.
2. Add PR-generation experiment mode.
3. Add web research reports for OpenAI/Claude/MCP distribution.
4. Add metrics around reply rate, customer movement, and revenue movement.
5. Add weekly lab review.

Exit criteria:

- first paid-pilot packet produced
- first platform submission packet produced
- first product PR generated from lab loop

### Phase 3: 30-90 Days

1. Multi-cell experiments.
2. Cross-cell archive retrieval.
3. Automatic curriculum.
4. Cost-aware model routing.
5. AgentPay MCP Billing Gateway demo evaluated by the lab.
6. Revenue reinvestment rules connected to P&L board.

Exit criteria:

- the lab creates measurable product/revenue progress with founder approvals only at gates
- most work happens through packets, scorecards, and archived experiments

## Initial Experiment Backlog

### EXP-001: Outbound Packet Fitness

Hypothesis:

Specific MCP Billing Gateway outreach packets will beat generic AgentPay positioning.

Editable:

- `boards/send_queue.json`
- `boards/crm.json`
- `cells/outbound-ops.md`

Metric:

- recipient reachable
- problem specific
- product wedge clear
- proof attached
- approval status clear
- follow-up date present

### EXP-002: Revenue Packet Fitness

Hypothesis:

Revenue packets with buyer, amount, payment path, and next date will create faster founder approvals than vague "follow up" notes.

Editable:

- `boards/revenue.json`
- `boards/approvals.json`
- `cells/revenue-ops.md`

Metric:

- buyer named
- amount or pricing range
- payment path
- collection/conversion state
- founder decision required

### EXP-003: Platform Submission Packet

Hypothesis:

Claude/OpenAI distribution work moves faster when treated as a submission packet with checklist, risks, and proof assets.

Editable:

- `boards/platform_submissions.json`
- `boards/partnerships.json`
- `cells/partnerships-ops.md`

Metric:

- platform named
- requirements listed
- missing assets listed
- demo/proof linked
- next submission step dated

### EXP-004: MCP Billing Gateway Spec

Hypothesis:

A single product spec for AgentPay MCP Billing Gateway will reduce wedge drift across ACE, RCM, hosted MCP, and Northstar.

Editable:

- `boards/product_truth.json`
- `cells/offer-strategy.md`
- `cells/build-ops.md`

Metric:

- ICP
- tools
- approval gates
- payment flow
- OAuth
- audit log
- demo path
- pricing

### EXP-005: Safety Gate Evals

Hypothesis:

Most agentic-lab risk can be caught with deterministic checks for forbidden external actions and missing approval fields.

Editable:

- `boards/lab_safety_reviews.json`
- evaluator script

Metric:

- catches send/spend/money/deploy/promise attempts
- catches missing approval status
- catches hallucinated revenue claims

## Design Principles

1. Do not make agents "smarter" by giving them more unchecked freedom.
2. Make agents smarter by giving them tighter surfaces, better evaluators, and stronger archives.
3. Every loop needs a metric.
4. Every metric needs a trusted evaluator.
5. Every evaluator needs safety gates.
6. Every successful output becomes a reusable skill.
7. Every failed output teaches the archive.
8. Founder approvals should be rare, high-leverage, and concrete.

## Recommended Immediate Build

Build `agency-os-lab-loop` in dry-run mode.

Minimum files:

- `boards/lab_experiments.json`
- `boards/lab_archive.json`
- `boards/lab_metrics.json`
- `boards/lab_skill_library.json`
- `boards/lab_reflections.json`
- `boards/lab_safety_reviews.json`
- `cells/programs/*.program.md`
- `ops/mac-mini/scripts/agency-os-evaluate.mjs`
- `ops/mac-mini/scripts/agency-os-lab-loop.mjs`

First run should evaluate outbound and revenue packets only.

Do not let the first version edit code, send email, spend money, or create PRs. The first version proves that the lab can create, score, archive, and improve company-building packets.

## Sources Reviewed

- HyperAgents: https://github.com/facebookresearch/hyperagents
- Hyperagents paper: https://arxiv.org/abs/2603.19461
- autoresearch: https://github.com/karpathy/autoresearch
- Darwin Godel Machine: https://arxiv.org/abs/2505.22954
- AI Scientist-v2: https://arxiv.org/abs/2504.08066
- Agent Laboratory: https://arxiv.org/abs/2501.04227
- AgentRxiv: https://arxiv.org/abs/2503.18102
- OpenEvolve: https://github.com/algorithmicsuperintelligence/openevolve
- Reflexion: https://arxiv.org/abs/2303.11366
- Voyager: https://arxiv.org/abs/2305.16291
