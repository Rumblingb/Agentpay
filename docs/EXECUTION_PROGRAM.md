# AgentPay Execution Program

## What We Are Actually Shipping

AgentPay is not a generic agent platform.

The current company wedge is:

- trust
- capability vault
- governed paid execution
- exact-call continuity
- host-native operation through terminals, Claude, OpenAI, and remote MCP

Everything else is secondary until this path feels inevitable.

## The Only Path That Matters Right Now

Every meaningful product and distribution decision should strengthen this flow:

1. an agent needs an API or paid capability
2. AgentPay checks whether governed access already exists
3. if not, AgentPay runs one minimal setup moment for authority and provider connection
4. the human only does the minimum required step
5. AgentPay vaults the credential and applies policy
6. the exact blocked call resumes
7. the same workbench can reuse governed access later without re-entering a secret

If any step falls back to dashboard hopping, raw key handling, or manual reruns, the seam is still unfinished.

## Product Priorities

### 1. Authority First

Authority bootstrap must feel like one thing:

- contact and identity context
- preferred funding rail
- spend limits
- OTP policy
- workbench continuity

The host should be able to frame that as one setup moment, not multiple admin tasks.

### 2. Capability Access Without Secret Exposure

The raw provider secret belongs only in AgentPay-controlled surfaces:

- hosted connect
- vaulted persistence
- server-side execution

Local workbenches may store only opaque, revocable leases.

### 3. Paid Execution Without Losing Continuity

Paid execution is the moat.

When a call crosses a funding or approval boundary:

- AgentPay must keep the exact blocked call
- AgentPay must collect the minimum human step
- AgentPay must resume without asking the agent to reconstruct the call
- AgentPay must return proof back to the host

### 4. Reuse That Feels Native

Second-run behavior matters as much as first-run behavior.

For the same workbench, governed reuse should feel instant:

- no raw secrets locally
- no provider dashboard revisit
- no repeated “connect this again” loop
- clear revoke story if the device is lost or compromised

## Flagship Provider Rule

Do not try to perfect every provider at once.

Current launch paths:

- Databento
- Firecrawl
- Browserbase or Exa
- generic provider intake as fallback

These should feel like products, not presets.

## Distribution Rule

AgentPay should win through host-native surfaces:

- remote MCP
- hosted actions
- terminal-native tool calls
- connector-style handoffs

The dashboard can exist for support and back-office use, but it is not the canonical runtime.

## Founder Proof Standard

Every week should push one observable proof asset closer:

1. ask for API
2. connect once
3. OTP or confirmation if required
4. exact-call resume
5. same-workbench reuse
6. no raw secret anywhere in chat or the repo

If the demo does not show that, the product story is still too abstract.

## Quality Bar

Before calling work done, check the real path:

- fresh principal
- missing authority
- missing payment method
- provider connect required
- free usage
- paid usage
- approval or OTP
- exact-call resume
- repeat call from the same workbench
- revoke and recovery

## What We Are Not Doing

Right now we are not optimizing for:

- a broad marketplace story
- a dashboard-centric workflow
- maximum provider count
- generic AI platform positioning

Those become easier after the wedge is undeniable.
