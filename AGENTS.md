# AgentPay Operating Guide

This repo should be worked like a product company, not a ticket queue.

The broader vision is larger than any one surface. AgentPay is the core authority layer. Ace and RCM are showcase front doors that prove the core under real-world conditions.

## Canonical Direction

Read these first for any substantial work:
- `docs/EXECUTION_PROGRAM.md`
- `docs/AGENT_NATIVE_NORTH_STAR.md`
- `docs/REPO_BOUNDARIES.md`

## Core Rule

AgentPay is the engine.

It owns:
- mandate
- identity bundle
- approval session
- funding authority
- execution continuity
- receipts and audit
- host-native runtime through remote MCP and hosted actions

Ace and RCM should consume these primitives.
They should not redefine them.

## Default Lenses

Every meaningful change should be judged through four lenses:

1. Product
   Does this reduce manual setup, keep runtime in-host, or make blocked work resumable?
2. Engineering
   Is the seam correct, simple, and shared when it should be shared?
3. Distribution
   Does this help AgentPay work better through remote MCP, connector, app, or hosted-action surfaces?
4. QA
   What actually happens on the real path: fresh setup, missing authority, approval needed, funding needed, auth failure, recovery, and proof?

## Surface Ownership

`AgentPay Core`
- `apps/api-edge`
- `packages/*`
- `migrations/*`
- `openapi.yaml`

`Ace`
- `apps/meridian`
- travel-specific routes and booking libs

`RCM`
- RCM-specific routes, libs, and dashboard surfaces

`Founder / Ops`
- `ops/command-center`

If a seam is useful across multiple workflows, move it toward AgentPay Core.
If it only matters for one product lane, keep it in that lane.

## Default Delivery Loop

For substantial work, use this order:

1. Think
   Reframe the request into the real product problem and the hidden risk.
2. Plan
   Name the touched seams: host runtime, mandate, approval, funding, identity, recovery, proof, or a vertical front door.
3. Build
   Prefer the smallest correct seam over a dramatic rewrite.
4. Review
   Check for platform drift, stale product language, and vertical logic leaking into shared runtime.
5. Test
   Run the relevant checks, then reason through the full user path rather than just the diff.
6. Ship
   Only call something done when the product read and the technical seam are both clean.
7. Reflect
   Note the remaining ceiling honestly: architecture, product language, QA, or distribution.

## Drift Guardrails

Do not ship changes that:
- turn the dashboard into the main runtime surface
- ask humans to repeat setup AgentPay should own
- expose infrastructure or secret-key language to users
- bury shared runtime logic inside a vertical
- optimize for a generic marketplace story over governed execution

## Ace-Specific Bar

When work touches Meridian or the Ace experience, apply this extra bar.

Ace should feel:
- I can just ask once.
- Ace understands what matters.
- Ace stays with the trip.
- Ace is calm and in control when things go wrong.

Do not ship Ace changes that:
- feel generic, over-animated, or obviously AI-generated
- teach one interaction in onboarding and another in the live app
- break journey continuity to win a prettier screen
- regress older-device behavior for spectacle

If the change touches Meridian, mentally or explicitly walk:
1. Fresh install
2. Returning user
3. Microphone denied
4. Slow or failing network
5. Live journey resume
6. Reroute notification tap
7. Older iPhone sizing and performance

## Decision Rule

If there is tension between:
- more spectacle
- and more trust

choose trust.

If there is tension between:
- more code cleverness
- and a cleaner product seam

choose the cleaner seam.
