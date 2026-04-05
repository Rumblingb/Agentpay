# AgentPay RCM - Repo-Specific Build Plan

## Product sentence

AgentPay becomes the orchestration, proof, and settlement spine for autonomous billing operations, with specialized agents handling narrow queues by default and humans only resolving exceptions.

## The repo split

The clean architecture is:

1. `AgentPay Core`
   - already exists
   - merchant, agent, intent, approval, receipt, settlement, trust, fee ledger
2. `RCM Domain Layer`
   - thin additive models and routes
   - work items, evidence, milestones, exceptions, vendor metrics
3. `Autonomous Agent Layer`
   - router agent
   - worker agent
   - QA agent
   - escalation agent

The RCM layer should not replace the core. It should ride on top of it.

## Founder check

The strategy is directionally right, but there are five holes that need to stay visible from day one:

1. `DDE` is not one clean universal API
   - treat it as a connector family and operator workflow
   - do not build the company on the assumption that one DDE integration unlocks the whole market
2. Scope can sprawl too fast
   - professional billing, home health, hospice, DME, dental, and eye should not all be first-release queues
3. Home health is documentation-heavy
   - eligibility, certification, plan of care, and supporting records create real exception pressure
4. Credential custody is a product surface
   - "behind the provider" access means vaulting, audit, attribution, and controls
5. Insurance payment is not AgentPay settlement
   - payer money movement, remittance, and platform milestone release are related but separate events

See [agentpay-rcm-connector-strategy.md](/C:/Users/visha/agentpay/docs/agentpay-rcm-connector-strategy.md) for the connector-first operating stance.

## What stays untouched

These remain the core primitives:

- `Merchant`
  - hospital client, facility billing org, or outsourced RCM firm
- `Agent`
  - specialized billing worker, QA, routing, or escalation role
- `PaymentIntent`
  - completion authorization, approved milestone, or payout-release object
- `SettlementIdentity`
  - proof that an outcome really happened
- `IntentResolution`
  - final closure state for the workflow
- `FeeLedgerEntry`
  - base platform fee, usage fee, and narrow outcome fee accounting
- `TrustEvent` and `agentrank_scores`
  - private operator and agent scorecards over time

## New additive Prisma models

These are the thin vertical models:

- `RcmWorkspace`
  - client workspace for a facility, home health org, or billing team
- `RcmWorkItem`
  - the queue object
- `RcmWorkItemEvidence`
  - auditable proof bundle for what happened
- `RcmMilestone`
  - payout or completion release event
- `RcmException`
  - low-confidence, blocked, or ambiguous case record
- `RcmVendorMetric`
  - scorecard rollups for agents or outsourced operators

## `/api/rcm` route surface

Live routes now in repo:

- `GET /api/rcm`
- `GET /api/rcm/blueprint`
- `GET /api/rcm/autonomy-loop`
- `GET /api/rcm/lanes/claim-status`
- `GET /api/rcm/lanes/claim-status/work-items`
- `GET /api/rcm/queues/claim-status-exceptions`
- `GET /api/rcm/connectors/claim-status`
- `GET /api/rcm/workspaces`
- `GET /api/rcm/work-items`
- `GET /api/rcm/services`
- `GET /api/rcm/vendors`
- `GET /api/rcm/payouts`
- `GET /api/rcm/metrics/overview`
- `GET /api/rcm/metrics/queues`
- `GET /api/rcm/metrics/payouts`

Live claim-status lane mutations:

- `POST /api/rcm/lanes/claim-status/intake`
- `POST /api/rcm/lanes/claim-status/work-items/:workItemId/run-primary`
- `POST /api/rcm/lanes/claim-status/work-items/:workItemId/run-fallback`
- `POST /api/rcm/lanes/claim-status/work-items/:workItemId/execute`
- `POST /api/rcm/lanes/claim-status/work-items/:workItemId/verify`
- `POST /api/rcm/lanes/claim-status/work-items/:workItemId/retry`
- `POST /api/rcm/lanes/claim-status/work-items/:workItemId/escalate`
- `POST /api/rcm/lanes/claim-status/work-items/:workItemId/resolve`

Still-planned generic mutation routes:

- `POST /api/rcm/workspaces`
- `PATCH /api/rcm/workspaces/:workspaceId`
- `POST /api/rcm/work-items`
- `PATCH /api/rcm/work-items/:workItemId`
- `POST /api/rcm/work-items/:workItemId/assign`
- `POST /api/rcm/work-items/:workItemId/evidence`
- `POST /api/rcm/work-items/:workItemId/submit`
- `POST /api/rcm/work-items/:workItemId/approve`
- `POST /api/rcm/work-items/:workItemId/reject`
- `POST /api/rcm/work-items/:workItemId/milestones`
- `POST /api/rcm/work-items/:workItemId/milestones/:milestoneId/release`

## Dashboard surface

The new private console section is:

- `dashboard/app/(authed)/rcm/page.tsx`

This page now anchors the vertical in the product and explains:

- the two billing families
- the first queue
- the four agent roles
- the exception taxonomy
- the manager screen shape
- how AgentPay core maps into billing operations

