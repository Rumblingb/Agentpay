# Terminal-Native Control Plane

## Position

AgentPay should be operated through hosts and terminals, not through a merchant dashboard.

The product surface is:

1. Agent asks for a capability.
2. AgentPay decides whether it already has authority and a credential path.
3. Human only appears when AgentPay needs one-time setup, approval, funding, or OTP.
4. Agent resumes the exact blocked action.
5. The same workbench reuses governed access on future runs instead of asking again.

Everything else should be readable and operable through tool calls.

## Canonical Tool-Call Surfaces

- `POST /api/capabilities/access-resolve`
  - resolves "my agent needs this API" into existing governed access, a reusable pending setup, or a new AgentPay onboarding flow
- `GET /api/capabilities/terminal/control-plane`
  - terminal-native read model for authority, pending actions, billing, capabilities, and next tool calls
- `POST /api/capabilities/provider-requests`
  - turns "my agent needs this API" into an AgentPay intake and hosted onboarding action
- `POST /api/capabilities/onboarding-sessions`
  - one setup flow for limits, funding preference, and one or more provider credentials
- `POST /api/capabilities/:capabilityId/execute`
  - governed execution with pause, fund, confirm, and automatic resume
- `GET /api/capabilities/execution-attempts/:attemptId`
  - exact-call continuity and proof surface

## Product Rule

If a human can do something only in a dashboard today, it is unfinished.

The dashboard may exist as a debugging or back-office surface, but it is not the canonical runtime.

## Moat Goal

For any provider:

- if delegated auth exists, AgentPay should drive it in-host
- if delegated auth does not exist, AgentPay should still offer a governed one-time vaulting path
- if partnership is required, AgentPay should already own the control plane, continuity, and billing seam so the partnership only unlocks delegated auth

That makes the remaining gap external leverage, not internal product incompleteness.

## Security Rule

The terminal-native shift does not mean secrets enter chat.

It means:

- tool calls request capability access
- hosted human steps collect secrets or approvals outside agent context
- AgentPay stores credentials in the vault
- agents receive only governed capability references and execution results

## Distribution Consequence

Claude, OpenAI, and any MCP-capable host should see AgentPay as:

- the trust layer
- the capability vault
- the governed execution layer
- the resume layer after approval or funding

That is a stronger wedge than "agent platform" and a more durable one than "API marketplace".
