# Ace Duffel Flight Plan

## Goal

Turn Ace from a rail-first concierge into a true travel product by adding a real
`book_flight` path that fits the existing two-phase flow:

1. Phase 1: search and select the strongest offer
2. Phase 2: create the Duffel order after biometric approval

## What Already Exists

- Meridian client already understands `flightDetails` in `ConciergePlanItem`
  - `apps/meridian/lib/api.ts`
- Confirm screen already renders flight expiry and flight-specific recommendation cues
  - `apps/meridian/app/(main)/converse.tsx`
- Receipt and trips already support flight mode and flight detail rendering
  - `apps/meridian/app/(main)/receipt/[intentId].tsx`
  - `apps/meridian/app/(main)/trips.tsx`
- Profile model already carries the fields flights need
  - `apps/meridian/lib/profile.ts`

## Backend Gap

The `/api/concierge/*` brain used by Meridian is not implemented in this repo.
That means Duffel integration belongs in the external/server-side concierge layer,
not the Expo client.

## Required Server-Side Work

### 1. Add `DUFFEL_API_KEY` to the concierge environment

- Use the same secret in the concierge backend that serves `/api/concierge/intent`
  and `/api/concierge/confirm`
- Send `Authorization: Bearer <DUFFEL_API_KEY>`
- Send `Duffel-Version: v2`

### 2. Add a `book_flight` tool to the concierge tool registry

Expected responsibilities:

- parse trip request:
  - origin
  - destination
  - departure date
  - optional return date
  - passengers
  - cabin preference
- create a Duffel offer request
- select the best offer
- return one `ConciergePlanItem` with:
  - `toolName: "book_flight"`
  - `displayName`
  - `estimatedPriceUsdc`
  - `flightDetails`

### 3. Map Duffel offer data into Ace `flightDetails`

Minimum fields Ace already expects:

- `origin`
- `destination`
- `departureAt`
- `arrivalAt`
- `carrier`
- `flightNumber`
- `totalAmount`
- `currency`
- `stops`
- `durationMinutes`
- `cabinClass`
- `offerId`
- `offerExpiresAt`
- `isReturn`
- `pnr` after booking

### 4. Use Duffel order creation in Phase 2

After biometric approval:

- take the selected `offerId`
- create the Duffel order
- persist:
  - Duffel order ID
  - PNR
  - passengers used
  - status metadata for journey/session continuity

### 5. Persist flight booking proof into `tripContext`

That keeps Journey, Receipt, Trips, and proactive notifications on the same spine.

Recommended metadata to carry:

- `mode: "flight"`
- `bookingState`
- `orderId`
- `pnr`
- `checkInAt` if available
- `gate` if available later
- `watchState` parity with the existing journey model

## Duffel Flow To Implement

Use the official Duffel flow:

1. create offer request
2. select offer
3. create order from the selected offer

Reference:
- https://duffel.com/docs/guides/collecting-customer-card-payments
- https://duffel.com/docs/api/overview/making-requests/request-id

## Client-Side Work Already Done In This Repo

- `book_flight` profile scoping is now allowed in:
  - `apps/meridian/lib/profile.ts`
- `DUFFEL_API_KEY` is now part of backend env config in:
  - `src/config/env.ts`
- `flightDetails` comment now reflects search + booking intent in:
  - `apps/meridian/lib/api.ts`

## Recommended Shipping Order

1. Server: `search_flights` offer request
2. Server: `book_flight` order creation from selected offer
3. Server: persist PNR + Duffel order metadata into journey context
4. Client: on-device test of confirm -> receipt -> trips -> journey continuity
5. Later:
   - seats
   - bags
   - changes
   - refunds

## Success Bar

Ace should be able to handle:

- "Fly me to Barcelona Friday morning"
- show a premium confirm surface with:
  - route
  - time
  - fare
  - expiry
- after biometric approval:
  - create the Duffel order
  - return a receipt with flight details + PNR
  - show the trip in Journey/Trips without any new screen model
