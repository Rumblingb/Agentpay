# Mac Mini Operating System

This directory is the source-controlled home for the Mac mini runtime design.

## Purpose

Move the machine from:
- ad hoc lane sprawl
- config drift in `~/.openclaw`
- model swapping without role discipline
- "AI vibes" autonomy

to:
- one reproducible runtime
- explicit lanes
- typed interfaces
- clear service ownership
- deterministic health, audit, and approval flows

## Target runtime

The live runtime should converge to:
- `main`
- `agency-os`
- `bill`
- `hermes`

Optional:
- `discord-base` only if a narrow control-plane lane remains necessary

## Source-of-truth split

- `Agentpay/` is the source of truth for:
  - Agency OS
  - shared infrastructure
  - service wrappers
  - launchd templates
  - health and audit commands
  - typed contracts
  - runbooks
- `/Users/baskar_viji/hedge` will become the source of truth for Bill
- `~/.openclaw/` remains deployed runtime state, not the canonical location for core logic
- `founder-os/` is reference/archive only

## First implementation wave

1. Stabilize the host
2. Promote Bill to a first-class repo and service
3. Create `agency-os` as a first-class lane
4. Add shared ops infrastructure under source control
5. Rebind OpenClaw to the reduced lane set

## Directories

- `bin/` - founder/operator commands such as `bill-ask`, `agency-os-ask`, `stack-monitor`, and `stack-watch`
- `bin/` also includes `agency-os-sync`, `agency-os-evolve`, `agency-os-bootstrap-runtime`, `agency-os-install-launchd`, `stack-dashboard`, `stack-openclaw-watch`, and `stack-activity-watch`
- `scripts/` - supporting runtime scripts for the operator surface
- `launchd/` - plist templates and service ownership notes
- `runbooks/` - operator procedures
- `schemas/` - JSON contracts for health, approvals, lane tasks, and Bill promotion state

## Agency OS docs

- `AGENCY_OS_RUNTIME.md` - one-lane Agency OS runtime model with internal roles and self-evolution loop
- `AGENCY_OS_COST_POLICY.md` - cheap-by-default Agency OS operating policy
- `FOUNDER_INTERFACE.md` - how to talk to Bill and the merged Agency OS surface and monitor both together

## Live Agency OS runtime

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
