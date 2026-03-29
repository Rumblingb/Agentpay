# Ace Execution Todo

Last updated: 2026-03-29

## Now

- [x] Build a concrete execution list from the latest Ace audit.
- [x] Replace raw operator transparency with a tighter Ace assurance layer.
- [x] Tighten concierge rate limiting so the core voice surface has a dedicated guardrail.
- [x] Keep biometric confirmation failures inside the booking moment instead of forcing a restart.
- [x] Surface partial multi-leg rollback as a visible customer state, not just backend narration.
- [x] Tighten payment recovery so retry, reopen, and escalation are explicit instead of generic.

## Next

- [ ] Add richer multi-leg rollback language on status and receipt:
  explain when Ace cancelled earlier legs to avoid leaving the customer half-booked.
- [ ] Add a richer multi-leg breakdown on receipt and live status when more than one leg is involved.
- [ ] Add flight booking completion details:
  PNR, seat selection state, baggage state, and what still needs the customer.
- [ ] Add hotel confirmation UX beyond the current parsed card:
  partner checkout status, saved stay summary, and reopening path.
- [x] Add a voice-safe STT fallback:
  if speech times out, offer a text handoff instead of a dead end.
- [x] Replace hardcoded FX assumptions with server-backed currency rates.

## Platform

- [x] Add structured client-side error telemetry from Meridian to the API.
- [ ] Remove silent fire-and-forget failures where they hide customer-impacting issues.
- [ ] Reduce loose `any` parsing in trip, receipt, and metadata flows.
- [ ] Move long-running Phase 2 booking execution off the request-response path.
- [ ] Add a minimal `apps/meridian` README covering env vars, build profiles, and launch assumptions.

## Product Standard

- [ ] Every paid or trust-sensitive step should answer:
  what Ace is doing, what is confirmed, what still needs the customer.
- [ ] Every long-running booking state should have:
  progress, recovery, support, and graceful re-entry after app reopen.
- [ ] Every partial product area should still feel premium, not hidden.

## Ground Travel Sprints

- [x] Sprint 1 start:
  concierge rate limiting, biometric retry, and rollback visibility.
- [ ] Sprint 1 finish:
  clearer multi-leg rollback language, stale-trip reopen confidence, and customer-safe failure handling.
- [ ] Sprint 2:
  async Phase 2 booking queue with immediate `jobId` handoff.
- [ ] Sprint 3:
  global rail/bus provider normalization and source-confidence model.
- [ ] Sprint 4:
  repeat-route delight and stronger disruption recovery for ground travel.
- [ ] Sprint 5:
  direct rail/bus partnership cutover by market.

## What We Keep From The Audit

- [x] Payment recovery should be stronger and more explicit.
- [x] Flight completion still needs PNR / seat / baggage clarity.
- [x] STT needs a graceful non-voice fallback.
- [x] FX should come from the server, not local assumptions.
- [x] Meridian needs structured client-side error telemetry.

## What We Do Not Ship As-Is

- [ ] No visible agent marketplace concepts in customer flows.
- [ ] No raw trust-score or grade card before booking.
- [ ] No generic “luxury concierge” framing that weakens Ace’s category.
- [ ] No duplicate work on gaps that are already partially solved, such as the current multi-leg and hotel surfaces.
