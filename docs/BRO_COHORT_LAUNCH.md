# Bro Cohort Launch

> Status: Operator runbook for a 5-10 person closed Bro cohort
> Scope: Train-first only, UK + India only

## Product Truth

Bro for this cohort is:
- voice-first
- trains only
- UK and India only
- one best recommendation
- one confirmation moment
- one live journey companion

Bro is not yet:
- a general travel app
- a generic outdoor explorer
- a flight / hotel / taxi product
- a broad public launch

## Cohort Goal

The cohort exists to answer five questions:

1. Can a new user complete their first train request without help?
2. Does Bro feel trustworthy when money, booking, and continuity matter?
3. Do UK and India users feel the product is native to their market?
4. Does Bro recover cleanly when the network, receipt fetch, or booking flow degrades?
5. After a first successful journey, do testers want to use Bro again?

## Go / No-Go Standard

Go only if all of the following are true:
- Workers critical tests pass
- Workers typecheck passes
- Bro mobile typecheck passes
- Expo doctor passes
- iOS and Android export sanity checks pass
- Dashboard build passes
- UK and India happy-path booking flows are manually exercised
- Stripe hosted checkout confirms the Bro job and re-opens the app correctly
- India UPI confirms the Bro job through the Razorpay webhook, not a blind deep link
- Journey reopen works for `securing`, `attention`, and `ticketed`
- Receipt fallback renders local journey details when receipt fetch fails
- There is a human support path for cohort testers

No-go if any of the following are true:
- Known money-path correctness issue remains
- Bro says a booking is confirmed before it actually is
- A tester can get trapped in a dead-end screen during booking continuity
- UK and India visible flows are still mixed
- The support channel for testers is undefined

## Pre-Launch Commands

Run these before admitting testers:

```bash
npm run test:workers-critical
npm run typecheck --workspace @agentpay/api-edge
cd apps/meridian && npx tsc --noEmit
cd apps/meridian && npx expo-doctor
cd apps/meridian && npx expo export --platform ios --output-dir dist-export-ios
cd apps/meridian && npx expo export --platform android --output-dir dist-export-android
cd dashboard && npm run build
```

Clean the temporary export folders after validation.

## Manual Test Script

Each tester session should cover one of these flows.

### Flow 1: UK Happy Path

1. Fresh install or reset
2. Choose `UK`
3. Complete minimal setup
4. Ask for a UK train journey by voice
5. Review Bro's recommendation
6. Confirm booking
7. Let the booking proceed to status
8. Open receipt
9. Close app and reopen
10. Confirm latest journey card still opens the correct place

Expected:
- UK-only examples and fields
- railcard logic only when relevant
- calm recommendation copy
- no internal platform or agent language exposed

### Flow 2: India Happy Path

1. Fresh install or reset
2. Choose `India`
3. Complete minimal setup
4. Ask for an India rail journey by voice
5. Review Bro's recommendation
6. Confirm booking
7. Use the India payment path if offered
8. Open receipt
9. Close app and reopen
10. Confirm latest journey card still opens the correct place

Expected:
- no railcard UI
- India-native examples and class-tier framing
- UPI / IRCTC logic only where relevant
- no UK leakage

### Flow 3: Continuity During Securing

1. Begin a booking
2. Reach the status screen
3. Kill the app
4. Reopen the app

Expected:
- home shows the in-progress journey
- tapping it reopens the status screen

### Flow 4: Continuity During Attention

1. Force or simulate a booking problem / timeout
2. Reach `Needs attention`
3. Kill the app
4. Reopen the app

Expected:
- home shows the attention state
- tapping it reopens status, not receipt

### Flow 5: Receipt Fallback

1. Complete a booking until a local journey exists
2. Open receipt
3. Simulate a receipt fetch failure / poor network

Expected:
- receipt still shows locally saved journey details
- fallback notice is visible
- no dead-end blank state

### Flow 6: Voice Degradation

1. Deny microphone permission
2. Retry a request
3. Re-enable microphone
4. Test again on weak network

Expected:
- Bro gives a calm, actionable recovery message
- no internal config jargon

## Tester Brief

Tell testers:
- Bro is train-first for this cohort
- UK and India only
- use it as if it were your real train companion
- report moments where trust drops, not just bugs

Ask them to note:
- first request they tried
- whether Bro understood them
- whether the recommendation felt trustworthy
- whether they would use it again
- exactly where they felt uncertain

## Feedback Format

Collect each session in this shape:

- Tester:
- Market: UK / India
- Device:
- First request:
- Completed first journey: yes / no
- Trust rating (1-5):
- Voice accuracy rating (1-5):
- Best moment:
- Worst moment:
- Would use again: yes / no
- Blocking issue:

## Daily Cohort Review

At the end of each day, review:
- first-booking success rate
- reopen success rate
- receipt fallback success rate
- top 3 confusion moments
- top 3 bugs
- trust-breaking language or states

Fix in this order:
1. anything that can lose or confuse a booking
2. continuity and recovery failures
3. voice misunderstanding that blocks completion
4. market-native polish issues
5. visual refinement

## Google Maps: Right Next Step

Do not add Google Maps as a new visible product surface before the cohort.

The correct next use of maps is:
- final-leg continuation from the active journey
- "walk me there"
- station exit to destination guidance
- leave-now timing from the trip object

The wrong next use is:
- generic explore mode
- a maps-first home screen
- broad outdoor discovery before the train loop is trusted

Rule:
- trains remain the wedge
- maps extend the journey
- users still feel one product: Bro gets me there

## Recommendation

Launch this as a 5-10 person closed cohort only.

Do not widen it until:
- booking trust is high
- continuity is boringly reliable
- UK and India both feel native
- the trip companion proves genuinely useful after booking
