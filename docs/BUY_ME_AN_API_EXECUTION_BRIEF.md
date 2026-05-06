# Buy Me An API Execution Brief

## Position

AgentPay is the control layer for agentic expenses.

Stripe, Link, cards, UPI, wallets, and future agent-payment rails move money. AgentPay owns the authority surface: capability discovery, credential vaulting, spend policy, phone/terminal human steps, exact-call resume, receipts, and lease revocation.

The wedge is:

1. An agent needs an API or hits a paid boundary.
2. The host calls `agentpay_buy_api` with the capability need, not a provider dashboard task.
3. AgentPay resolves existing access, picks a provider, or creates one hosted human step.
4. AgentPay returns a resumable token and never exposes raw secrets.
5. The exact blocked call resumes server-side after auth, funding, OTP, or approval.

The security hook is:

1. A human or agent accidentally pastes a provider key into chat, logs, or terminal output.
2. AgentPay Leak Guard detects the key pattern and returns only a redacted fingerprint.
3. AgentPay scrubs the output with `[AGENTPAY_VAULTED_SECRET]`.
4. AgentPay kills the agent session for non-auto-healable authority like Stripe live master keys.
5. AgentPay starts OTP vaulting for auto-healable restricted/test/provider keys when requested.
6. Future execution uses scoped proxy/lease access instead of raw secrets in context.

## Product Defaults

- First surface: MCP host, because Claude, Codex, Gemini, and other agent workbenches already know how to call tools.
- Companion surface: CLI commands over the same API contract.
- TUI direction: terminal control-plane command now; richer Ink-based persistent harness once the live control-plane fields settle.
- Human step: terminal first, phone-capable by default. Phone should become the high-trust approval surface, but terminal remains the fallback.
- Provider strategy: start with high-friction, high-value APIs: Databento, Browserbase, Firecrawl, Exa, and generic REST API.
- Revenue: charge for hosted MCP/control-plane subscription plus a funded-action convenience fee. Keep provider credentials and raw payment instruments out of the agent.

## Implementation Sequence

1. MCP contract
   - Ship `agentpay_buy_api`, authority bootstrap, control-plane, lease, and resume-token tools.
   - Return `agentResume.resumeToken` for setup and exact-call execution states.
   - Keep `capresume_*` authenticated and proof-oriented; do not make it a bearer secret.

2. Phone hook
   - Treat `customerPhone` and `notificationChannel` as first-class authority metadata.
   - Add mobile/push later as a hosted action delivery channel, not as separate approval logic.
   - Reuse the existing hosted action session lifecycle so terminal, phone, and email all resolve to the same state machine.

3. Leak Guard
   - Keep detection local/MCP-first so the raw secret is not spread to other services.
   - Support OpenAI, Anthropic, Stripe, AWS, and Google first.
   - Never print raw matches back to the terminal, logs, or agent output.
   - Fail closed for Stripe live master keys: kill session, alert operator, require manual rotation.
   - Queue vault/rotation for restricted/test/provider keys through `/api/capabilities/leak-guard/events`.
   - Be precise in positioning: AgentPay can detect, vault, and guide rotation now; provider-side automatic regeneration requires provider-specific authorization.

4. Terminal harness
   - Keep current CLI JSON commands for smoke testing and demos.
   - Use `agentpay tui` as the first live control-plane surface: pending actions, active leases, capabilities, authority status, and Leak Guard guidance.
   - Use `agentpay tui --demo` for the public 60-second recording when live provider credentials are not available.
   - Use `agentpay resume capresume_*` as the CLI proof that the agent does not reconstruct the blocked call.
   - Add a richer Ink TUI next: spend today, next approval QR/link, phone approval status, and resume proofs.

5. Workspace distribution
   - Package examples for Claude Desktop, Codex, Cursor, Gemini CLI, and generic MCP hosts.
   - Lead with prompts: "buy me market data", "buy me high-stealth scraping", "keep this under $0.50", "use my phone if needed".

## Demo Script

Use this flow for design partners:

1. Start in an agent workbench with AgentPay MCP connected.
2. Ask: "Buy me an API for market data in this repo. Use Databento if available, keep the first action under $0.50, and use my phone if a human step is needed."
3. Show `auth_required` only if no governed access exists.
4. Complete the hosted setup once.
5. Rerun the same `agentpay_buy_api` request and show a workbench lease.
6. Exhaust free usage or force a paid call.
7. Show `capresume_*`.
8. Complete the human step.
9. Call `agentpay_execute_with_resume_token` or `agentpay resume capresume_*` and show proof that the call resumed server-side.
10. Paste a fake leaked key into the workbench and run `agentpay scan-secrets --auto-heal` to show redaction, fingerprinting, session-kill policy for live master keys, and OTP vaulting for restricted/provider keys.

## Outreach Targets

- Quant/data builders using Databento, Polygon, Alpaca, or similar paid APIs.
- Browser automation builders using Browserbase, Firecrawl, Exa, Tavily, or scraping APIs.
- Agent framework builders with MCP distribution pain.
- Teams with many API dashboards and compliance anxiety around raw keys in agent context.

Core message:

`Do not wire every API dashboard into every agent. Call AgentPay once, set authority once, and let the agent buy/reuse governed API access without seeing secrets.`
