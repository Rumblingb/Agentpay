# Model Policy

## Non-negotiables

- This Mac mini is an Apple M4 with 16 GB unified memory.
- The machine cannot be treated like a multi-GPU server.
- Large local models must not starve the host, the gateway, or Bill execution loops.
- Model quality is important, but repeatability, latency, and bounded cost matter more than leaderboard vanity.

## Decision

Do not make a 24B to 32B model the always-on local brain on this machine.

Use a disciplined three-tier policy:

1. Local small model
- role: classify, extract, summarize, scout planning, log triage
- current default: `qwen2.5-coder:7b`

2. Local strong model
- role: bounded local reasoning, code drafting, schema shaping, offline critique
- current default: `qwen2.5-coder:14b`

3. Cloud escalation
- role: only for hard bounded tasks where the expected value exceeds the token cost
- primary:
  - `gpt-5.4-mini` for high-quality daily coding/reasoning escalation
  - `gpt-5.4` for promotion-board, architecture, and risk-critical review
- secondary:
  - Gemini Flash for low-cost batch synthesis or search-heavy passes
  - Claude Sonnet or Opus for rare second-opinion critique, not continuous loops

## Why not the 27B model right now

The 27B distilled model family is not rejected on quality grounds. It is rejected as an always-on local default on this specific machine because:
- it is too large for comfortable always-on operation on a 16 GB unified-memory Mac mini
- it would reduce headroom for Ollama, OpenClaw, dashboards, logs, and Bill data jobs
- it increases the odds of latency spikes, swap pressure, and service instability

Re-evaluate only if:
- the machine is upgraded
- Bill is moved to a larger dedicated host
- or a clearly better Apple-silicon-native quantized serving path is proven on this exact hardware

## Anti-drift rules

- One model has one job. Do not rotate models casually.
- Bill and Agency OS should not pick models ad hoc in prompts.
- All routing decisions should be policy-driven and encoded in config.
- Expensive cloud models should be triggered by task class, not by frustration.
- Promotion, live-risk review, and approval decisions should use a fixed review stack, not a random model mix.

## Bill routing

### Always-on local
- `qwen2.5-coder:7b`
  - scraping task decomposition
  - parser generation
  - dataset normalization help
  - simple pattern summaries

### Local bounded heavy
- `qwen2.5-coder:14b`
  - pipeline debugging
  - experiment review
  - report drafting
  - code generation for deterministic subsystems

### Cloud bounded review
- `gpt-5.4-mini`
  - daily hard reasoning when local output is insufficient
- `gpt-5.4`
  - promotion-board review
  - risk architecture review
  - live-readiness critique
- optional second opinion:
  - Gemini Flash for cheap broad synthesis
  - Claude Sonnet or Opus for adversarial critique

## Agency OS routing

### Always-on local
- `qwen2.5-coder:7b`
  - triage
  - docs extraction
  - task shaping
  - low-risk summarization

### Local bounded heavy
- `qwen2.5-coder:14b`
  - repo scans
  - code drafts
  - route generation
  - QA planning

### Cloud bounded review
- `gpt-5.4-mini`
  - primary high-quality implementation escalation
- `gpt-5.4`
  - architecture and launch-critical review
- optional:
  - Gemini Flash for cheap growth/research batching
  - Claude for design or critique passes when a second view is useful

## Bill intelligence principle

Bill must not get "smart" by asking the LLM to guess position size.

Bill becomes intelligent through:
- better data
- better slippage modeling
- better regime detection
- better promotion gates
- better execution realism
- better risk and capital controls

The LLM helps Bill think.
The engine decides whether Bill is allowed to act.

