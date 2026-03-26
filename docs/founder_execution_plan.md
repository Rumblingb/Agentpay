# Founder Execution Plan

## North Star

Bro should become the transaction layer for real-world movement:
intent in, payment routed, fulfillment coordinated, exceptions recovered, trust retained.

## 30-Day Build Plan

### Phase 1: Payments Foundation

Goal: stop integrating payment providers route-by-route.

Build:
- A provider-neutral fiat payments layer under `apps/api-edge/src/lib/`
- Capability detection by market, currency, and payment rail
- Normalized provider status mapping
- One orchestration entrypoint for:
  - hosted UPI links
  - direct payment intents
  - status refresh

Deliverables:
- `fiatPayments.ts` abstraction
- Razorpay and Airwallex wired behind the abstraction
- Existing UPI routes refactored to call the abstraction

Success metrics:
- New providers can be added without changing route contracts
- Provider choice moves to one place

### Phase 2: Canonical Booking State Machine

Goal: one source of truth for booking lifecycle.

Build:
- Shared booking state enum
- State transition helpers
- Metadata conventions for payment, securing, issuance, failure, refund

Target states:
- `planned`
- `priced`
- `payment_pending`
- `payment_confirmed`
- `securing`
- `issued`
- `failed`
- `refunded`

Deliverables:
- Shared lib for state transitions
- Route and webhook adoption for concierge + marketplace jobs

### Phase 3: Recovery Engine

Goal: recover failed or expired journeys instead of dead-ending.

Build:
- Fare-expiry retry paths
- Provider fallback rules
- Multi-leg partial recovery suggestions
- Ops takeover queue with machine-readable failure reasons

Deliverables:
- Failure classifier
- Retry strategy registry
- Admin recovery endpoint surface

### Phase 4: Customer Memory

Goal: make Bro measurably better with every trip.

Build:
- Preference profile for class, carriers, stations, payment rail
- Route success/failure counters
- Repeat-route detection that influences plan ranking
- Known-issue suggestions sourced from logs and outcomes

Deliverables:
- Stored preference schema
- Ranking helper consumed by concierge

### Phase 5: Shared Journey Graph

Goal: upgrade trip rooms from status pages into live trip coordination.

Build:
- Journey-level object with legs, dependencies, participants, and disruptions
- Shared updates for platform, delay, gate, hotel, transfer
- “What changed / what next” summaries

Deliverables:
- Journey graph schema
- Trip-room rendering and API upgrades

### Phase 6: Founder Dashboard

Goal: steer the business with closed-loop economics.

Build:
- Conversion by stage
- Provider success rate by corridor and rail
- Margin by booking type
- Recovery-save rate
- Time-to-issue

Deliverables:
- Admin endpoints
- Dashboard views

## Immediate Build Order

1. Provider-neutral fiat payments layer
2. Canonical booking state transitions
3. Recovery primitives
4. Preference memory
5. Journey graph
6. Founder dashboard

## What Starts Now

This tranche starts with Phase 1:
- add the fiat payments abstraction
- route existing hosted UPI paths through it
- create a clean seam for Airwallex payment-intent flows next
