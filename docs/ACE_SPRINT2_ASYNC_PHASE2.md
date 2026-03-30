# Ace Sprint 2: Async Phase 2

## Delivered First Slice

The first Sprint 2 cut is now in the repo for the beta-critical rail flow:

- single-leg `book_train` and `book_train_india` confirmations now try `POST /api/concierge/confirm`
- the backend creates the durable marketplace job immediately
- train context, traveller details, and ops metadata are written onto the job up front
- the app can move straight to live status with a real `jobId`
- payment, OpenClaw dispatch, fulfilment, and recovery continue from the existing durable payment-intent path

Fallback behavior stays safe:

- unsupported plans still use the older synchronous confirm flow
- flights, hotels, and multi-leg journeys are intentionally left on the old path until the wider execution model is ready

## Goal

Make the post-biometric booking flow feel instant to start and durable under failure.

The customer experience should become:

1. Ace lines up the route.
2. Customer confirms once with Face ID / fingerprint.
3. Ace immediately moves to a live status screen.
4. Booking continues in the background until it is paid, fulfilled, confirmed, rolled back, or needs attention.

This removes the current risk where one blocking Phase 2 request is responsible for:
- hiring agents
- dispatching OpenClaw
- creating payment state
- waiting on provider latency
- returning the data the app needs to move forward

## Current Problem

Today `executeIntent()` in the app calls the same `/api/concierge/intent` endpoint with `confirmed: true`.

That request still performs the heavy work inline:
- executes hires
- creates or updates payment intent state
- prepares OpenClaw/manual fulfilment flow
- waits for slow provider work

If the Worker times out or the request drops at the wrong moment, the app can lose the thread of the booking.

At beta scale this is survivable. At real usage it will feel brittle.

## Product Standard

Ace should not hold its breath while providers respond.

The customer should see:
- `Ace has the trip`
- `Checking live options`
- `Waiting for payment`
- `Securing the booking`
- `Ticket issued`

The mobile app should enter that flow immediately after biometric confirmation, even if the backend is still doing work.

## Target Architecture

### New model

Split Phase 2 into two parts:

1. `enqueue`
2. `worker execution`

### Mobile

Replace direct `executeIntent()` blocking behavior with:

- `POST /api/concierge/confirm`
- response returns immediately with:
  - `jobId`
  - `journeyId`
  - initial `tripContext`
  - initial `status`
  - any immediate payment requirements already known

The app then routes straight to:
- `/(main)/status/[jobId]`

### Backend

`POST /api/concierge/confirm`
- validates the confirmed plan
- writes a durable execution record
- creates or reserves a `payment_intents` row up front
- stores:
  - transcript
  - plan
  - hirerId
  - full travel profile snapshot needed for booking
  - `tripContext`
  - `journeyId`
  - execution status
- returns immediately

### Worker/runner

A background processor picks up queued execution rows and performs the real work:
- hire agent(s)
- create marketplace jobs
- thread metadata into `payment_intents`
- dispatch OpenClaw if eligible
- move state through:
  - `queued`
  - `hiring`
  - `payment_pending`
  - `fulfilment_pending`
  - `confirmed`
  - `failed`
  - `rolled_back`

## Recommended Storage Shape

Add a durable execution table instead of relying only on inline request state.

Suggested table: `concierge_executions`

Core columns:
- `id`
- `job_id`
- `journey_id`
- `hirer_id`
- `status`
- `transcript`
- `plan_json`
- `travel_profile_json`
- `trip_context_json`
- `payment_intent_id`
- `failure_reason`
- `retry_count`
- `created_at`
- `started_at`
- `updated_at`
- `completed_at`

Why a separate table:
- cleaner retry semantics
- easier founder dashboard
- decouples mobile UX from marketplace/payment row shape
- easier to evolve than packing everything into `payment_intents.metadata`

## State Model

### Execution states

Use one shared state model across backend + status screen + receipt sync:

- `queued`
- `hiring`
- `payment_pending`
- `fulfilment_pending`
- `confirmed`
- `failed`
- `rolled_back`
- `attention_required`

### Mapping to mobile language

