# Content backlog

## Weekly narrative

Keep the story on the infrastructure wedge. Do not lead with Ace, RCM, or long-range vision on public distribution surfaces.

## Commit themes

- Public surface and build reliability: 10 recent commits
- MCP and host integration: 1 recent commits
- Platform reliability: 155 recent commits
- Capability Vault and governed execution: 2 recent commits

## Blog briefs

### 1. How to remove API key paste from the agent UX
- Problem: users still get asked to paste upstream secrets into chat or .env files.
- Proof: show capability connect flow plus hosted vault handoff.
- CTA: docs.agentpay.so/examples and docs.agentpay.so/quickstart.

### 2. Governed mandates are the missing safety primitive for paid agents
- Problem: approval is either too loose or too manual.
- Proof: show mandate creation, threshold, approval, and execution.
- CTA: app.agentpay.so plus MCP tool reference.

### 3. Why host-native funding beats sending users to another checkout flow
- Problem: the agent loses continuity at payment time.
- Proof: show hosted action session and funding request resume flow.

## X thread drafts

### Thread 1
```text
1. The real blocker for AI agents is not model quality. It is the trust surface around public surface and build reliability.
2. We keep seeing this in the wild: BerriAI/litellm
3. If the user has to paste keys into chat or leave the host to fund the action, the workflow is already broken.
4. The better path is one hosted connect flow, one governed mandate, and one settlement trail.
5. That is the wedge AgentPay is focused on: one OTP, zero API keys, full autonomy within user-defined limits.
6. Quickstart: docs.agentpay.so/quickstart
```

### Thread 2
```text
1. The real blocker for AI agents is not model quality. It is the trust surface around mcp and host integration.
2. We keep seeing this in the wild: modelcontextprotocol/typescript-sdk
3. If the user has to paste keys into chat or leave the host to fund the action, the workflow is already broken.
4. The better path is one hosted connect flow, one governed mandate, and one settlement trail.
5. That is the wedge AgentPay is focused on: one OTP, zero API keys, full autonomy within user-defined limits.
6. Quickstart: docs.agentpay.so/quickstart
```

### Thread 3
```text
1. The real blocker for AI agents is not model quality. It is the trust surface around platform reliability.
2. We keep seeing this in the wild: modelcontextprotocol/rust-sdk
3. If the user has to paste keys into chat or leave the host to fund the action, the workflow is already broken.
4. The better path is one hosted connect flow, one governed mandate, and one settlement trail.
5. That is the wedge AgentPay is focused on: one OTP, zero API keys, full autonomy within user-defined limits.
6. Quickstart: docs.agentpay.so/quickstart
```

## Short-form video prompts

- Terminal magic: run `npx -y @agentpayxyz/mcp-server`, then show capability connect and a governed mandate in one take.
- Before and after: messy .env and key copy-paste on the left, AgentPay connect flow on the right.
- Payment continuity: show the agent pause for a host-native funding request, then resume without tab-switching.
