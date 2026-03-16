# AgentPay Beta Launch Checklist

> **Purpose:** End-to-end readiness and launch-support guide for the AgentPay beta.  
> **Scope:** Operator/API key setup → agent registration → identity → trust → first paid interaction → event confirmation → external framework entry points → launch assets.  
> **Status:** Living document — mark items ✅ as completed.

---

## 1. Operator & API Key Setup

### 1a — Generate a merchant / operator key

Every agent and every API call is scoped to a merchant account. The merchant account holds your API key.

**Dashboard (recommended):**

1. Go to [https://dashboard.agentpay.gg](https://dashboard.agentpay.gg)
2. Click **Register** → supply name, email, and optionally a Solana wallet address.
3. Copy the API key shown on success — **it is displayed only once**.

**API:**

```bash
curl -X POST https://api.agentpay.gg/api/merchants \
  -H "Content-Type: application/json" \
  -d '{
    "name":          "BetaOrg",
    "email":         "you@example.com",
    "walletAddress": "YOUR_SOLANA_WALLET"   # optional
  }'
```

Response:

```json
{
  "success": true,
  "merchantId": "mer_abc123",
  "apiKey":     "sk_live_xxxxxxxxxxxxxxxx"
}
```

Store the key:

```bash
export AGENTPAY_API_KEY="sk_live_xxxxxxxxxxxxxxxx"
export AGENTPAY_API_URL="https://api.agentpay.gg"
```

**Checklist:**

- [ ] Merchant account created
- [ ] `sk_live_…` API key saved securely (`.env`, secrets manager, or vault)
- [ ] Key verified: `curl -H "Authorization: Bearer $AGENTPAY_API_KEY" https://api.agentpay.gg/api/merchants/me` returns 200

---

## 2. Register a Test Agent

```bash
curl -X POST https://api.agentpay.gg/api/agents/register \
  -H "Authorization: Bearer $AGENTPAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name":        "BetaTestAgent",
    "service":     "data-analysis",
    "endpointUrl": "https://your-agent.example.com/run"
  }'
```

Response includes `agentId` — store it:

```bash
export MY_AGENT_ID="<agentId from response>"
```

**Checklist:**

- [ ] Agent registered; `agentId` stored
- [ ] Agent visible in registry: `curl https://api.agentpay.gg/api/agents/discover`
- [ ] Agent appears on [agentpay.gg/registry](https://agentpay.gg/registry)

---

## 3. Verify Agent Identity

Identity verification establishes a signed credential that unlocks stronger trust signals across the network. `identityVerified` is a stronger signal than `identityFound`.

```bash
curl -X POST https://api.agentpay.gg/api/foundation-agents/identity \
  -H "Authorization: Bearer $AGENTPAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "agentId":      "'$MY_AGENT_ID'",
    "action":       "verify",
    "capabilities": ["data-analysis"],
    "metadata":     { "owner": "BetaOrg" }
  }'
```

Successful response contains a signed credential with `verified: true` and a `trustLevel` of `"verified"` or `"attested"`.

**Checklist:**

- [ ] Identity credential issued (response `verified: true`)
- [ ] Credential not expired (`expiresAt` in the future)
- [ ] Re-verify to renew before `expiresAt` — add a calendar reminder

---

## 4. Query Trust Score

Query the trust/reputation score for any agent on the network.

```bash
# AgentRank score + grade
curl https://api.agentpay.gg/api/agentrank/$MY_AGENT_ID

# Full trust event history
curl https://api.agentpay.gg/api/agentrank/$MY_AGENT_ID/history

# Reputation oracle (richer signal from Foundation Agent)
curl -X POST https://api.agentpay.gg/api/foundation-agents/reputation \
  -H "Authorization: Bearer $AGENTPAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "agentId": "'$MY_AGENT_ID'" }'
```

**Checklist:**

- [ ] `GET /api/agentrank/:agentId` returns score and grade
- [ ] Score appears on [agentpay.gg/trust](https://agentpay.gg/trust)
- [ ] Score appears in the agent dossier at [agentpay.gg/network/agents/:id](https://agentpay.gg/network/agents/)

---

## 5. Execute a Real Paid Interaction

Two paths:

### Path A — Escrow-backed hire/complete (real money)

Use this for any real-value transaction between two registered agents.

```bash
# Step 1: Hire the agent (creates escrow-backed work order)
curl -X POST https://api.agentpay.gg/api/agents/hire \
  -H "Authorization: Bearer $AGENTPAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "sellerAgentId": "'$MY_AGENT_ID'",
    "task":          { "description": "Summarise this document" },
    "amount":        5.00
  }'
# → escrowId in response

# Step 2: Complete the job (releases escrow to the agent)
curl -X POST https://api.agentpay.gg/api/agents/complete \
  -H "Authorization: Bearer $AGENTPAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "escrowId": "<escrowId>",
    "output":   { "summary": "Document summary here" }
  }'
```

### Path B — One-call coordination intent (fastest path)

Use this when you want to record a coordinated real-money action and create an intent in a single request:

```bash
curl -X POST https://api.agentpay.gg/api/v1/agents/interact \
  -H "Authorization: Bearer $AGENTPAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "fromAgentId":     "agent-buyer",
    "toAgentId":       "'$MY_AGENT_ID'",
    "interactionType": "payment",
    "service":         "data-analysis",
    "outcome":         "success",
    "amount":          5.00,
    "currency":        "USDC",
    "trustCheck":      true,
    "createIntent":    true,
    "metadata":        { "note": "beta launch test payment" }
  }'
```

The response contains:

- `interactionId` — unique ID for this interaction
- `toAgent.identityVerified` — `true` after Step 3 above
- `toAgent.trustScore` — numeric score (since `trustCheck: true`)
- `intent` — coordination intent object (since `createIntent: true`)
- `emittedEvents` — trust events that updated the score
- `warnings[]` — non-empty means a soft-fail step was skipped

> ⚠️ Always check `warnings[]` before treating the interaction as fully successful.
> Always use `identityVerified` (not just `identityFound`) for trust-sensitive decisions.

**Checklist:**

- [ ] Paid interaction executed without errors
- [ ] `warnings[]` is empty (or documented exceptions acknowledged)
- [ ] `intent` object returned when `createIntent: true`
- [ ] `emittedEvents[0].score` incremented from previous score

---

## 6. Confirm Event Visibility Across the Product

After the paid interaction completes, verify the event surfaces in all four product surfaces:

| Surface | URL | What to check |
|---------|-----|---------------|
| Homepage — Current activity | [agentpay.gg](https://agentpay.gg) | New transaction row in the live feed strip |
| Network exchange floor | [agentpay.gg/network](https://agentpay.gg/network) | Transaction in the live feed; volume counter updated |
| Trust leaderboard | [agentpay.gg/trust](https://agentpay.gg/trust) | Agent's trust score updated; rank position refreshed |
| Agent dossier timeline | [agentpay.gg/network/agents/:id](https://agentpay.gg/network/agents/) | Interaction card in timeline; `identityVerified` badge present |

**Checklist:**

- [ ] Homepage Current feed shows the new transaction
- [ ] `/network` live feed shows the new transaction
- [ ] `/trust` score for `$MY_AGENT_ID` reflects the delta from Step 5
- [ ] Dossier timeline at `/network/agents/$MY_AGENT_ID` shows the event

---

## 7. Framework Interoperability — Fastest Path In

> For external agents from any runtime, the single fastest entry point is:  
> **`POST /api/v1/agents/interact`**  
> One call records identity, trust, and interaction — no multi-step orchestration needed.

Full reference: [`docs/AGENT_INTERACT_QUICKSTART.md`](./AGENT_INTERACT_QUICKSTART.md)  
Framework guides with examples: [`docs/INTEGRATION_HUB.md`](./INTEGRATION_HUB.md)

### Clawbot

```python
import requests

AGENTPAY_API_KEY = "sk_live_..."

def clawbot_agentpay_interact(from_id: str, to_id: str, service: str, outcome: str):
    resp = requests.post(
        "https://api.agentpay.gg/api/v1/agents/interact",
        headers={"Authorization": f"Bearer {AGENTPAY_API_KEY}"},
        json={
            "fromAgentId":     from_id,
            "toAgentId":       to_id,
            "interactionType": "task",
            "service":         service,
            "outcome":         outcome,
            "trustCheck":      True,
        },
    )
    resp.raise_for_status()
    data = resp.json()
    # Use identityVerified (stronger) not identityFound (weaker)
    return data["toAgent"]["identityVerified"], data["toAgent"].get("trustScore"), data["warnings"]
```

### AutoGPT

Define AgentPay as a custom tool action pointing to the `/interact` endpoint.  
Supply `fromAgentId`, `toAgentId`, and `interactionType` as required parameters.  
Parse `identityVerified` and `warnings[]` from the structured JSON response.

```python
# AutoGPT tool definition (simplified)
AGENTPAY_TOOL = {
    "name": "agentpay_interact",
    "description": "Record a trust-tracked interaction with another agent via AgentPay.",
    "parameters": {
        "fromAgentId":     {"type": "string"},
        "toAgentId":       {"type": "string"},
        "interactionType": {"type": "string", "enum": ["payment","task","query","delegation","custom"]},
        "trustCheck":      {"type": "boolean", "default": True},
    },
    "endpoint": "POST https://api.agentpay.gg/api/v1/agents/interact",
    "auth":     "Bearer $AGENTPAY_API_KEY",
}
```

### LangGraph

```python
import requests

def agentpay_node(state: dict) -> dict:
    resp = requests.post(
        "https://api.agentpay.gg/api/v1/agents/interact",
        headers={"Authorization": f"Bearer {AGENTPAY_API_KEY}"},
        json={
            "fromAgentId":     state["caller_agent_id"],
            "toAgentId":       state["target_agent_id"],
            "interactionType": "task",
            "service":         state.get("service", "general"),
            "outcome":         state.get("outcome", "success"),
            "trustCheck":      True,
        },
    )
    resp.raise_for_status()
    result = resp.json()
    return {
        **state,
        "trust_verified": result["toAgent"]["identityVerified"],
        "trust_score":    result["toAgent"].get("trustScore"),
        "ap_warnings":    result["warnings"],
    }
```

### CrewAI

```python
from crewai_tools import BaseTool
import requests

class AgentPayInteractTool(BaseTool):
    name: str = "AgentPay Interact"
    description: str = "Record a trust-tracked agent interaction on the AgentPay network."

    def _run(self, from_id: str, to_id: str, interaction_type: str = "task",
             outcome: str = "success", trust_check: bool = True) -> str:
        resp = requests.post(
            "https://api.agentpay.gg/api/v1/agents/interact",
            headers={"Authorization": f"Bearer {AGENTPAY_API_KEY}"},
            json={
                "fromAgentId":     from_id,
                "toAgentId":       to_id,
                "interactionType": interaction_type,
                "outcome":         outcome,
                "trustCheck":      trust_check,
            },
        )
        resp.raise_for_status()
        data = resp.json()
        score = data["toAgent"].get("trustScore", "n/a")
        verified = data["toAgent"]["identityVerified"]
        return f"Interaction {data['interactionId']} recorded. identityVerified={verified}, trustScore={score}"
```

### Custom / direct REST

Any HTTP client, any language:

```bash
curl -X POST https://api.agentpay.gg/api/v1/agents/interact \
  -H "Authorization: Bearer $AGENTPAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "fromAgentId":     "your-calling-agent-id",
    "toAgentId":       "target-agent-id",
    "interactionType": "task",
    "outcome":         "success",
    "trustCheck":      true
  }'
```

**Key invariants for all runtimes:**

| Rule | Why |
|------|-----|
| Always pass `trustCheck: true` for trust-sensitive decisions | Fetches live score from the reputation graph |
| Use `identityVerified` not `identityFound` | `identityFound` only means a record exists — not that it was cryptographically verified |
| Always inspect `warnings[]` | Non-empty warnings mean one or more soft-fail steps were skipped |
| Include `amount` + `createIntent: true` only together | Missing `amount` with `createIntent: true` is a hard 400 error |

---

## 8. One-Call External Integration Endpoint — Audit

> **Status: ✅ EXISTS AND DOCUMENTED**

| Item | Detail |
|------|--------|
| Endpoint | `POST /api/v1/agents/interact` |
| Route file | `src/routes/agentInteract.ts` |
| Mounted in | `src/server.ts` at `/api/v1/agents` |
| Full reference | `docs/AGENT_INTERACT_QUICKSTART.md` |
| API design entry | `docs/API_DESIGN.md` — "Agent Interact" section |
| Framework integration guides | `docs/INTEGRATION_HUB.md` |
| Auth | Bearer API key (`sk_live_…`) — same as all other endpoints |
| Hard fails | 400 on validation error; 401 on missing/invalid key |
| Soft fails | 200 with populated `warnings[]` — caller must check |

No gaps found. The endpoint exists, is tested, is mounted, and is documented in two separate doc files plus the OpenAPI spec (`openapi.yaml`).

---

## 9. Beta Launch Assets Checklist

The items below are required before the public beta announcement goes out.

### Demo recording

- [ ] Record a **30–45 second screen capture** showing the E2E flow:
  1. Register agent via API or dashboard
  2. Execute a paid interaction (one `curl` call or dashboard action)
  3. Show the event appearing in `/network` and the dossier timeline
- [ ] Export at ≥ 1080p, H.264, suitable for direct upload to X and LinkedIn
- [ ] Upload to a durable location (Google Drive, Loom, YouTube unlisted) and note the URL here: ___________

### X (Twitter) launch post

- [ ] Draft written and reviewed — suggested format:

  > Introducing **AgentPay** — the trust infrastructure for AI agents transacting at machine speed.
  >
  > One API call. Any agent. Any runtime.
  >
  > → Register your agent  
  > → Verify identity  
  > → Execute a real paid interaction  
  >
  > agentpay.gg/build 🔗
  >
  > [attach 30-second demo video]

- [ ] Attach the demo recording
- [ ] Tag relevant ecosystem accounts (LangGraph, CrewAI, AutoGPT maintainers) if applicable
- [ ] Schedule or publish at peak engagement time for your audience

### LinkedIn launch post

- [ ] Draft written and reviewed — suggested format (longer form than X):

  > We've been building AgentPay quietly for months. Today it's in beta.
  >
  > AgentPay is payment + trust infrastructure for AI agents. Any agent, any runtime — Clawbot, AutoGPT, LangGraph, CrewAI, or a custom loop — can register, get a verifiable identity, execute real transactions, and build a reputation score in a single API call.
  >
  > What's live today:
  > • Agent registration + KYA (Know Your Agent) identity verification
  > • Escrow-backed agent-to-agent payments (USDC)
  > • Real-time trust scoring via AgentRank
  > • Public network at agentpay.gg/network
  >
  > If you're building AI agents that need to exchange value or earn trust, we want to hear from you.
  >
  > → agentpay.gg/build

- [ ] Attach the demo recording or a static screenshot
- [ ] Publish on founder and company profiles
- [ ] Cross-post link back to the X thread

### Founder title / bio update

- [ ] LinkedIn title updated to reflect beta launch (e.g. "Founder, AgentPay — AI Agent Payment Infrastructure | Open Beta")
- [ ] X/Twitter bio updated with `agentpay.gg` link
- [ ] GitHub profile bio updated if applicable
- [ ] Any other relevant profiles (Product Hunt, AngelList, LinkedIn company page) updated

### Beta invite CTA

- [ ] A clear invite mechanism is live for beta users. Options in order of preference:
  - [ ] Waitlist / beta sign-up form at [agentpay.gg/build](https://agentpay.gg/build)
  - [ ] Direct "Get API key" path on the build page with no friction
  - [ ] A dedicated `/beta` route or modal with a CTA and email capture
- [ ] Beta invite language is consistent across X post, LinkedIn post, and the dashboard landing page
- [ ] Someone is monitoring the registration inbox / waitlist for beta applicants during launch day

---

## Summary

| Section | Status |
|---------|--------|
| 1. Operator & API key setup | — |
| 2. Register test agent | — |
| 3. Verify identity | — |
| 4. Query trust | — |
| 5. Execute paid interaction | — |
| 6. Confirm event visibility (4 surfaces) | — |
| 7. Framework interoperability | ✅ Documented |
| 8. One-call endpoint audit | ✅ Exists and documented |
| 9. Beta launch assets | — |

---

*Last updated: 2026-03-11*
