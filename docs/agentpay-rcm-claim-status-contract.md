# AgentPay RCM - Claim Status Implementation Contract

## Purpose

This is the exact build contract for the first live lane:

- institutional claim status follow-up
- bounded DDE correction when needed

It turns the strategy into an implementation seam.

## Intake schema

Required root fields:

- `workspaceId`
- `title`
- `workType`
- `billingDomain`
- `formType`
- `payerName`
- `coverageType`
- `patientRef`
- `providerRef`
- `claimRef`
- `sourceSystem`
- `priority`
- `dueAt`
- `amountAtRisk`

Optional root fields:

- `encounterRef`
- `metadata.billType`
- `metadata.portalChannel`

Required metadata:

- `metadata.supportingDocRefs`
- `metadata.providerContactEmail`
- `metadata.originalSubmissionDate`

Optional metadata:

- `metadata.claimFrequencyCode`
- `metadata.macRegion`
- `metadata.notes`
- `metadata.secondaryPayerName`

## State machine

Initial state:

- `new`

Terminal states:

- `closed_auto`
- `closed_human`
- `blocked`
- `rejected`

Working states:

- `routed`
- `executing_primary`
- `awaiting_qa`
- `retry_pending`
- `executing_fallback`
- `human_review_required`

## Transition rules

1. `new -> routed`
   - trigger: router accepts the lane
2. `new -> blocked`
   - trigger: prerequisite missing before execution
3. `routed -> executing_primary`
   - trigger: primary worker starts
4. `executing_primary -> awaiting_qa`
   - trigger: worker submits evidence and a proposed resolution
5. `awaiting_qa -> closed_auto`
   - trigger: QA approves autonomous closure
6. `awaiting_qa -> retry_pending`
   - trigger: QA approves one fallback attempt
7. `awaiting_qa -> human_review_required`
   - trigger: QA escalates
8. `retry_pending -> executing_fallback`
   - trigger: fallback worker starts
9. `executing_fallback -> awaiting_qa`
   - trigger: fallback worker submits result
10. `human_review_required -> closed_human`
   - trigger: human approves or takes over
11. `human_review_required -> blocked`
   - trigger: human marks the case externally blocked
12. `human_review_required -> rejected`
   - trigger: human rejects the proposed path

## Agent payload contracts

### Router agent

Input:

- `workItemCore`
- `metadata.supportingDocRefs`
- `metadata.originalSubmissionDate`

Output:

- `laneSelection`
- `playbookVersion`
- `priorityBand`
- `autoExecuteAllowed`
- `routingReason`

### Worker agent

Input:

- `claimRef`
- `payerName`
- `coverageType`
- `formType`
- `playbookVersion`
- `connectorHints`

Output:

- `proposedResolution`
- `resolutionReasonCode`
- `confidencePct`
- `evidenceBundle`
- `nextBestAction`

### QA agent

Input:

- `proposedResolution`
- `confidencePct`
- `evidenceBundle`
- `playbookVersion`

Output:

- `qaDecision`
- `qaReasonCode`
- `retryAllowed`
- `requiredEscalationFields`

### Fallback worker agent

Input:

- `priorAttemptSummary`
- `connectorFailureHistory`
- `alternativeStrategy`

Output:

- `fallbackResolution`
- `fallbackReasonCode`
- `confidencePct`
- `evidenceBundle`

### Escalation agent

Input:

- `workItemSummary`
- `exceptionPacket`
- `missingContextFields`
- `recommendedHumanAction`

Output:

- `queueAssignment`
- `reviewerInstructions`
- `newExceptionClassCandidate`

## Retry rules

- maximum `2` autonomous attempts
- second attempt must use a different strategy
- no retry without new evidence or a changed connector path
- repeated connector failure goes to human review

## Completion criteria

A case may close autonomously only when:

- claim status is clearly established or the correction was successfully submitted
- required evidence exists for each external action
- no required documentation gap remains
- no unresolved payer ambiguity remains
- confidence and QA thresholds are met

## Evidence contract

Required evidence types for this lane:

- `status_lookup_requested`
- `status_lookup_completed`
- `portal_response_captured`
- `edi_276_submitted`
- `edi_277_received`
- `dde_correction_prepared`
- `dde_correction_submitted`
- `documentation_gap_found`
- `payer_response_ambiguous`
- `qa_decision_recorded`

## Exception inbox contract

Queue key:

- `claim_status_exceptions`

Columns:

- `workItemId`
- `workspaceName`
- `payerName`
- `claimRef`
- `priority`
- `exceptionType`
- `reasonCode`
- `confidencePct`
- `amountAtRisk`
- `requiredContextFields`
- `recommendedHumanAction`
- `openedAt`
- `slaAt`
- `assignedReviewer`

Triage buckets:

- `missing_documentation`
- `credentialing_or_enrollment_gap`
- `coverage_mismatch`
- `portal_or_dde_access_failure`
- `ambiguous_payer_response`
- `underpayment_or_partial_payment`

Allowed human actions:

- `approve_closure`
- `reject_closure`
- `add_missing_context`
- `take_over_case`
- `mark_blocked`
- `propose_rule_candidate`
- `classify_new_exception_type`

## Metrics

- `autoClosedPct`
- `retryRate`
- `exceptionRate`
- `humanInterventionRate`
- `avgTurnaroundMins`
- `qaRejectionRate`
- `connectorFailureRate`
- `amountAtRiskClosed`

## Lane endpoints

Read surface:

- `GET /api/rcm/lanes/claim-status`
- `GET /api/rcm/lanes/claim-status/work-items`
- `GET /api/rcm/queues/claim-status-exceptions`
- `GET /api/rcm/connectors/claim-status`
- `GET /api/rcm/autonomy-loop`
- `GET /api/rcm/metrics/queues`

Live mutation surface:

- `POST /api/rcm/lanes/claim-status/intake`
- `POST /api/rcm/lanes/claim-status/work-items/:workItemId/run-primary`
- `POST /api/rcm/lanes/claim-status/work-items/:workItemId/run-fallback`
- `POST /api/rcm/lanes/claim-status/work-items/:workItemId/execute`
- `POST /api/rcm/lanes/claim-status/work-items/:workItemId/verify`
- `POST /api/rcm/lanes/claim-status/work-items/:workItemId/retry`
- `POST /api/rcm/lanes/claim-status/work-items/:workItemId/escalate`
- `POST /api/rcm/lanes/claim-status/work-items/:workItemId/resolve`

## Product read

This is the right level of precision for the first lane.

It is:

- narrow
- automatable
- measurable
- auditable
- expandable

That is how the company gets to the full autonomous RCM vision without becoming vague or unsafe.
