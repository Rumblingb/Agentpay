# Mac Mini Agency OS Runtime

This directory contains the source-controlled runtime pieces for the AgentPay Labs Agency OS on the Mac mini.

## Commands

- `bin/agency-os-sync`: merge Agency OS cells into founder-facing `OUTBOX.md` and `STATUS.md`.
- `bin/agency-os-evolve`: audit cell freshness, write auto-advice, and nudge stale cells.
- `bin/agency-os-bootstrap-runtime`: create missing live Agency OS boards from source-controlled templates.

## Live State

Live runtime state lives under:

`~/.openclaw/workspace-agency-os`

The repo owns templates, scripts, and docs. Live boards are not overwritten unless `--overwrite` is explicitly passed to `agency-os-bootstrap-runtime`.

## Team Shape

Agency OS tracks eight company-building cells:

- offer-strategy
- build-ops
- outbound-ops
- media-ops
- revenue-ops
- ads-ops
- partnerships-ops
- customer-ops

Bill/Hedge remains separate.
