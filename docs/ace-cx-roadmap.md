# Ace Customer Experience Roadmap

## Vision

Ace is voice-first concierge software for real-world movement.
The customer should say what they want once, then Ace should calmly handle the trip.

## P0

- Finish `Bro` -> `Ace` across all customer-visible strings.
- Keep voice as the primary interaction pattern on home, recovery, and active-trip flows.
- Make trip state obvious at a glance: requested, paying, ticketing, booked, delayed, needs attention.
- Make disruption surfaces actionable, not just informational.
- Keep support reachable from live-trip screens.

## P1

- Add `Book again` and `Repeat route` from trips and receipts.
- Add a booking-readiness checklist before confirmation and payment.
- Add stronger recovery actions: rebook, switch mode, get me home, share trip.
- Add clearer payment reassurance: charged, pending, refunded, what happens next.

## P2

- Add richer travel preferences: cheapest, fastest, calmest, fewest changes, accessibility.
- Add stronger family defaults for one-shot group voice booking.
- Add post-trip habit loops: recent routes, commute shortcuts, upcoming trip reminders.

## API / End-to-End

- Audit plan -> execute -> status -> receipt payload consistency.
- Standardize delay, platform, and gate disruption payloads across app and API.
- Add explicit support and issue categories from receipt/status back into the API.
- Ensure ticketing and payment states are recoverable after app restart with no ambiguity.
