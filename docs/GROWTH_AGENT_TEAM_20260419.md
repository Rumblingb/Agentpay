# AgentPay Growth Agent Team

This is the execution model for the public wedge.

Core message:

`One OTP. Zero API keys. Full autonomy within user-defined mandates.`

The public story should stay on three product truths:

1. Capability Vault removes raw upstream credentials from the agent loop.
2. Governed mandates let the user define budget and approval boundaries once.
3. Host-native funding and settlement keep the workflow inside the host instead of breaking to manual checkout.

## Team design

### 1. Signal Agent

Owner: `scripts/growth/collect-signals.mjs`

Job:

- harvest ICP signals from GitHub, Hacker News, and Reddit
- score them by wedge fit
- publish a clean queue to `ops/growth/signals/latest.json`

### 2. Outbound Agent

Owner: `scripts/growth/draft-outreach.mjs`

Job:

- turn top signals into first-touch plain-text email drafts
- keep the tone developer-to-developer
- never auto-send without human review

### 3. Content Agent

Owner: `scripts/growth/draft-content.mjs`

Job:

- turn recent commit themes plus market signals into:
  - blog briefs
  - X thread drafts
  - short-form video prompts

### 4. Community Agent

Owner: `scripts/growth/community-monitor.mjs`

Job:

- monitor Reddit and Hacker News threads
- draft helpful replies where the wedge genuinely fits
- keep the replies useful first and promotional second

### 5. Founder Report Agent

Owner: `scripts/growth/weekly-report.mjs`

Job:

- summarize product readiness
- summarize top market signals
- keep founder focus on the next highest-value moves

## Execution cadence

Daily:

- run signal collection
- refresh outbound and community drafts

Twice weekly:

- refresh content briefs
- record one real product demo clip

Weekly:

- publish the founder report
- choose one thread, one video, one outbound segment

## Guardrails

- No auto-posting with raw credentials or unsupervised brand voice.
- No distribution copy that leads with unrelated products or long-range vision.
- No promise of "works everywhere" unless the flow is green in the product wedge today.

## Immediate priority

The strongest near-term acquisition path is:

1. MCP quickstart
2. capability connect demo
3. governed mandate demo
4. hosted funding resume demo

That is what growth should amplify until hosted merchant onboarding is even simpler.