- `queued` -> `Trip received`
- `hiring` -> `Checking live options`
- `payment_pending` -> `Waiting for payment`
- `fulfilment_pending` -> `Securing the booking`
- `confirmed` -> `Ticket issued`
- `failed` / `rolled_back` / `attention_required` -> `Needs attention`

This should become the only truth used by:
- status screen
- receipt screen
- saved active trip state
- trips history pills
- founder queue view

## Payment Flow

The queue design should preserve the current payment reality:

### Before payment is required

If the job can establish booking readiness before money moves:
- execution creates the pending job
- marks execution `payment_pending`
- status screen shows payment CTA

### After payment completes

Existing Stripe / UPI webhook handling should:
- update `payment_intents`
- update `concierge_executions.status`
- continue or release fulfilment flow
- keep `tripContext.watchState` aligned

This means payment is no longer “part of one big request”; it becomes a clean state transition.

## OpenClaw Integration

OpenClaw already has useful queue-like surfaces:
- pending job polling
- complete/fail callbacks
- founder retry queue

Sprint 2 should not replace that.

It should formalize it:
- `concierge_executions` owns the lifecycle
- `payment_intents` remains the commercial/payment record
- OpenClaw stays one fulfilment executor

### Rule

OpenClaw should consume durable jobs, not temporary request context.

## Retry and Recovery

Async Phase 2 should make retries first-class.

### Retryable

- transient provider failure
- marketplace hire failure
- timeout during dispatch
- OpenClaw failure before confirmation

### Non-retryable

- invalid profile details
- expired fare requiring re-plan
- customer payment failure after repeated attempts

### Recovery behavior

If retryable:
- keep status as `Ace is on it`
- backoff and retry
- log to founder queue

If not retryable:
- set `attention_required`
- give the customer a crisp next action
- preserve the trip context

## Mobile Changes

### `converse.tsx`

Replace:
- blocking `executeIntent()`

With:
- `confirmIntent()`
- immediate route to status using returned `jobId`

### `status/[jobId].tsx`

Make status screen the source of truth from the first second:
- poll execution state, not just final marketplace/payment state
- support these states cleanly:
  - queued
  - hiring
  - payment pending
  - fulfilment pending
  - confirmed
  - failed
  - rolled back

### `receipt/[intentId].tsx`

Receipt should assume async origin:
- if execution is still pending, route customer back to live status
- if completed, show final proof
- if rolled back, explain what Ace protected them from

## API Surface

### Keep

- `POST /api/concierge/intent` for Phase 1 planning

### Add

- `POST /api/concierge/confirm`
  - creates execution record
  - returns immediately

- `GET /api/concierge/executions/:jobId`
  - returns normalized execution state for status screen

- `POST /api/concierge/executions/:jobId/retry`
  - internal/founder use

### Optional

- `POST /api/concierge/executions/:jobId/attention`
  - used by support tooling

## Suggested Execution Engine

Short term:
- DB row queue + cron/worker sweep

Why:
- already compatible with current stack
- easiest to ship
- works with current founder queue model
- enough for beta and early GTM

Later:
- Durable Object queue or managed queue

Do not block Sprint 2 on “perfect infra.”

## Rollout Plan

### Step 1

Add execution table and state model.

### Step 2

Create `POST /api/concierge/confirm` that persists and returns immediately.

### Step 3

Create worker/cron runner that processes `queued` executions.

### Step 4

Switch mobile `executeIntent()` path to `confirmIntent()`.

### Step 5

Update status screen polling to read execution state first.

### Step 6

Thread webhook/OpenClaw updates into execution-state transitions.

### Step 7

Expose queue health in founder insights.

## Definition of Done

Sprint 2 is done when:

- biometric confirm never waits on long provider work
- customer lands on status immediately after confirming
- booking continues if the original HTTP request dies
- retries are durable
- OpenClaw dispatch survives Worker restarts
- status, receipt, and saved trip state agree on execution state

## Founder / CTO Read

This is the biggest structural step left before Ace starts to feel truly inevitable.

Once Phase 2 becomes async:
- Ace will feel calmer
- the app will feel faster
- provider latency becomes manageable
- recovery becomes real
- GTM gets much safer

This is the unlock that turns “good beta product” into “product that can hold real load.”
