# Repo Boundaries

## Why This Exists

AgentPay, Ace, and RCM can reinforce each other, but only if the seams stay clean.

This repo should behave like one product company with one authority layer, not a pile of disconnected app logic.

## Canonical Ownership

### AgentPay Core

AgentPay owns the shared authority layer:

- identity bundle
- mandate and operator context
- approval and hosted action sessions
- funding authority
- capability vault
- exact-call continuity
- receipts and audit
- remote MCP and host-native execution surfaces

Primary locations:

- `apps/api-edge`
- `packages/*`
- `migrations/*`
- `openapi.yaml`

If a seam is useful across multiple products or hosts, it belongs here.

### Ace

Ace is a front door that proves AgentPay under real-world travel conditions.

Ace should own:

- travel-specific user journeys
- itinerary and booking flows
- Meridian front-end experience
- travel domain language and user trust surface

Ace should not redefine:

- funding authority
- vault semantics
- approval session shape
- generic continuity logic

Primary locations:

- `apps/meridian`
- Ace-specific docs and planning notes

### RCM

RCM is another proving front door for AgentPay’s authority and execution loop in a vertical workflow.

RCM should own:

- claim-specific orchestration
- vertical user flows
- RCM-specific copy and status surfaces

RCM should consume shared AgentPay primitives instead of shadowing them.

### Founder / Ops

Founder and growth operations live in:

- `ops/*`

These artifacts can shape the narrative and execution cadence, but they should not become a shadow product spec that disagrees with core implementation.

## Move Logic Toward Core When

Move a seam into AgentPay Core if it affects:

- more than one host
- more than one vertical
- identity, authority, approval, funding, vaulting, or continuity
- receipts, audit, or proof

Examples:

- workbench lease handling
- hosted action session state
- provider connect orchestration
- exact-call resume

## Keep Logic In A Vertical When

Keep logic in Ace or RCM if it is truly vertical-specific:

- itinerary semantics
- travel supplier behavior
- claim status domain rules
- vertical UX language

## Dashboard Rule

Do not bury canonical runtime behavior in a dashboard-only surface.

If the dashboard has a useful control:

- the core route or tool-call seam should exist first
- the dashboard may consume it second

## Documentation Rule

Core docs should describe the shared runtime and authority model.

Vertical docs should describe how a front door uses those primitives, not redefine them.

## Review Checklist

When touching a seam, ask:

1. Is this shared authority logic or vertical logic?
2. Would Claude, OpenAI, and a terminal host all need the same primitive?
3. Am I making the dashboard more canonical than the host?
4. Am I asking humans to repeat work AgentPay should remember?
5. Am I making trust clearer or hiding it behind app-specific behavior?

If the answer points to shared runtime, move the seam toward AgentPay Core.
