# AgentPay RCM - First Queue Spec

## First queue

### Institutional claim status follow-up + DDE correction

This is the first automation lane because it is the fastest credible path to:

- autonomous execution
- structured evidence
- human exception handling
- manager trust
- outcome-linked release events

For the exact state machine, retry loop, payloads, and inbox shape, see [agentpay-rcm-claim-status-contract.md](agentpay-rcm-claim-status-contract.md).

## Supported billing contexts

Initial contexts this queue should support:

- facility billing
- home health billing
- related institutional workflows that ride the same correction / follow-up pattern

This first lane should not try to solve every denial, every auth, or every payer behavior on day one.

## Required intake fields

Every work item should include:

- `workspaceId`
- `workType`
- `billingDomain`
- `formType`
- `patientRef`
- `providerRef`
- `claimRef`
- `payerName`
- `coverageType`
- `sourceSystem`
- `amountAtRisk`
- `priority`
- `dueAt`
- `metadata.supportingDocRefs`
- `metadata.providerContactEmail`

Optional but useful:

- `encounterRef`
- `metadata.billType`
- `metadata.portalChannel`
- `metadata.originalSubmissionDate`

## Agent action flow

### 1. Router Agent

The router should:

- confirm the case belongs in claim-status / correction workflow
- identify billing family and form type
- identify whether it is eligible for autonomous execution
- assign playbook version

Output:

- `auto_execute`
- `human_review_required`
- `blocked`

### 2. Worker Agent

The worker should:

- read the claim reference and payer context
- check the current status
- follow the lane playbook
- record every external action and observation
- propose one closure state

Closure proposal options:

- `status_obtained`
- `correction_submitted`
- `needs_more_docs`
- `payer_blocked`
- `escalate_to_human`

### 3. QA Agent

The QA agent should validate:

- required evidence exists
- the output matches the playbook
- the closure state is justified
- human review is not being skipped incorrectly

### 4. Escalation Agent

The escalation agent should package:

- reason code
- summary
- missing context
- recommended next human action

## Evidence contract

Each agent action should create a machine-readable evidence record:

- `actorType`
- `actorRef`
- `evidenceType`
- `payload`
- `createdAt`

Examples of evidence types:

- `status_lookup_completed`
- `portal_response_captured`
- `dde_correction_prepared`
- `dde_correction_submitted`
- `documentation_gap_found`
- `payer_response_ambiguous`

## Completion criteria

A case can close automatically only when:

- the current status is clear
- the playbook path is complete
- the evidence bundle is sufficient
- no required document is missing
- no ambiguity remains that would create commercial or compliance risk

## Escalation reasons

The first version should only use a tight set of exception classes:

- `missing_documentation`
- `credentialing_or_enrollment_gap`
- `coverage_mismatch`
- `portal_or_dde_access_failure`
- `ambiguous_payer_response`
- `underpayment_or_partial_payment`

## Human actions

Humans should only be allowed to:

- approve closure
- reject closure
- add missing context
- take over a failed case
- define a new rule or playbook
- classify a new exception type

They should not become a generic manual labor pool inside the product.

## Metrics that matter

The manager screen should track:

- total queue
- auto-resolved percentage
- escalated percentage
- average turnaround
- aging
- amount at risk
- payer bottlenecks
- human intervention rate

## Success bar

Early success is not replacing the team.

Early success is:

- 30 to 50 percent of this queue closing without human touch
- 80 to 90 percent of the remainder routed to the right human cleanly
- managers trusting the proof bundle and escalation logic
- clients getting better visibility than they had before
