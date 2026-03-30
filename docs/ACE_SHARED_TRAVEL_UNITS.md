# Ace Shared Travel Units

Ace should understand `us`, not just `me plus passengers`.

This document maps the path from today's single-owner family list to a proper
shared travel model for couples, families, and recurring groups.

## Product Goal

When two real Ace customers travel together, Ace should behave like it knows
the relationship:

- `Book us to Glasgow tomorrow`
- `Take the family to Edinburgh this weekend`
- `Get us home`

The customer should not feel like they are rebuilding a passenger list each
time. Ace should understand the social shape of the trip and make better
recommendations because of it.

## What Exists Today

- One owner can save `familyMembers` inside their protected travel profile.
- Ace can use those saved names for group booking requests.
- This works well for `me + companions`, but not yet for `two first-class Ace users`.

## MVP Direction

Introduce `Shared Travel Units` in the app:

- `Couple`
- `Family`
- `Household`

Each unit stores:

- the unit name
- the members
- who usually pays
- whether a member is:
  - `You`
  - `Linked Ace member`
  - `Invitation pending`
  - `Guest only`

This gives Ace the right mental model now without forcing a redesign later.

## Phase Plan

### Phase 1: Product Foundation

- Add a `Couple & Household` settings surface
- Add local storage for shared travel units
- Let the user define:
  - unit type
  - unit name
  - members
  - payer
  - relationship state
- Keep current `Family & Group` flow for companion travel that is still local-only

### Phase 2: Account Linking

- Invite another Ace user by phone or email
- Accept invite on the second account
- Mark the member as `linked`
- Add scoped consent for profile sharing during shared bookings

### Phase 3: Shared Booking Intelligence

- `Book for us`
- `Book for the family`
- shared defaults
- group-aware recommendation logic
- shared readiness checks
- explicit payer selection

### Phase 4: Trust and Permissions

- each adult controls what can be used for shared bookings
- profile fields are only shared when needed
- shared trip visibility
- household-level payment permissions

## First Implementation Slice

Ship now:

- local `Shared Travel Units` model
- settings entry point
- edit screen for units and members
- reset-safe persistence

Do not fake yet:

- real cross-account sync
- remote invite acceptance
- joint payment authorization
- hidden profile sharing

## Execution Board

### Done in this slice

- roadmap created
- local domain model added
- customer-facing settings entry added
- app screen for managing units added
- backend invite + accept foundation added
- booking-time shared payer / approval rules added

### Next

1. connect the mobile shared-unit screen to the backend invite/accept APIs
2. sync local units with linked backend state
3. add shared-payment rules with real multi-adult approval
4. add group-aware recommendation logic
5. surface `book for us` and `family-safe` recommendations more deeply in the brief
