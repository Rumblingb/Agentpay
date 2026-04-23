# Hermes Agentpay Labs Runtime

## Target split

Hermes is the primary Agentpay Labs worker.

OpenClaw stays online as the monitor, repair, and founder-alert layer. It should not be the main reasoning or implementation brain while the local Ollama lanes are unstable.

## Current posture

- Hermes runs through `/Users/baskar_viji/.local/bin/hermes`.
- Hermes default model is OpenRouter-backed and free-first: `openrouter/free`.
- Hermes fallback order is explicit in `~/.hermes/config.yaml`: `openrouter/free` first, then only OpenRouter models marked `:free`.
- The Agentpay repo is the work surface: `/Users/baskar_viji/Agentpay`.
- Runtime logs live outside the repo under `~/.hermes/agentpay-labs/`.
- Generated local runtime journals under `ops/mac-mini/runtime/` are ignored by git.

## Responsibilities

### Hermes primary loop

Hermes owns one bounded Agentpay Labs cycle at a time:
- inspect current repo and ops state
- choose exactly one concrete work item
- make a small code, test, docs, QA, or runbook improvement
- verify the change when practical
- write a durable cycle note
- report blockers instead of guessing

Good default work:
- unblock typecheck and smoke-test failures
- tighten Agentpay/Ace product workflows
- improve deterministic ops scripts
- improve launchd/runtime reproducibility
- produce QA and founder-facing operational summaries

### OpenClaw monitor loop

OpenClaw owns observation and escalation:
- check whether Hermes and launchd jobs are running
- check OpenClaw gateway, browser gateway, and command center health
- write founder alerts only for material runtime issues
- repair obvious service-level failures when that is safe and deterministic

OpenClaw should not run broad autonomous product/build loops by default.

## Safety gates

Hermes cycles must not:
- deploy
- push or commit
- spend money
- place bookings, trades, payments, or external orders
- print or copy secrets
- run destructive git or filesystem commands
- rewrite unrelated user work

Full unattended mode is intentionally explicit:

```bash
HERMES_AGENTPAY_YOLO=1 ops/mac-mini/bin/hermes-agentpay-labs
```

Without `HERMES_AGENTPAY_YOLO=1`, Hermes keeps checkpoints enabled and does not bypass command approvals. That is the safer mode for first runs while the current repo is dirty.

## Launchd jobs

Two source-controlled jobs define the around-the-clock loop:

- `com.agentpay.hermes.agentpay-labs` - primary Hermes Agentpay Labs cycle every 60 minutes
- `com.agentpay.hermes.watchdog` - deterministic runtime watchdog every 10 minutes

Install or refresh them with:

```bash
ops/mac-mini/bin/agency-os-install-launchd
```

Manual checks:

```bash
ops/mac-mini/bin/hermes-watchdog
ops/mac-mini/bin/hermes-agentpay-labs --dry-run
ops/mac-mini/bin/hermes-agentpay-labs
```

## Promotion path

1. Run `hermes-watchdog` and clear hard runtime errors.
2. Run `hermes-agentpay-labs --dry-run` and inspect the prompt and environment.
3. Run one manual Hermes cycle without `HERMES_AGENTPAY_YOLO`.
4. Enable launchd.
5. After several clean cycles, opt into `HERMES_AGENTPAY_YOLO=1` only if unattended edits are acceptable.
