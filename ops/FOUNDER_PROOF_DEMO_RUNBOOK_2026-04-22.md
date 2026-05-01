# Founder Proof Demo Runbook

## Why This Exists

AgentPay's biggest gap right now is not another API surface.
It is proof.

This runbook defines the one demo path that should anchor:

- founder recording
- partner outreach
- public clips
- README and quickstart updates
- future product QA

If the demo does not show this path clearly, the story is still too abstract.

## The One Story To Tell

An agent needs an API to finish real work.
AgentPay handles trust, setup, vaulting, governed payment, and exact-call resume.
The human appears only for the minimum required step.
The same workbench reuses governed access later without re-entering a secret.

## Non-Negotiable Product Truths

The demo must show all of these:

1. The request starts inside a host or terminal, not a dashboard.
2. The provider secret never appears in chat or local project files.
3. The human step is small and specific.
4. AgentPay resumes the exact blocked task.
5. The same workbench can use governed access again later.
6. There is a clear revoke and audit story behind the scenes.

## Canonical Demo Path

Use this exact sequence.

### Scene 1: The agent hits the real world

Show:

- a terminal or host asking for a provider capability
- a real task, not a fake toy prompt
- the capability is required to finish the job

Suggested line:

`Need Databento market data to finish this analysis.`

### Scene 2: AgentPay resolves access

Show:

- `GET /api/capabilities/authority-bootstrap`
- `POST /api/capabilities/access-resolve`

The visible point:

- AgentPay checks whether authority, funding, and governed reuse already exist
- the host does not send the user to a generic dashboard

What the viewer should understand:

`AgentPay decides what is missing before the agent gets blocked.`

### Scene 3: One setup moment

Show one of these:

- `POST /api/capabilities/onboarding-sessions`
- hosted connect flow

Must include:

- provider connect
- limits or autonomy context
- preferred rail or funding readiness

What not to show:

- raw API key pasted into chat
- several disconnected admin screens
- a long configuration journey

### Scene 4: Minimal human step

Show:

- OTP
- confirmation
- or one explicit approval step

The visible point:

- the human is approving a bounded step, not doing the agent's work

Suggested line:

`Approve this once. AgentPay keeps the authority and the agent keeps going.`

### Scene 5: Exact-call resume

Show:

- the same blocked capability call continuing
- not a manual rerun
- not a reconstructed prompt

Preferred proof:

- `POST /api/capabilities/:capabilityId/execute`
- blocked on paid usage
- AgentPay creates the human step
- the call resumes after approval
- the result returns with proof

Viewer takeaway:

`The agent did not lose continuity.`

### Scene 6: Same-workbench reuse

Show:

- second request from the same workbench
- governed access reused through the lease path
- no second setup and no second secret entry

Preferred proof:

- `POST /api/capabilities/lease-execute`
- or `access-resolve` returning reusable governed access

Viewer takeaway:

`The second run feels native.`

## Best Provider Set For The Demo

Do not try to prove everything at once.

Use:

1. Databento for the flagship paid data story
2. Firecrawl for a general web workflow story
3. Browserbase or Exa for a second reusable host-native path

## Demo Output Formats

### 1. Founder terminal demo

Length:

- 2 to 4 minutes

Goal:

- prove the product seam

Must show:

- access request
- one setup
- one human step
- exact-call resume
- second-run reuse

### 2. Partner clip

Length:

- 30 to 45 seconds

Goal:

- show that AgentPay removes setup friction and increases completed usage

Must end on:

- fewer setup drop-offs
- more activated users
- more governed usage

### 3. Developer clip

Length:

- 20 to 30 seconds

Goal:

- show `no raw API keys in chat`
- show `one OTP`
- show `same workbench reuse`

## Recording Checklist

Before recording, confirm:

- the host surface is terminal-first
- the provider path is green
- the approval step is fast and deterministic
- the resume path returns proof
- the second request reuses governed access
- the revoke surface exists if someone asks about compromise or laptop loss

## Terminal Harness

Use the founder demo CLI to make the proof path repeatable from the real AgentPay seam:

```bash
npm run demo:founder-proof -- \
  --api-key <merchant_api_key> \
  --principal-id <principal_id> \
  --provider databento \
  --workbench-id founder-proof-databento \
  --execute-path </provider-relative-path> \
  --execute-body-file ops/founder-demo/request-body.template.json \
  --poll-seconds 120
```

What it does:

1. reads `authority-bootstrap`
2. runs `access-resolve`
3. prints any hosted onboarding or human-step URL
4. optionally polls hosted action or execution-attempt state
5. executes the real capability call
6. performs a second same-workbench call through `lease-execute`
7. writes sanitized transcript artifacts under `ops/founder-demo/`

Use the transcript output to tighten the terminal demo before recording. If the script cannot reach the second same-workbench call cleanly, the product seam still is not ready to market as inevitable.

## What Not To Show

Do not show:

- generic dashboard navigation
- broad "agent platform" language
- fake sample data with no clear task
- raw provider secrets
- retrying from scratch after approval
- a path that only works because of manual patching off camera

## Success Standard

After watching the demo:

- a developer should think `this is how agent tools should work`
- a partner should think `this will increase completed setup and usage`
- a user should think `I only show up when it actually matters`

## Immediate Next Recording Target

Record this path first:

1. Databento request from a terminal
2. AgentPay detects missing governed access
3. one hosted setup or approval step
4. paid usage resumes automatically
5. second Databento request from the same workbench succeeds through governed reuse

That is the shortest path to making the wedge feel inevitable.
