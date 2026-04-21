# AgentPay This Week Plan

## What The North Star Actually Means Right Now

The long-term vision is bigger than a payments API.
It is a personal and enterprise authority layer for agents:

- portable trust
- capability vault
- governed paid execution
- exact-call continuity
- host-native operation through terminals, Claude, OpenAI, and remote MCP

That long-term vision can include a future personal agent device, but this week's company priority is not hardware.
This week's priority is to make AgentPay undeniable as the infrastructure wedge.

## This Week's Objective

Ship the most convincing end-to-end product proof in the repo and in public:

1. agent asks for an API
2. AgentPay resolves access
3. human does the minimum required step
4. exact blocked call resumes
5. same workbench can reuse governed access later
6. raw provider secret never lives in chat or local folders

If this path feels inevitable, the larger north star becomes believable.

## Product Priorities For This Week

### 1. Make Authority Bootstrap Feel Like One Thing

Deliver:

- one canonical terminal-first authority path
- guardrails, funding readiness, and provider setup framed as one AgentPay setup moment
- no dashboard dependence

Done enough when:

- a host can call `authority-bootstrap`
- a host can create onboarding from the bootstrap state
- a founder demo can explain the flow in one sentence

### 2. Make Reuse Safe And Visible

Deliver:

- opaque workbench leases only
- lease listing
- lease revocation
- clear continuity language in control-plane responses

Done enough when:

- same workbench reuse feels instant
- a lost laptop or compromised local workbench has a clean revoke story

### 3. Perfect Three Flagship Provider Paths

Pick only three for now:

- Databento
- Firecrawl
- Browserbase or Exa

Deliver:

- strong provider presets
- clear approval copy
- reliable paid-step behavior
- polished proof output after completion

Done enough when:

- the demo can show one data API, one browser/search API, and one generic path without hand-waving

### 4. Partner Distribution Setup

Deliver:

- partner email pack
- one partner-facing proof asset
- one short memo on why AgentPay increases completed setup and usage

Done enough when:

- API companies can understand the value in under 30 seconds

## This Week's Execution Schedule

### Monday

- finish authority-bootstrap and lease management surfaces
- keep tests green
- tighten terminal-native docs

### Tuesday

- polish Databento preset and one more flagship provider
- verify paid-step resume path with real-world copy and output
- identify any remaining friction in first-run setup

### Wednesday

- record the real demo asset:
  - ask for API
  - connect once
  - OTP or approval
  - automatic exact-call resume
  - second request reuses access
- cut both dev-facing and partner-facing versions

### Thursday

- send partner outreach to top API providers
- send founder outreach to design partners using the proof asset
- update front door copy to match the wedge exactly

### Friday

- review the whole path like a fresh user
- log every friction point
- decide next week's single bottleneck

## Non-Negotiables

- no raw provider secrets stored locally
- no dashboard as canonical runtime
- no broad "agent platform" positioning
- no new surface that bypasses continuity, receipts, or guardrails

## What You Should Personally Do From Here

1. Stay on `codex/terminal-native-product` as the hardening branch.
2. Use the new terminal-native surfaces as the canonical demo path.
3. Record a real proof demo before investing more into broad marketing.
4. Pick the three flagship providers and treat them like launch products, not integrations.
5. Start partner conversations now, but frame them as conversion and activation infrastructure, not just payments.

## The Real Next Bottlenecks

- delegated auth partnerships
- first-run payment method setup polish
- provider preset quality
- proof assets strong enough to win trust quickly

## Success At The End Of This Week

By the end of the week, AgentPay should be able to show:

- one terminal-native authority bootstrap
- one polished provider connect flow
- one paid-step resume demo
- one same-workbench reuse demo
- one partner outreach pack tied to the proof

That is the shortest path from vision to something people can believe in immediately.
