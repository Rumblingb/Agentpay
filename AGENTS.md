# AgentPay / Ace Agent Operating System

This repo should be worked like a product company, not a ticket queue.

The goal is not just to land code. The goal is to make Ace feel more inevitable, more trustworthy, and more handled.

## North Star

Ace is a luxury voice-first travel concierge.

The user should feel:
- I can just ask once.
- Ace understands what matters.
- Ace stays with the trip.
- Ace is calm and in control when things go wrong.

AgentPay is the engine. Ace is the visible product.

## Required Lenses

Every meaningful change should be judged through four lenses:

1. Product
   - What promise is Ace making to the user?
   - Does this make travel feel more handled, or more manual?
2. Design
   - Does this feel premium, calm, and inevitable?
   - Is there any sign of beta language, generic AI styling, or engineering scaffolding?
3. Engineering
   - Is the seam correct, simple, and compatible with the current stack?
   - Does it preserve journey continuity, voice behavior, and older-device stability?
4. QA
   - What actually happens on a fresh install, denied mic, slow network, live journey resume, reroute notification, and older iPhone?

## Default Delivery Loop

For substantial work, use this order:

1. Think
   - Reframe the request into the real product problem.
   - Name the user-facing surface and the hidden risk.
2. Plan
   - Check which surfaces are touched:
     - boot/loading
     - onboarding
     - conversation presence
     - voice loop
     - confirm/execute
     - journey/status/receipt
     - notifications/re-entry
3. Build
   - Prefer the smallest correct seam over a dramatic rewrite.
   - If the real issue is an art source or product language problem, say so clearly.
4. Review
   - Look for stale product language, broken continuity, generic branding, fake intelligence signals, or old interaction models leaking through.
5. Test
   - Run code checks.
   - Then reason through the real user path, not just the diff.
6. Ship
   - Only call something done when the code and the product read are both clean.
7. Reflect
   - Note the remaining ceiling honestly: architecture, product language, QA, or art source.

## World-Class Bar

Do not ship changes that:
- expose infrastructure or secret-key language to users
- teach one interaction in onboarding and another in the live app
- look good in isolation but break the trip spine
- feel generic, over-animated, or obviously AI-generated
- regress older-device behavior to win a screenshot

## Surface Checklists

### Boot / Loading
- Does the brand object match the current Ace system?
- Does the app hand off cleanly into onboarding, journey resume, or converse?
- Is the loading moment premium rather than noisy?

### Onboarding
- Does it teach the same voice model the main app actually uses?
- Is the copy finished and inevitable, not explanatory or beta-ish?
- Are the sigil/object, color system, and motion language aligned with the live app?

### Converse
- Does Ace feel like a presence, not a button?
- Does the object react to real user state, not arbitrary decoration?
- Does the screen feel integrated rather than docked or panelized?

### Confirm / Execute
- Does the user feel informed and in control?
- Is the transition from plan to confirmation to execution trustworthy?
- Are we avoiding dead-end or ambiguous payment and booking states?

### Journey / Status / Receipt
- Does continuity survive failure, retry, reroute, and manual review?
- Is the trip still clearly owned by Ace after booking?

### Notifications / Re-entry
- Does the app land the user in the right place immediately?
- Are disruptions turned into specific next actions, not just alerts?

## Product Language Rules

Prefer:
- calm
- precise
- concierge-like
- outcome-oriented

Avoid:
- internal system language
- hype
- "AI assistant" cliches
- engineering explanations in user copy
- generic travel-app phrasing

## Visual Rules

Prefer:
- one strong object
- depth over clutter
- restrained motion
- material clarity
- bold silhouette

Avoid:
- generic waveforms with no brand identity
- decorative flourishes that hurt legibility
- too many simultaneous overlays
- beautiful placeholder branding

## QA Rules

If the change touches Meridian, mentally or explicitly walk these cases:

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

## graphify

If `graphify-out/` exists for this project, treat it as the preferred map before falling back to raw-file search.

Rules:
- Before answering architecture or codebase questions, read `graphify-out/GRAPH_REPORT.md` when it exists for god nodes and community structure.
- If `graphify-out/wiki/index.md` exists, navigate it instead of reading raw files.
- After modifying code files, refresh the graph only when graphify output already exists or graphify is actively being used for this repo.
