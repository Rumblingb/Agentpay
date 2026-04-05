# AgentPay RCM - Autonomy Loop

## The goal

Make the system feel end-to-end autonomous without turning it into uncontrolled autonomy.

That means:

- multiple specialized agents
- typed workflow state
- bounded retries
- fallback strategies
- human exception handling
- self-improvement from outcomes

## The full loop

Every work item should move through this loop:

1. `intake`
2. `execute`
3. `verify`
4. `recover`
5. `resolve`
6. `learn`

## 1. Intake

Owner:

- `router_agent`

Responsibilities:

- classify lane
- select playbook version
- assign priority
- decide if autonomous execution is allowed

Outputs:

- `lane_selection`
- `playbook_version`
- `priority`
- `auto_execute_allowed`

## 2. Execute

Owner:

- `worker_agent`

Responsibilities:

- run the current playbook
- call the bounded connector set
- capture evidence on every step
- propose a resolution

Outputs:

- `proposed_resolution`
- `evidence_bundle`
- `confidence_score`

## 3. Verify

Owner:

- `qa_agent`

Responsibilities:

- check whether the evidence bundle is actually sufficient
- check whether the playbook was followed
- decide whether the case can close
- decide whether a second strategy is justified

Outputs:

- `approve_auto_close`
- `retry_with_next_worker`
- `escalate`

## 4. Recover

Owner:

- `fallback_worker_agent`

Responsibilities:

- retry only with a different strategy
- switch connectors if the first one failed
- use a narrower fallback playbook
- stop quickly if the second attempt is structurally blocked

Outputs:

- `second_attempt_resolution`
- `connector_failover_used`
- `route_to_human`

## 5. Resolve

Owner:

- `escalation_agent`
- human reviewer when needed

Responsibilities:

- package the case clearly
- route to the right human
- accept or reject closure
- capture the real reason the autonomous loop failed

Allowed human actions:

- approve closure
- reject closure
- add missing context
- take over a failed case
- define a new rule candidate
- classify a new exception type

## 6. Learn

Owner:

- `policy_and_playbook_loop`

This is the self-learning part, but it must be controlled.

Learn from:

- receipts
- approvals
- rejections
- exception classes
- connector failures
- turnaround times
- closure rates

Produce:

- threshold update proposals
- prompt and playbook patch proposals
- new exception classes
- connector reliability backlogs

## Retry model

The system should not keep trying forever.

Rules:

- maximum `2` autonomous attempts per lane
- the second attempt must use a different strategy
- no retry without new evidence or a changed path
- repeated connector failure routes to human review

This prevents token burn and fake progress.

## How multiple agents actually work

The right pattern is not agent swarm chaos.

The right pattern is:

1. router chooses lane
2. worker executes
3. QA checks
4. fallback worker retries if justified
5. escalation agent packages the failure
6. human resolves only the explicit exception

That is a controlled loop, not an improvisational one.

## What "self-learning" should mean

Self-learning should not mean:

- live self-editing prompts in production
- silent playbook rewrites
- memory-based behavior changes with no review

Self-learning should mean:

- receipts and outcomes become training data
- exception classes become new routing rules
- threshold tuning happens under review
- playbook changes are proposed, not silently activated

## What the repo should do

Use the existing primitives like this:

- `RcmWorkItem` = case state machine root
- `RcmWorkItemEvidence` = step-by-step proof
- `RcmException` = structured failure record
- `RcmMilestone` = accepted completion event
- `PaymentIntent` = release object
- `TrustEvent` and scorecards = agent reliability and connector reliability

## The implementation path

### Phase 1

- one lane
- router agent
- worker agent
- QA agent
- escalation inbox
- fixed thresholds

### Phase 2

- fallback worker
- connector failover
- retry scheduling
- exception-class learning

### Phase 3

- threshold tuning loop
- playbook patch proposals
- connector reliability scoring
- route expansion

## Bottom line

Yes, you can build the full loop.

But the winning version is:

- multi-agent
- typed
- bounded
- auditable
- exception-driven
- self-improving under controls

That gets you to the long-term vision without turning the product into an unsafe general agent.
