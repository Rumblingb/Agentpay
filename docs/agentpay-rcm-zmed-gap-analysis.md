# AgentPay RCM - ZMed Gap Analysis

## Why this matters

ZMed is useful because it shows what a real outsourced billing operator sells today:

- claim data entry, validation, and transmission
- claims review and follow-up
- recovery and collections
- patient eligibility verification
- payment posting and remittance advisory
- reporting and accounting
- hospice `NOE/NOTR`
- PAS authorization and modifier verification
- DME authorization and secondary-claim work
- physician-side authorization, payer ID, and reimbursement checks

That makes the benchmark concrete.

The goal should be:

- automate the full service bundle over time

but the operating system still has to start with the most repeatable lanes first.

## The holes if we try to copy them literally

### 1. Service-list copying is not strategy

If we just mirror their service list, we will end up with a broad outsourcing dashboard.

The better move is:

- encode every service as a lane
- rank each lane by automation readiness
- start with the lanes that have structured rails and measurable completion

### 2. Their bundle mixes rails, workflows, and human judgment

ZMed's public pages combine:

- machine-friendly work
- operator workflows
- human judgment tasks

Those are not equal.

For us, they split into:

#### Automate now

- eligibility verification
- claim status follow-up
- payment posting and remittance reconciliation
- secondary claim triggering
- reporting and scorecards

#### Automate with human exceptions

- claim data entry, validation, and transmission
- DDE correction
- PAS and DME authorization verification
- payer follow-up
- recovery workflows
- hospice `NOE/NOTR`

#### Keep human-led initially

- broad denial resolution
- appeals with judgment
- complex document gathering
- credentialing and enrollment changes
- portal access exceptions

### 3. Home health and hospice are not generic admin

These domains carry rules that make documentation quality and timing central to reimbursement:

- homebound and skilled-need rules
- certification and plan-of-care requirements
- face-to-face requirements
- hospice `NOE` and `NOTR` timing

That means a lot of the perceived "billing" burden is actually documentation and compliance burden.

### 4. DME is a separate operational world

DME is not just another claim queue.

It carries:

- enrollment complexity
- accreditation requirements
- order and face-to-face constraints for some items
- supplier-specific operational rules

That should be a later expansion or a tightly bounded module, not an afterthought.

### 5. Spreadsheet accounting is a clue

Their public copy repeatedly references spreadsheet-style payment posting and accounting.

That is a market signal:

- many teams still run the business on weak systems of record

This is good news for us, but it means import/export, proof bundles, and reconciled payout views matter early.

## The right product response

AgentPay should not just "do medical billing."

It should become:

- the autonomous operating layer for outsourced and in-house billing queues

That means:

1. `RcmWorkItem` is the case
2. connectors fetch structured payer state
3. specialized agents work the lane
4. evidence is captured on every step
5. humans only resolve explicit exceptions
6. reports and payout logic are generated from the work ledger

## Revised automation ladder

### Phase 1

- Medicare eligibility
- claim status follow-up
- payment posting reconciliation
- secondary claim triggering
- manager reporting

### Phase 1.5

- DDE correction workflow
- hospice `NOE/NOTR`
- PAS modifier and authorization verification
- home health claim validation

### Phase 2

- narrow denial subtypes
- DME authorization and follow-up
- recovery and collections playbooks
- broader payer follow-up

### Phase 3

- complex physician workflows
- appeals
- document-chase orchestration
- enrollment and credential-change workflows

## What we fixed in the repo

The repo now encodes this more honestly:

- `serviceModules` across home health, hospice, DME, PAS, and physician
- an `automationLadder` that separates immediate automation from exception-heavy work
- a `/api/rcm/services` scaffold route for the bundle
- internal RCM planning docs that call out the remaining founder holes

## Bottom line

Yes, we should aim to automate everything they do.

But the right way to win is:

- automate the repeatable rails first
- push judgment-heavy work behind explicit exception handling
- let the product expand lane by lane until the whole outsourced billing bundle is covered
