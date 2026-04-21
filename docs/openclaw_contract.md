# OpenClaw HTTP contract

This document summarizes the HTTP contract between AgentPay (Ace) and OpenClaw, extracted from the codebase implementations.

## Endpoints

- OpenClaw inbound endpoint (AgentPay -> OpenClaw)
  - POST `${OPENCLAW_API_URL}/fulfill`
  - Auth: `Authorization: Bearer <OPENCLAW_API_KEY>`
  - Required header: `X-AgentPay-Job-Id: <jobId>`

- OpenClaw polling (OpenClaw -> AgentPay)
  - GET `/api/admin/bro-jobs/pending` — returns pending jobs for fulfilment. See [apps/api-edge/src/routes/concierge.ts](apps/api-edge/src/routes/concierge.ts)

- OpenClaw completion callback (OpenClaw -> AgentPay)
  - PATCH `/api/admin/bro-jobs/:jobId/complete`
  - Auth: `Authorization: Bearer <OPENCLAW_API_KEY>`
  - Body (success): `{ success: true, ticketRef?: string, pnr?: string, seatInfo?: string, notes?: string }`
  - Body (failure): `{ success: false, failureReason?: string }`
  - Server behaviour: marks job `completed` or `fulfilment_failed` and patches `payment_intents.metadata`. See [apps/api-edge/src/routes/concierge.ts](apps/api-edge/src/routes/concierge.ts)

## Request payload (POST /fulfill)

AgentPay sends a payload matching the `OpenClawPayload` shape. Example schema:

```json
{
  "jobId": "job_123",
  "route": "London → Manchester",
  "fromStation": "London",
  "toStation": "Manchester",
  "departureDate": "2026-04-01",
  "departureTime": "08:30",
  "operator": "Avanti",
  "trainClass": "first",
  "passengers": [
    { "legalName": "Ada Lovelace", "email": "ada@example.com", "phone": "+447700900000" }
  ],
  "fareGbp": 87,
  "fareInr": null,
  "nationality": "uk",
  "rawMetadata": { /* full AgentPay job metadata */ }
}
```

Notes:
- `jobId` is the AgentPay payment_intents.id value.
- `rawMetadata` contains the full job metadata; OpenClaw may inspect additional fields.
- AgentPay sets `X-AgentPay-Job-Id` header to the same `jobId` for traceability.

## Expected responses

- Success (typical): 200 OK with body containing an identifier. Example:

```json
{ "jobId": "claw_123" }
```

- Error: non-2xx status with JSON describing error. AgentPay will log and mark dispatch as failed.

## Server-side validation (AgentPay)

Before dispatching, AgentPay runs `validatePayload` and `shouldDispatchToOpenClaw`:

- Required fields: `fromStation`, `toStation`, `departureDate`.
- Passenger identity: at least one of `legalName` or `email` for the first passenger.
- Market exclusions: `eu` and `global` markets are explicitly rejected by AgentPay today.
- Transport exclusions: `bus` jobs and pure-flight jobs are rejected.

See implementation in [apps/api-edge/src/lib/openclaw.ts](apps/api-edge/src/lib/openclaw.ts)

## Polling and callback contract

- OpenClaw is expected to poll `/api/admin/bro-jobs/pending` (auth: `OPENCLAW_API_KEY`) to fetch jobs where `pendingFulfilment` is true and payment is confirmed.
- After fulfilment OpenClaw calls PATCH `/api/admin/bro-jobs/:jobId/complete` with `success: true` and optional `ticketRef`/`pnr`/`seatInfo`.
- On failure OpenClaw must call the same endpoint with `success: false` and a `failureReason`.

See the polling and patch implementation in [apps/api-edge/src/routes/concierge.ts](apps/api-edge/src/routes/concierge.ts)

## Quick debugging steps

1. Confirm `OPENCLAW_API_URL` and `OPENCLAW_API_KEY` are configured in the environment.
2. If a dispatch fails, inspect AgentPay logs for `openclaw_dispatching`, `openclaw_error`, or `openclaw_fetch_error` events (CF Tail / console logs).
3. For missing fields, run unit tests in `tests/unit/openclaw.test.ts` which include payload examples.

## References

- Payload builder and validations: [apps/api-edge/src/lib/openclaw.ts](apps/api-edge/src/lib/openclaw.ts)
- OpenClaw-friendly job query and complete callback: [apps/api-edge/src/routes/concierge.ts](apps/api-edge/src/routes/concierge.ts)
- Crew tools that can call OpenClaw: [apps/crew/src/tools.py](apps/crew/src/tools.py)
- Unit tests: [tests/unit/openclaw.test.ts](tests/unit/openclaw.test.ts)
