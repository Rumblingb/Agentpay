# Ace Ground Travel Sprints

Ace wins if rail and bus become easier than thinking about them.

The customer standard:
- say the outcome once
- confirm once
- move on
- trust Ace to handle the messy middle

This plan keeps trains and buses as the core wedge while still preparing the global network.

## Where Ace Can Dominate

### UK Rail
- National Rail / Darwin for live truth
- Trainline for booking depth
- TfL for last-mile continuity
- Family railcards and repeat journeys as habit loops

### India Rail
- IRCTC is strategically important
- UPI + rail is a powerful local wedge
- Tatkal, waitlist, and profile readiness should become a superpower

### Europe Rail
- Trainline + Rail Europe + Distribusion
- Eurostar, TGV, ICE, Frecciarossa, AVE, Thalys corridors
- This is where Ace starts to feel global without losing focus

### Global Coach / Bus
- Busbud gives the broadest immediate surface
- FlixBus gives direct depth in Europe and the US
- redBus and 12Go matter for India and SE Asia
- Coaches should be presented as the calm low-friction option, not the budget leftover

### Next Wave Rail
- G2Rail for Asia + North America
- SilverRail for Amtrak / VIA
- 12Go for SE Asia multimodal

## Sprint Sequence

## Sprint 1: Reliability For Core Ground Travel

Goal:
Ace should feel dependable for the existing rail and coach path before we expand further.

Ship:
- dedicated rate limiting for `/api/concierge/intent`
- biometric retry without forcing the customer to restart the flow
- clearer multi-leg failure and rollback messaging
- tighter reopen / stale-trip handling after app close

Success signal:
- fewer dead ends
- fewer avoidable retries
- clearer recovery when a booking pauses

## Sprint 2: Async Booking Execution

Goal:
No one should stare at a long blocking spinner while Ace is securing a seat.

Ship:
- DB-backed async Phase 2 execution
- immediate `jobId` return
- status screen becomes the live source of truth
- execution state machine shared across app + backend

Success signal:
- booking starts fast
- status feels calm during long provider waits
- fewer timeout-shaped failures

## Sprint 3: Global Ground Coverage Hardening

Goal:
Make the rail and bus map deliberate, not accidental.

Ship:
- normalize market routing logic across:
  - UK rail
  - India rail
  - EU rail
  - global rail
  - global coach
- expose source confidence in a single internal model
- distinguish:
  - live bookable
  - live searchable but ops-backed
  - indicative / fallback only

Priority markets:
- UK
- India
- Western Europe
- US Northeast
- Canada corridor
- Japan
- South Korea
- Thailand / Singapore / Malaysia

Success signal:
- Ace chooses the right ground provider path without the product feeling fragmented

## Sprint 4: Ground Travel Delight

Goal:
Ground travel should become the habit loop that makes Ace sticky.

Ship:
- one-tap repeat routes
- better platform / delay / gate-like disruption recovery for rail and coach
- stronger “leave now” and “change happened” nudges
- calmer receipts and re-opened trip surfaces

Success signal:
- repeat booking becomes materially faster than using legacy apps

## Sprint 5: Direct Partnership Cutover

Goal:
Replace ops and aggregator seams with direct commercial advantage.

Wave 1 outreach and cutover:
- Trainline
- National Rail / RDG
- IRCTC
- Busbud
- FlixBus

Wave 2:
- Rail Europe
- Distribusion
- G2Rail
- SilverRail
- 12Go
- redBus

Success signal:
- less manual fulfillment
- better inventory depth
- more reliable changes and confirmations

## Global Rail And Bus Coverage Map

### Rail
- UK: Darwin + Trainline
- India: IRCTC
- Europe: Trainline + Rail Europe + Distribusion
- North America: SilverRail + G2Rail
- Japan / Korea / China: G2Rail
- SE Asia: 12Go + selected direct rails where needed

### Coach / Bus
- Global baseline: Busbud
- Europe / US depth: FlixBus
- India / SE Asia / LatAm: redBus
- SE Asia multimodal: 12Go

## Founder Notes

- Do not broaden the customer promise faster than the operational truth.
- The right shape is not “support every route.”
- The right shape is “Ace feels uncannily competent on the routes people actually take.”
- Ground travel is the habit engine.
- Flights are expansion.
- Private aviation is a future wedge, not the current center.

## What We Started

This sprint has already begun with:
- dedicated concierge rate limiting in `apps/api-edge/src/middleware/rateLimit.ts`
- biometric retry improvement in `apps/meridian/app/(main)/converse.tsx`

Next build slice:
- multi-leg rollback customer messaging
- async Phase 2 queue design and cutover plan