## Billing families

The product needs to recognize two major families:

1. Professional / provider billing
   - physician
   - dental
   - eye
   - ortho
   - first form family: `CMS-1500`

2. Facility / home health billing
   - hospital
   - home health
   - DME
   - PAS / unskilled support contexts
   - hospice
   - first form family: `UB-04`

The first launch should not try to cover both families equally. It should use them to frame the platform while still starting with one narrow queue.

## Service-bundle benchmark

The real benchmark is what outsourced firms like ZMed sell today:

- claim data entry, validation, and transmission
- claims review and follow-up
- recovery and collections
- patient eligibility verification
- payment posting and remittance advisory
- reporting and accounting
- hospice `NOE/NOTR`
- PAS and DME authorization work
- physician-side payer and reimbursement checks

We should aim to automate the full bundle over time, but only through a lane-by-lane automation ladder.

## First queue

The first queue should be:

### Institutional claim status follow-up + DDE correction

Why this lane:

- structured
- repetitive
- high volume
- measurable completion
- narrow enough to automate seriously

What it proves:

- intake
- playbook selection
- autonomous execution
- confidence scoring
- evidence capture
- human escalation
- milestone release
- scorecarding

## Connector-first automation stance

The first rails should be:

1. `270/271` for eligibility
2. `276/277` for claim status
3. DDE and portal correction as fallback execution paths
4. `835` and EFT inputs for payment posting and reconciliation

The repo now includes a live claim-status connector runtime with:

- `x12_276_277` as the primary autonomous rail
- remote connector mode when credentials are present
- deterministic simulation mode when credentials are absent
- bounded fallback connectors that stay human-led until vaulting and operator controls exist

That sequence is stronger than trying to start with "the DDE API."

## Runtime stance

An OpenClaw-style runtime is useful as inspiration, but it should not become the literal execution model for this vertical.

Borrow:

- durable task flow
- event hooks
- auditable background jobs
- explicit sub-agent coordination

Avoid:

- one unconstrained general agent
- plugin-first access to production payer and provider systems
- broad end-to-end autonomy without typed workflow state

The repo should prefer:

- typed work items
- bounded connector services
- specialized agents per lane
- explicit approval and exception boundaries

See [agentpay-rcm-autonomy-loop.md](/C:/Users/visha/agentpay/docs/agentpay-rcm-autonomy-loop.md) for the concrete multi-agent retry and learning model.
See [agentpay-rcm-claim-status-contract.md](/C:/Users/visha/agentpay/docs/agentpay-rcm-claim-status-contract.md) for the exact first-lane implementation contract.

## Work item shape

The first work item contract should include:

- `patientRef`
- `providerRef`
- `claimRef`
- `payerName`
- `coverageType`
- `formType`
- `sourceSystem`
- `amountAtRisk`
- `dueAt`
- `metadata`

Do not store broad free-text clinical data in the first version.
Use opaque identifiers plus secure attachment references instead.

## Agent roles

The repo should model four specialized agents, not one giant agent:

1. `router_agent`
   - chooses workflow
   - chooses playbook
   - decides whether auto-execution is allowed
2. `worker_agent`
   - performs the standard task flow
3. `qa_agent`
   - checks whether the case is actually complete
4. `escalation_agent`
   - packages low-confidence cases for human review

## Human exception reasons

Humans should only enter the flow when the system hits one of these classes:

- missing documentation
- provider enrollment or credential mismatch
- coverage mismatch
- portal or DDE access failure
- ambiguous payer response
- underpayment or partial payment requiring judgment

## Manager surfaces

The core manager surfaces should be:

1. Overview
   - queue volume
   - auto-resolved percentage
   - escalated percentage
   - amount at risk
2. Work queue
   - every case with payer, claim, priority, confidence, and current state
3. Work item detail
   - evidence, exception, milestone, and proof timeline
4. Vendor scorecards
   - closure rate, escalation rate, turnaround, supervisor acceptance
5. Payouts
   - milestone release, fee record, and completion accounting

## Build order

### Phase 1

- claim status follow-up
- DDE correction workflow
- evidence logging
- human exception inbox
- milestone release surface

### Phase 2

- posting exceptions
- denial subtype handling
- prior auth follow-up
- scorecard rollups
- client SLA reporting

### Phase 3

- autonomous routing improvements
- exception prediction
- outcome-linked pricing
- white-label client reporting surfaces

## Commercial shape

Best first buyers:

- outsourced RCM firms
- facility-side billing teams
- home health and related admin groups with repeatable queue volume

Do not lead buyer conversations with:

- public marketplace language
- crypto-first framing
- generic agent-economy rhetoric

Lead with:

- lower backlog
- more throughput
- stronger proof
- tighter supervisor control
- cleaner client reporting

## Honest ceiling

The repo now has the right scaffold for the vertical, but it is not a production billing engine yet.

The remaining work is:

- real persistence on the `/api/rcm` mutation routes
- migration generation and DB rollout
- secure document / attachment handling
- portal and DDE connector strategy
- queue-specific playbooks
- confidence scoring and QA logic
