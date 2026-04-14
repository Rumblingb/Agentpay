# Founder Interface

This is the current founder/operator control layer for the Mac mini.

## Current operating reality

- `bill` is a first-class live lane.
- `agency-os` is not yet a first-class OpenClaw lane.
- The company-building side currently runs through:
  - `jack`
  - `bigb`
  - `digital-you`
- `workspace-agency-os` is the merged founder-facing control surface over those three lanes until the runtime is fully consolidated.

## Commands

- `ops/mac-mini/bin/bill-ask "..."`
  - append a founder request to Bill's `INBOX.md`
- `ops/mac-mini/bin/agency-os-ask "..."`
  - append a founder request to the merged Agency OS `INBOX.md`
  - fan the same request out to `jack`, `bigb`, and `digital-you` lane inboxes
- `ops/mac-mini/bin/stack-monitor`
  - render the current Bill + Agency OS monitor view once
- `ops/mac-mini/bin/stack-watch 10`
  - refresh that monitor every 10 seconds
- `ops/mac-mini/bin/stack-dashboard`
  - open a tmux dashboard with Bill + Agency OS + OpenClaw panes

## Files

Bill:
- `~/.openclaw/workspace-bill/INBOX.md`
- `~/.openclaw/workspace-bill/OUTBOX.md`
- `~/.openclaw/workspace-bill/memory/`
- `~/hedge/.rumbling-hedge/logs/prediction-cycle-history.jsonl`

Agency OS:
- `~/.openclaw/workspace-agency-os/INBOX.md`
- `~/.openclaw/workspace-agency-os/OUTBOX.md`
- `~/.openclaw/workspace-agency-os/STATUS.md`
- `~/.openclaw/workspace-agency-os/MAIN_ADVICE.md`
- `~/.openclaw/workspace-agency-os/TEAM_RUNTIME.md`
- `~/.openclaw/workspace-jack/INBOX.md`
- `~/.openclaw/workspace-bigb/INBOX.md`
- `~/.openclaw/workspace-digital-you/INBOX.md`

## Monitoring intent

The monitor is designed to answer three questions quickly:
- Is Bill healthy and still cycling?
- What is Bill actually seeing right now?
- Which Agency OS component lanes are active, and what are they supposed to be doing?
