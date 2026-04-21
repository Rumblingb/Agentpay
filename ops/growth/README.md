# Growth Operations

This folder is the operator surface for AgentPay growth and distribution.

The system is deliberately simple:

- `signals/` holds harvested market signals from GitHub, Hacker News, and Reddit.
- `drafts/` holds outbound drafts, content briefs, and community reply queues.
- `reports/` holds the weekly founder report.

Run the full loop from the repo root:

```bash
node scripts/growth/run-all.mjs
```

Recommended environment variables:

```bash
GITHUB_TOKEN=ghp_...                 # Optional, raises GitHub API limits
GROWTH_KEYWORDS=mcp server,api key management,agent payments
GROWTH_USER_AGENT=AgentPayGrowthBot/0.1
```

Operating rules:

- Human review stays in the loop for outbound and community posting.
- Keep the message on the wedge: one OTP, zero API keys, governed paid execution.
- Do not lead with Ace or RCM on public growth surfaces while the infrastructure wedge is the acquisition engine.
