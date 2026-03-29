# Ace API And Partnership Targets

Ace should not chase every travel API at once. The right order is:

1. Make rail and bus feel magical
2. Remove manual booking seams
3. Deepen flights and payments
4. Expand into hotels, restaurants, and premium categories

This list is based on the current codebase and what Ace already supports or partially supports today.

## P0: Core To Make Ace Unstoppable

### 1. Trainline Partner API
- Why it matters: strongest single commercial rail partner for UK + Europe; directly aligned with Ace's current core.
- Current repo state: referenced as the ops/booking path for UK and EU rail, but not wired as a true direct booking integration yet.
- Code signals:
  - `apps/api-edge/src/types.ts`
  - `apps/api-edge/src/lib/euRail.ts`
  - `apps/api-edge/src/routes/concierge.ts`
- Priority: highest
- Outreach goal: direct booking, fare/seating access, live fare confirmation, partner commercial terms.

### 2. National Rail / Darwin / Rail Delivery Group
- Why it matters: UK rail is the daily-habit wedge. Live boards already exist; deeper partner access improves reliability and future booking relationships.
- Current repo state: live data already integrated.
- Code signals:
  - `apps/api-edge/src/lib/rtt.ts`
  - `apps/api-edge/src/types.ts`
- Priority: highest
- Outreach goal: stronger official access, higher confidence live operations data, platform/disruption reliability, future booking pathway conversations.

### 3. IRCTC / Official India Rail Access
- Why it matters: India rail is a real differentiator, but RapidAPI + user credentials + ops is not the final form.
- Current repo state: search/schedule flow exists; direct provider booking is not integrated.
- Code signals:
  - `apps/api-edge/src/lib/indianRail.ts`
  - `apps/api-edge/src/routes/concierge.ts`
  - `apps/meridian/app/onboard.tsx`
- Priority: highest
- Outreach goal: official booking and status access, reduced fragility, cleaner tatkal and confirmation flow.

### 4. Busbud
- Why it matters: best immediate way to make Ace strong across global intercity buses without building carrier by carrier.
- Current repo state: live integration path already exists.
- Code signals:
  - `apps/api-edge/src/lib/busbud.ts`
  - `apps/api-edge/src/types.ts`
- Priority: highest
- Outreach goal: production API access, commercial terms, better inventory depth, booking rights.

### 5. FlixBus
- Why it matters: key coach operator for Europe and meaningful in the US; good direct depth even if Busbud is the aggregator.
- Current repo state: supported as a direct secondary path when key is set.
- Code signals:
  - `apps/api-edge/src/lib/busbud.ts`
  - `apps/api-edge/src/types.ts`
- Priority: high
- Outreach goal: direct partnership, inventory depth, seat/product data, better coach reliability.

### 6. Stripe
- Why it matters: fiat-first trust layer for Ace users.
- Current repo state: already integrated and important.
- Code signals:
  - `apps/api-edge/src/types.ts`
  - `apps/api-edge/src/routes/marketplace.ts`
- Priority: highest
- Outreach goal: deepen travel/marketplace relationship, understand compliance and growth support, move beyond basic hosted checkout over time.

### 7. Razorpay
- Why it matters: India payment flow is strategic if Ace wants to really win India rail.
- Current repo state: integrated.
- Code signals:
  - `apps/api-edge/src/lib/razorpay.ts`
  - `apps/api-edge/src/routes/paymentsUpi.ts`
- Priority: high
- Outreach goal: production support, reliability, webhooks, UPI optimization, travel use-case relationship.

### 8. Airwallex
- Why it matters: strong cross-border payment rail and useful for future international consumer + merchant flows.
- Current repo state: integrated.
- Code signals:
  - `apps/api-edge/src/lib/airwallex.ts`
  - `apps/api-edge/src/routes/webhooksAirwallex.ts`
  - `apps/api-edge/src/lib/fiatPayments.ts`
- Priority: high
- Outreach goal: travel-friendly payment stack, multi-currency roadmap, global expansion support.

## P1: Important Next

### 9. Rail Europe
- Why it matters: strong EU rail aggregation and commercial booking path.
- Current repo state: live integration path exists, but ops/manual language is still present in the product.
- Code signals:
  - `apps/api-edge/src/lib/euRail.ts`
  - `apps/api-edge/src/types.ts`
- Priority: high
- Outreach goal: direct fares and booking confirmation across EU rail operators.

### 10. Distribusion
- Why it matters: useful multimodal and rail distribution layer, especially for broader Europe.
- Current repo state: env target exists but no meaningful implementation yet.
- Code signals:
  - `apps/api-edge/src/types.ts`
- Priority: medium-high
- Outreach goal: broader carrier access, OSDM-compatible rail/ground distribution.

### 11. G2Rail
- Why it matters: best way to cover Asia and North America rail without bespoke integrations.
- Current repo state: planned via env bindings, not yet wired into the main flow.
- Code signals:
  - `apps/api-edge/src/types.ts`
