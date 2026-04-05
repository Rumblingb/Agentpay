# AgentPay RCM - Connector Strategy

## Founder view

The company risk is not whether agents can work a billing queue.

The company risk is building around the wrong connector assumption.

The most dangerous assumption is:

- "We can just pull the DDE API and automate the whole thing."

That is too loose. DDE is not one clean universal automation rail. It is a fragmented access pattern that depends on payer, Medicare Administrative Contractor, workflow, and operator context.

The product has to start on the rails that are actually structured enough to automate.

## What to automate first

The first automation stack should be:

1. Medicare eligibility via `270/271`
2. Claim status via `276/277`
3. DDE and portal correction as an agent-assisted workflow when a case cannot close on the cleaner rails
4. ERA `835` and EFT as the payment-posting and reconciliation rails

That order matters.

## The correct product stance

AgentPay is not the payer rail.

AgentPay is the orchestration, proof, approval, and settlement spine around the work:

- intake
- playbook selection
- execution
- evidence capture
- exception routing
- supervisor approval
- fee and milestone release

Insurance money still moves on insurance rails.

## Connector reality by lane

### Eligibility

Best first Medicare automation rail:

- `HETS 270/271`

Why:

- standardized
- real-time
- clear response contract
- directly useful for queue qualification before human time is wasted

### Claim status

Best first status rail:

- `X12 276/277`

Why:

- standardized
- high-volume
- easy to measure
- avoids turning operators into manual status checkers

### DDE correction

Use DDE as:

- an execution path
- a correction path
- a fallback path

Do not use DDE as:

- the whole architecture
- the main product thesis
- the only connector strategy

### Payment posting

Use:

- `ERA 835`
- EFT reconciliation

This is where insurance payment and posting evidence belong.

## Critical founder holes

### 1. Scope hole

Do not try to automate:

- professional billing
- home health
- hospice
- DME
- dental
- eye
- ortho

in the same first release.

That would create a wide demo and a weak company.

### 2. Home health documentation hole

Home health is not just billing admin.

It depends on:

- patient eligibility
- homebound status
- intermittent skilled need
- certified provider status
- plan-of-care and certification support
- supporting documentation quality

That means missing documents and invalid certification will dominate exceptions if you go too broad too early.

### 3. DME enrollment hole

DME is not "just another claim type."

It carries separate enrollment, accreditation, and supplier requirements. It should be framed as a later expansion, not casually folded into the first lane.

### 4. Credential custody hole

"Logging in on behalf of the provider" is a real product and compliance problem.

The platform needs:

- credential vaulting
- role-based access
- audit trails
- session attribution
- strict operator controls

before portal-heavy execution becomes a serious enterprise product.

### 5. Money movement hole

Do not let the team blur:

- insurer payment to provider
- AgentPay fee settlement
- workflow completion

Those are related, but they are not the same event.

## The right first wedge

The first wedge should remain:

- institutional claim status follow-up
- DDE correction where needed

Why this wedge wins:

- repetitive
- measurable
- enough volume to matter
- limited clinical judgment
- clean proof bundles
- strong supervisor trust loop

## The right second wedge

After the first wedge proves closure and exception routing, expand to:

- posting exceptions
- denial subtypes with narrow rules
- prior auth follow-up

Do not go broader until the first queue closes well.

## Is an OpenClaw-style method the way?

Partly, but not literally.

The useful parts of an OpenClaw-style system are:

- durable background task flow
- specialized sub-agents
- event hooks
- auditable task records
- reusable workflow programs

Those are good primitives for billing ops.

The dangerous part is copying the wrong center of gravity:

- one persistent general agent
- broad tool authority
- in-process trusted plugin execution
- loosely typed end-to-end autonomy

That is a bad fit for healthcare admin and payer operations.

## The right runtime stance

The right model for this repo is:

1. typed workflow engine first
2. specialized agents inside each lane
3. evidence emitted at every step
4. explicit confidence thresholds
5. human approval and exception routing throughout

So the answer is:

- yes to the orchestration ideas
- no to letting one general agent run the whole operation end to end

The system should feel like:

- a controlled autonomous factory

not:

- a smart assistant with wide-open credentials

## What to borrow

Borrow:

- task ledgers
- event-driven hooks
- standing playbooks
- explicit sub-agent coordination
- durable multi-step flow state

## What to avoid

Avoid:

- free-form browser-first execution as the primary operating model
- plugin-heavy authority over production systems
- vague memory-driven behavior replacing typed case state
- hiding approval boundaries inside natural-language prompts

## Repo implication

This means the first implementation should keep:

- `RcmWorkItem` as the source of truth
- typed milestone and exception records
- connector adapters as bounded services
- agents as lane workers, not as the system of record

If you ever introduce a more OpenClaw-like runtime for internal ops speed, it should sit behind these controls, not replace them.

## What this means for the repo

The repo should explicitly encode:

- `276/277` as the preferred claim-status rail
- `270/271` as the preferred eligibility rail
- DDE as a connector family and fallback workflow
- ERA and EFT as remittance and posting inputs
- human review only for blocked or low-confidence cases

That keeps the company story honest and keeps the build pointed at the most automatable work first.
