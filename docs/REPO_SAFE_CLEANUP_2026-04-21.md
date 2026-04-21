# Repo Safe Cleanup - 2026-04-21

This pass was intentionally narrow. It removed files that should not live in the public product repo and preserved useful product surfaces even when old ignore rules had drifted.

Removed from Git
----------------
- local Codex/Claude machine settings
- Expo machine state under root and `apps/api-edge`
- `.tmp/` render scratch files
- `audit/weekly-report.md`
- the public `core-private/` placeholder
- `docs/internal/*`
- volatile growth snapshots, reports, signal dumps, and send logs

Preserved on purpose
--------------------
- AgentPay core, billing, hosted action, and MCP seams
- Ace and RCM app code
- `ops/mac-mini/*`
- archived public docs under `docs/archive/`
- CLI and SDK surfaces under `cli/agentpay` and `sdk/python/agentpay`
- the Meridian iOS bridge files that are still tracked
- curated growth/operator docs such as partnership drafts and READMEs

Ignore policy corrections
-------------------------
- narrowed `Agentpay/` and `Agentpay_backup/` to root-only rules so useful `agentpay` package paths are not accidentally ignored on Windows
- stopped hiding `ops/mac-mini/*` from Git because it is intentionally versioned right now
- stopped treating `docs/archive/` as disposable backup output because those docs are part of the public historical record
- added explicit ignore rules for local media scratch, Expo state, temp render output, and generated growth runtime artifacts

Follow-up rule
--------------
Future cleanup should keep using the same bar:

1. Remove local state, generated runtime output, temp files, and internal-only docs.
2. Preserve product, distribution, billing, host-runtime, and useful operator surfaces until there is an explicit owner-approved archive or split plan.
