# Ace Mobile Design System

## Product Standard

Ace should feel like a premium spoken concierge, not a travel utility.

The benchmark is not "modern app UI." The benchmark is:

- calm under pressure
- radically clear at the moment of decision
- elegant enough that complexity disappears
- distinctive enough that it does not resemble generic travel software

## Core Principles

### 1. Voice Is The Front Door

Voice is not an add-on. Voice is the primary interaction model.

Design implications:

- the microphone/orb is the emotional center of the product
- empty states should invite speech, not menu exploration
- copy should assume the customer speaks in natural language
- suggestion chips should sound like plausible spoken asks

### 2. Ace Handles The Work

The product should communicate ownership, not just status.

Design implications:

- prefer "Ace is handling this now" over technical progress language
- every stressful state should answer: what is happening, what Ace is doing, whether the user needs to act
- avoid phrases that make the customer feel like an operator of the system

### 3. Premium Means Fewer Sharp Edges

Luxury in software is mostly the removal of friction, confusion, and needless visual noise.

Design implications:

- strong hierarchy with very few competing elements
- one dominant action per section
- restrained color use with clear semantic meaning
- motion and glow should support confidence, not spectacle

### 4. Invisible Complexity

Ace may orchestrate multiple services, manual fulfilment, and delayed operations. The UI should never make the customer carry that complexity.

Design implications:

- show state truthfully, but never expose internal plumbing unless it materially helps trust
- collapse complexity into clear human outcomes
- unify booking, disruption, and support states into one language

## Visual Language

### Overall Feel

- dark, atmospheric, high-contrast
- editorial, not dashboard-like
- sculpted surfaces over flat rectangles
- subtle depth, soft glow, and controlled contrast

### Color Roles

- emerald: trust, success, handled
- sky: live movement, context, guidance
- amber: pending action, payment, timing sensitivity
- red: intervention required
- indigo: intelligence, reflection, system thinking

Rules:

- use accent colors sparingly
- never let warning and success compete in the same block
- backgrounds should feel layered, not flat

### Typography

Typography should feel confident and precise.

Rules:

- large headlines should be spare and decisive
- eyebrow labels should be uppercase, tracked, and purposeful
- supporting text should be shorter than normal product copy
- avoid dense walls of explanation

## Layout Rules

### Home / Voice Screen

The first screen should feel like an invitation, not a control panel.

Must include:

- one dominant hero statement
- one clear spoken prompt
- one visible live-trip handoff if relevant
- one thoughtful set of example asks
- the orb anchored as the primary instrument

Avoid:

- dense navigation-first layouts
- too many equally weighted cards
- generic "assistant chat" framing

### Booking Confirmation

The confirmation screen should feel like a composed briefing.

Must include:

- what Ace chose
- why it chose it
- what is ready
- what still depends on the user
- one high-confidence confirmation action

Avoid:

- transactional clutter
- unexplained fare breakdown noise
- scary compliance language unless necessary

### Live Trip / Status

The status screen should feel like a concierge actively managing the trip.

Must include:

- exact current state
- what Ace is doing now
- expected timing
- whether the customer needs to act
- direct recovery and support options

Avoid:

- fake instantness
- internal ops language
- ambiguous waiting

## Copy Rules

### Preferred Voice

- direct
- calm
- expensive-feeling
- operationally competent

### Good Patterns

- "Trip in hand"
- "Ready for payment"
- "Journey paused"
- "Your trip, all together"
- "Ace will guide the next step"

### Avoid

- "working on it"
- "request received"
- "contact support" as the only action
- startup infrastructure references
- technical implementation language

## Seamlessness Checklist

Before shipping a screen:

- Does the customer know what happens next?
- Does the customer know whether Ace has taken ownership?
- Is there exactly one dominant next action?
- Does the screen sound like one brand voice?
- Are there any plumbing leaks: old brand names, raw domains, internal terms?
- Would this still feel composed if the flow took 5 minutes instead of 5 seconds?

## Anti-Patterns

- generic AI purple gradients
- loud consumer-travel marketplace visuals
- copy that sounds like a support ticket
- treating voice like a novelty feature
- exposing incomplete backend architecture to the user
- packing the screen with equal-priority surfaces

## Implementation Priority

1. Main voice concierge screen
2. Confirmation card
3. Live trip status
4. Receipt and trips history
5. Map and wallet secondary surfaces
