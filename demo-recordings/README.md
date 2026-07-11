# Demo Recordings

Local recording workspace for AgentPay launch/demo assets.

## Public-ready cuts

- `agentpay-codex-mcp-agentic-clean-16x9.mp4` — main website/demo video.
- `agentpay-codex-mcp-agentic-vertical-social.mp4` — vertical social cut.
- `agentpay-magic-trick-clean-16x9.mp4` — short magic-trick style proof.
- `agentpay-magic-trick-vertical-social.mp4` — vertical social cut.

The docs site uses compressed copies in:

```text
apps/docs/public/demo/
```

## Local source captures

Raw `.mov` captures are intentionally local scratch assets. They are useful for recutting videos but too large/noisy for ordinary repo diffs.

## Generated proof artifacts

Running:

```bash
npm run demo:codex-agentpay-mcp
```

writes sanitized latest-run artifacts:

```text
demo-recordings/latest-codex-agentpay-mcp-demo.md
demo-recordings/latest-codex-agentpay-mcp-demo.json
```

Those files are regenerated each run and are ignored by git.
