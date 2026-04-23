# Agent-Native North Star

## The Long-Term Idea

AgentPay is the authority layer for the agentic web.

In the long run, an agent should be able to:

- discover the capability it needs
- obtain governed access without raw secret handling
- understand what it is allowed to spend
- pay when needed within policy
- pause only for human decisions that truly matter
- resume the exact task automatically
- carry trust and continuity across hosts and workbenches

The user should feel that the agent can finish real work end to end without becoming a security or billing liability.

## The Product Wedge

The wedge is not “agent platform.”

The wedge is:

- trust
- capability vault
- governed paid execution
- continuity after approval

That is the part of the stack that is still broken for most agent products.

## The User Promise

For developers:

- do not wire every API by hand
- do not ask users to paste secrets into chat
- do not lose continuity when a paid step appears

For end users and operators:

- approve once
- set limits once
- keep secrets out of the agent
- let the agent keep going inside those limits

For API partners:

- fewer setup drop-offs
- more completed activations
- more governed usage from agent-driven workflows

## The Runtime Vision

The canonical runtime is host-native:

- terminal
- Claude
- OpenAI
- MCP-capable workbenches
- hosted action handoffs

The dashboard is support infrastructure, not the main product experience.

## The Trust Model

The agent should never become the holder of raw authority.

Instead:

- AgentPay holds canonical credential authority in the vault
- the host gets clear next actions and proof
- the workbench may hold only revocable, time-boxed lease material
- humans intervene only for setup, approval, funding, or exceptional control

## The Human Role

Humans stay in the loop for:

- initial authority setup
- provider connection where delegated auth is not yet available
- payment confirmation when policy requires it
- exceptional override and revocation

Humans should not stay in the loop for:

- repeated provider setup
- repeated dashboard visits
- manual reconstruction of agent actions
- routine execution within approved guardrails

## The Distribution Bet

If AgentPay owns the trust and continuity seam first, partnerships only need to unlock better delegated auth and smoother host placement.

That is a much stronger position than needing partnerships to hide a product gap.

## What “Finished” Looks Like

A finished AgentPay path feels like this:

1. the agent asks for an API
2. AgentPay resolves access or opens one minimal setup
3. the human approves the minimum necessary step
4. the agent continues the exact blocked task
5. future runs reuse governed access automatically
6. the operator has a clear revoke, audit, and receipt story

When that feels obvious in multiple hosts, the larger north star becomes credible.
