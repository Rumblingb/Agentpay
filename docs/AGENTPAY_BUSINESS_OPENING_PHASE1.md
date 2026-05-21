# AgentPay Business Opening Phase 1

> Status: Product direction and build plan
> Last updated: 2026-05-21
> Principle: AgentPay sits above Stripe and partner rails. It does not compete with them.

## Decision

Move toward a Tide-like business opening workflow, but make the wedge agent-native rather than bank-native.

AgentPay should let a developer, founder, sole proprietor, or small business operator ask their agent to set up the business operating stack. The agent collects documents, prepares forms, chooses partner capabilities from the AgentPay marketplace, asks the human for legally meaningful approvals, and resumes the workflow after each approval.

This should not start as a bank, a Stripe competitor, a law firm, or a standalone incorporation vendor.

## Product Shape

The first product is an agent-led business opening packet:

1. Collect business intent, jurisdiction, owner details, entity preference, tax needs, and operating constraints.
2. Explain available structures using official source-backed decision support, not legal advice.
3. Build a document checklist and collect files through the AgentPay vault.
4. Route formation, EIN, KYB, payment, treasury, and card steps through marketplace capabilities.
5. Interrupt the human only for entity choice, payment, signature, consent, identity verification, and final filing/submission.
6. Produce an auditable business opening record: what was chosen, what was submitted, who approved, what partner handled it, and what remains pending.

The experience should feel like:

> "Codex, open my business stack."

AgentPay then becomes the authority layer that lets Codex complete the steps safely.

## What AgentPay Owns

- Agent-facing marketplace selection: which formation, payment, identity, banking, insurance, or tax capability fits the user's requirements.
- Authority and approval: the human approves filings, payments, account opening, data sharing, and policy exceptions by phone or hosted action.
- Document vault: encrypted storage, classification, redaction support, expiry, and consent records.
- Workflow state: pending document, pending filing, pending KYB, pending account, pending payment, active, blocked, revoked.
- Receipts and audit: signed records for every approval and submission.
- Policy layer: spend limits, allowed counterparties, partner restrictions, data-sharing constraints, and revocation.
- Revenue share and partner settlement: AgentPay marketplace economics on top of partner rails.

## What Partners Own

- Payment processing: Stripe, Airwallex, Razorpay, stablecoin settlement partners, or other rails.
- Embedded business accounts, treasury, issuing, and cards: bank sponsor or embedded finance partner.
- Identity and KYB: Stripe Identity, Persona, Alloy, Middesk, or equivalent.
- State formation and registered agent services: direct state portals where possible, otherwise formation partners.
- Tax filing and legal advice: licensed professionals or partner services.
- Insurance quoting, binding, and claims: licensed insurance producers/carriers.

## Official Source Anchors

- SBA: business structure choice varies by structure and location; sole proprietorships are simple to form, while LLCs/corporations create separate state-law entities.
- IRS: EIN applications are free through the IRS; if forming an LLC, partnership, corporation, or nonprofit, the entity should be formed through the state before applying for the EIN.
- FinCEN: under the March 26, 2025 interim final rule, U.S.-created entities and U.S. beneficial owners are exempt from BOI reporting; foreign companies registered to do business in the U.S. can still have BOI obligations. Re-check before launch.
- Stripe Treasury: financial accounts are an embedded finance primitive for platforms and are attached to connected accounts. Treat this as a partner rail, not something AgentPay replaces.
- NAIC/NIPR: insurance producer licensing is state-regulated. AgentPay should route insurance work through licensed partners unless and until the company deliberately obtains licenses.

## Fail-Safe Rules

1. No legal, tax, banking, or insurance advice is executed automatically. The agent can prepare options and explain source-backed tradeoffs; the human confirms the decision.
2. No formation filing, EIN submission, account opening, insurance quote binding, payment, or card issuance without explicit human approval.
3. No statement that AgentPay is a bank, FDIC-insured institution, law firm, tax advisor, insurance producer, or money transmitter unless that is true for the specific entity and jurisdiction.
4. No customer funds custody in Phase 1. Money movement and stored balances must sit on partner rails.
5. No raw identity documents in model prompts. Agents receive references, extracted fields where necessary, and least-privilege tool access.
6. No permanent document retention by default. Sensitive documents need expiry, deletion, and revocation controls.
7. No hidden partner choice. The approval receipt must name the provider, fee, data shared, and action being authorized.
8. No cross-jurisdiction assumptions. The workflow must branch by country, state, entity type, owner residency, and regulated activity.
9. No marketplace listing for regulated services without a `regulated_service` flag, licensing metadata, supported jurisdictions, and blocked categories.
10. No autopilot continuation after a rejected, expired, or mismatched approval.

## Phase 1 Build Scope

### P0: Business Opening Blueprint

- Add `business_opening` as a marketplace capability category.
- Add structured intake for:
  - country/state
  - business activity
  - owner residency
  - entity type preference
  - expected payment volume
  - whether employees or contractors are expected
  - insurance needs
  - whether cards, bank account, invoicing, or payout accounts are needed
- Add authority actions:
  - `approve_entity_choice`
  - `approve_document_use`
  - `approve_partner_selection`
  - `approve_filing_payment`
  - `approve_account_opening`
- Add a business opening record with state transitions and immutable approval receipts.

### P1: Document Vault and Packet Builder

- Encrypted upload and document metadata.
- PII classification and redaction helpers.
- Document checklist by entity type and jurisdiction.
- Generated packet summary for the user and agent.
- Hosted action session for human review and approval.

### P2: Partner Rails

- Stripe Connect/Identity/Treasury path for business payment and account primitives where available.
- Formation provider marketplace entries.
- EIN handoff flow that sends the user to official IRS flow or an approved partner.
- Insurance partner entries for quote collection and licensed binding.

### P3: Operating Layer

- AgentPay policy wallet for the new business:
  - monthly spend caps
  - vendor allowlists
  - approval thresholds
  - agent roles
  - audit export
- Business dashboard as support infrastructure, while the main workflow remains agent-first.

## Updated GPAS

Goal: Become the agent-native business opening and financial authority layer for SMBs, without competing with Stripe or becoming a bank first.

Product: Agent-led business opening packet, document vault, partner marketplace routing, governed approvals, and business policy wallet.

Action: Build Phase 1 as a non-custodial, partner-routed workflow for sole proprietors and simple LLC-style SMBs first.

Status: The marketplace authority foundation exists in PR #152. The next product increment is business opening records, document vault, and hosted approvals.

## Mainstream Path

The mainstream wedge is not "open a bank account." It is:

> "Your agent can start and operate your business admin stack safely."

That lets AgentPay win distribution in Codex and other agent workbenches before it asks users to trust a financial product directly.

The correct expansion sequence is:

1. Agent marketplace and authority.
2. Business opening workflow.
3. Partner-powered payments and financial accounts.
4. Agent policy wallet for SMB operations.
5. Insurance and fintech partner marketplace.
6. Regulated licenses only where partner coverage or economics justify it.

This keeps AgentPay above Stripe, not beside it.
