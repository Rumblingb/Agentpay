# Agency OS Runtime

## Mission

Agency OS is the merged product, build, design, growth, and revenue runtime.

It should operate like a workflow system, not a room full of free-form chatbots.

## Internal roles

Agency OS keeps one first-class lane and routes work into bounded roles:
- Product Lead
- Build Lead
- Design Lead
- Growth Lead
- Revenue Lead

These are execution roles, not separate always-on giant brains.

## Operating loop

1. Intake
- clarify the task
- classify the lane: product, build, design, growth, revenue, support, release

2. Plan
- define the next artifact or decision
- define acceptance criteria
- decide whether native tools can complete the step without heavy LLM use

3. Execute
- prefer deterministic tools and repo code first
- use local light model for triage and shaping
- use local heavy model for bounded implementation and QA planning

4. Review
- use cloud review only when launch, architecture, customer impact, or revenue impact justify it

5. Publish
- write the artifact, issue, spec, code change, or release note
- update the relevant operating memory

## Artifact bias

Each Agency OS run should leave one concrete artifact behind:
- roadmap note
- product decision memo
- code change
- QA checklist
- launch brief
- landing page draft
- funnel analysis
- outbound asset
- support or release note

## Boundaries

- Agency OS owns AgentPay, ACE, RCM Billing, and future product launches.
- Agency OS does not own Bill trading logic.
- Hermes audits Agency OS, but Hermes does not replace it.