- Priority: medium-high
- Outreach goal: Japan, Korea, China, Amtrak/VIA, and cross-region rail scale.

### 12. SilverRail
- Why it matters: North America rail distribution, especially if Ace expands beyond UK/India/Europe.
- Current repo state: planned in env layer, not yet central to flow.
- Code signals:
  - `apps/api-edge/src/types.ts`
- Priority: medium
- Outreach goal: Amtrak and VIA distribution at production quality.

### 13. 12Go
- Why it matters: important if Ace expands into SE Asia where multimodal ground travel matters.
- Current repo state: planned in env layer, not yet integrated.
- Code signals:
  - `apps/api-edge/src/types.ts`
- Priority: medium
- Outreach goal: buses, trains, ferries, vans in SE Asia.

### 14. Google Maps Platform
- Why it matters: routes, places, geocoding, final-leg guidance.
- Current repo state: already integrated and foundational.
- Code signals:
  - `apps/api-edge/src/lib/googlePlaces.ts`
  - `apps/api-edge/src/lib/googleRoutes.ts`
  - `apps/api-edge/src/types.ts`
- Priority: keep warm
- Outreach goal: reliability, quota, pricing, support.

### 15. TfL
- Why it matters: London last-mile quality is part of the premium experience.
- Current repo state: already integrated.
- Code signals:
  - `apps/api-edge/src/lib/tfl.ts`
  - `apps/api-edge/src/routes/concierge.ts`
- Priority: medium
- Outreach goal: higher rate limits, better support, official relationship if scale requires it.

## P2: Flights, Hotels, And Adjacencies

### 16. Duffel
- Why it matters: flights are already much further along than most other expansion areas.
- Current repo state: well integrated for search and booking.
- Code signals:
  - `apps/api-edge/src/lib/duffel.ts`
  - `apps/api-edge/src/routes/concierge.ts`
  - `apps/api-edge/src/cron/flightWatch.ts`
- Priority: maintain and deepen
- Outreach goal: production support, better commercial terms, richer ancillary/seat/baggage capabilities.

### 17. Hotelbeds / Expedia / Booking.com partner channels
- Why it matters: Xotelo is good for discovery and indicative pricing, but not the final answer for true hotel checkout.
- Current repo state: hotels are powered by Xotelo pricing plus ops/manual fulfillment seams.
- Code signals:
  - `apps/api-edge/src/lib/xotelo.ts`
- Priority: high after rail/bus are stronger
- Outreach goal: direct hotel booking and confirmation APIs, less ops/manual handling, better cancellation and policy coverage.

### 18. OpenTable
- Why it matters: restaurant reservations fit Ace's delegated action model well.
- Current repo state: explicitly stubbed until partnership lands.
- Code signals:
  - `apps/api-edge/src/lib/openTable.ts`
  - `apps/api-edge/src/types.ts`
- Priority: medium
- Outreach goal: reservation availability and booking access.

### 19. Ticketmaster
- Why it matters: useful adjacency for destination experiences, but not core mobility.
- Current repo state: integrated for discovery.
- Code signals:
  - `apps/api-edge/src/lib/ticketmaster.ts`
  - `apps/api-edge/src/types.ts`
- Priority: medium-low
- Outreach goal: scale discovery and future conversion paths.

### 20. GetYourGuide
- Why it matters: experiences can become part of a broader delegated trip brief.
- Current repo state: env target exists; no real product flow yet.
- Code signals:
  - `apps/api-edge/src/types.ts`
- Priority: low for now
- Outreach goal: future expansion into experiences.

## P3: Future Premium Wedge

### 21. Private Aviation / Charter Partners
- Why it matters: huge fit for Ace's voice-first, high-trust, high-context model.
- Current repo state: no current integration.
- Priority: future wedge, not now
- Outreach goal: request-and-orchestrate model first, not instant marketplace dumping.

## Recommended Outreach Order

1. Trainline
2. National Rail / Darwin / RDG
3. IRCTC / India rail official channels
4. Busbud
5. FlixBus
6. Stripe
7. Razorpay
8. Airwallex
9. Rail Europe
10. Duffel
11. Hotelbeds / Expedia / Booking.com partner channels
12. OpenTable
13. G2Rail / SilverRail / 12Go

## What To Say In Every Outreach

Keep the message simple:

- Ace is building a voice-first travel operating layer, not just another booking UI.
- The customer says the outcome once and Ace handles the rest.
- Trains and buses are the current priority.
- Flights and premium expansion are next.
- We want direct API access or partnership terms that let Ace book, confirm, monitor, and recover seamlessly.
- We care deeply about reliability, change notifications, cancellations, rebooking, and support loops.

## Practical Founder Note

Do not email everyone at once.

Run this in waves:

1. Rail and bus first
2. Payments and settlement allies
3. Hotel and restaurant expansion
4. Premium future categories

That keeps the company focused on the real wedge: everyday delegated movement.
