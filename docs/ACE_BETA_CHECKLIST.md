# Ace Beta Checklist

Status: founder beta runbook  
Last updated: 2026-03-30

## Beta Truth

Ace in beta is:
- voice-first
- rail and coach first
- founder-led and support-aware
- strongest in selected corridors, not everywhere
- designed to accept the customer request once and handle the rest

Ace in beta is not:
- a broad GTM launch
- full direct inventory in every market
- “all travel, all countries, all cases”
- ready to promise instant booking everywhere

## Beta Goal

The beta exists to answer seven questions:

1. Can someone ask for a journey naturally and get through booking without confusion?
2. Does Ace feel faster than the old way?
3. Does the customer trust Ace at the money and confirmation moments?
4. Does Ace stay calm when bookings take time?
5. Does recovery feel handled when payment, booking, or connectivity goes wrong?
6. Does reopening the app preserve continuity?
7. Would the user actually use Ace again for the next journey?

## Beta Shape

Recommended beta format:
- 5-15 users
- founder-managed
- corridor-constrained
- UK rail first
- India rail second
- selected coach routes where the flow already feels strong

Avoid in beta:
- broad flight expectations
- hotel-heavy usage
- unsupported geography without an explicit ops plan

## Go / No-Go Standard

Go only if all are true:
- Meridian typecheck passes
- API-edge typecheck passes
- Expo doctor passes
- latest iOS beta build installs and opens cleanly
- voice request → plan → confirm → status → receipt works on-device
- reopen after force-close works for:
  - booking underway
  - payment pending
  - needs attention
  - ticketed
- payment recovery works
- partial booking failure does not leave the user confused or half-booked
- there is a real support path for testers

No-go if any are true:
- Ace implies something is confirmed when it is not
- a tester can get stuck without a next step
- force-close / reopen breaks booking continuity
- payment cannot be resumed cleanly
- beta coverage is being marketed more broadly than operations can support

## Pre-Beta Checks

Run before inviting testers:

```bash
npx tsc -p apps/meridian/tsconfig.json --noEmit
npx tsc -p apps/api-edge/tsconfig.json --noEmit
cd apps/meridian
npx expo-doctor
```

Manual checks before the first tester:
- latest iOS build installs on the target device
- environment variables are present for the chosen beta profile
- notifications arrive for at least one live-trip test
- payment return path reopens Ace correctly
- OpenClaw / ops escalation path is monitored

## Beta Test Flows

### Flow 1: First Booking

1. Fresh install or reset
2. Complete onboarding
3. Ask for a real journey by voice
4. Review Ace’s recommendation
5. Confirm the booking
6. Reach status
7. Reach receipt or payment recovery state

Expected:
- no dead-end
- no internal jargon
- no “who is the agent” leakage
- one clear next step at every moment

### Flow 2: Payment Recovery

1. Start a booking that needs payment
2. Interrupt or back out of payment
3. Return to Ace
4. Re-open payment
5. Confirm that status/receipt updates cleanly

Expected:
- user understands that the booking is lined up but not fully secured
- `Open payment again` and `I already paid` are clear
- no duplicate uncertainty

### Flow 3: Force-Close Continuity

1. Start a booking
2. Kill the app during:
   - securing
   - payment pending
   - needs attention
3. Reopen Ace

Expected:
- active journey card appears
- tap returns to the correct live surface
- stale states recover gracefully

### Flow 4: Voice Degradation

1. Test weak network or voice timeout
2. Deny or interrupt microphone use
3. Retry with text fallback

Expected:
- Ace gives a graceful typed handoff
- the screen does not become a giant chat log
- the user still feels in one booking flow

### Flow 5: Multi-Leg Protection

1. Test a multi-leg journey
2. Force one leg to fail
3. Observe the result in booking flow, status, receipt, and trip history

Expected:
- Ace explains that it stopped the journey safely
- user does not feel half-booked
- the next action is clear

### Flow 6: Reuse And Habit

1. Complete a journey
2. Return later
3. Open trip history
4. Reopen the receipt
5. Attempt a repeat-style request

Expected:
- prior trip context feels useful
- Ace feels like a memory layer, not a one-off tool

## Tester Mix

Ideal beta mix:
- daily UK rail user
- India rail + UPI user
- coach / budget traveller
- one premium user who cares about calmness and trust
- one less technical user who will expose confusion quickly

Avoid a beta group that is:
- all builders
- all highly forgiving
- all in unsupported markets

## What To Watch Closely

### Trust
- hesitation before confirmation
- hesitation before payment
- confusion about whether something is confirmed
- discomfort with stored data / biometrics

### Seamlessness
- how many back-and-forth turns before booking
- whether voice feels easier than forms
- whether the user feels they are still “managing” the trip

### Recovery
- reopen reliability
- payment recovery success
- partial failure clarity
- support escalation clarity

## Metrics To Track In Beta

- first-booking success rate
- booking completion time
- payment recovery success rate
- reopen success rate after force-close
- percent of sessions needing text fallback
- repeat usage within 7 days
- trust rating after first completed journey
- “would use again” rate

## Feedback Template

Capture each tester session like this:

- Tester:
- Market:
- Device:
- Request:
- Completed booking: yes / no
- Needed payment recovery: yes / no
- Needed text fallback: yes / no
- Reopen worked: yes / no
- Trust rating (1-5):
- Seamlessness rating (1-5):
- Best moment:
- Worst moment:
- Would use again: yes / no
- Blocking issue:

## Daily Founder Review

At the end of each beta day, review:
- top 3 trust breaks
- top 3 product confusions
- top 3 operational failures
- repeat intent from testers
- anything that made Ace feel like a normal travel app instead of a new interface

Fix in this order:
1. booking truth
2. continuity and recovery
3. payment reliability
4. voice usability
5. polish and refinement

## Exit Criteria For GTM Prep

Move from beta toward GTM only when:
- first booking is consistently successful
- reopen / continuity is boringly reliable
- payment recovery works without founder intervention
- users describe Ace as easier, not just interesting
- selected rail and coach corridors feel truly dependable

## Founder Note

Do not use beta to prove that Ace can do everything.

Use beta to prove:
- Ace can remove effort
- Ace can hold trust
- Ace can recover cleanly
- Ace can become a habit
