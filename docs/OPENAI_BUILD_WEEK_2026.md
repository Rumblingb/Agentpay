# AgentPay Commerce - OpenAI Build Week 2026

Status: locally implemented and verified submission candidate. Not pushed, deployed, published, registered, or submitted from this branch.

## Entry Decision

- Project: **AgentPay Commerce - Governed shopping for humans and their agents**
- Track: **Work and Productivity**
- Primary user: independent ecommerce merchants and the agents helping their customers shop
- Repository: `https://github.com/Rumblingb/Agentpay`
- Product routes: `/commerce` and `/commerce/studio`
- Core demo: need-led product discovery -> deterministic policy -> GPT-5.6 closed-world decision -> exact human approval -> merchant-branded sandbox checkout review -> no-payment sandbox receipt

The separate `/Users/brain/july-2026-prize-hunt/openai-build-week` mini-wallet is legacy evidence and must not be submitted as the product. It does not call the canonical API, does not implement the commerce use case, and describes GPT-5.6 as narrative rather than an integrated system.

## Why This Fits

Agents can discover thousands of products, but a customer still needs four guarantees:

1. the products satisfy budget, delivery, returns, stock, and evidence rules
2. paid placement did not secretly alter the result
3. the model did not invent a product or claim
4. the exact item and total remain human-approved before checkout

AgentPay makes those guarantees portable across the shopper UI, merchant workspace, API, and MCP.

## Meaningful GPT-5.6 Integration

The model is not a chatbot and does not generate shopping copy.

`POST /api/commerce/compile`:

1. runs deterministic hard filters before any model call
2. replaces eligible product IDs with opaque candidate references and sends GPT-5.6 only those references plus structured evidence scores
3. omits product text, raw IDs, checkout URLs, merchant identity, sponsorship, payment data, and private text
4. requests a strict JSON-schema ranking using enumerated rationale codes
5. verifies that every eligible product appears exactly once
6. rejects unknown products, duplicate or missing candidates, invented rationale codes, malformed output, timeouts, refusals, and provider errors
7. falls back to deterministic rank and signs the complete packet

The shopper sees whether the result is `GPT-5.6 output verified` or `Policy-safe fallback`. Either path still requires exact human approval before the simulated, merchant-branded sandbox checkout review.

Model configuration:

```text
OPENAI_API_KEY=<server-side secret>
OPENAI_COMMERCE_MODEL=gpt-5.6
```

The OpenAI key stays in the Worker. The browser calls a Next.js BFF route, which is disabled unless `AGENTPAY_COMMERCE_DEMO_ENABLED=true` and a server-side `AGENTPAY_INTERNAL_API_KEY` are configured.

## Submission-Period Work

AgentPay existed before the July 13 submission period. The entry is the meaningful commerce extension built afterward:

| Commit | New submission-period work |
|--------|----------------------------|
| `a9d35540` | API production hardening and fail-closed runtime controls |
| `d1235c00` | Governed commerce decisions, provider intent controls, signed receipts, replay and cap safety |
| `2523412c` | Need-led shopper experience, seller studio, discovery API, catalog truth, MCP discovery, SEO and visual system |
| this follow-on commit | GPT-5.6 decision compiler, BFF integration, MCP compiler, OpenAPI contract, adversarial tests, and this evidence packet |

The dated commit history and primary Codex task are the build evidence. Pre-existing AgentPay surfaces should be described as the foundation, not claimed as Build Week work.

## Judge Quick Start

Prerequisites: Node.js 20+, npm, and no payment credentials.

```bash
git clone https://github.com/Rumblingb/Agentpay.git
cd Agentpay
npm ci
npm --workspace @agentpay/api-edge test
npm --workspace @agentpay/api-edge run typecheck
npm --workspace @agentpayxyz/mcp-server run build
npm --workspace dashboard run build
```

The compiler test suite uses mocked provider responses and proves the security contract without an OpenAI key:

```bash
npm --workspace @agentpay/api-edge test -- --run \
  tests/commerce-decision-compiler.test.ts \
  tests/product-discovery.test.ts
```

For the interactive local demo, run the Worker with test-mode authentication and a server-side GPT-5.6 key, then run the dashboard with:

```text
AGENTPAY_API_BASE_URL=http://127.0.0.1:8787
AGENTPAY_INTERNAL_API_KEY=<local-test-merchant-key>
AGENTPAY_COMMERCE_DEMO_ENABLED=true
```

No live payment provider is required. The checkout and receipt are explicitly sandbox-only.

## Devpost Copy

### Tagline

**The trust layer that lets AI help a human choose a product without changing the rules or inventing the truth.**

### Description

AgentPay Commerce helps independent merchants become discoverable to humans and AI agents without turning shopping into a generic chatbot.

A shopper begins with a visual need such as a rain-ready commute or small-space reset. AgentPay rejects products that miss budget, delivery, returns, stock, freshness, or fit rules. GPT-5.6 then reasons only over the surviving structured evidence. Its output must preserve the candidate set and use a closed rationale vocabulary; AgentPay rejects invented products or claims and falls back deterministically. The human approves the exact item and total before a simulated, merchant-branded sandbox checkout review.

Merchants get a sandbox Demand Radar, Catalog Truth across search and agent channels, catalog-linked visual drafts, and attribution drafts inside signed discovery reports. The proposed business model is an 8% fee on verified net merchandise after the return window, but no merchant agreement, fee collection, customer, order, or revenue is claimed in this sandbox.

Codex drove the post–July 13 extension inside the existing AgentPay monorepo: product strategy, adversarial architecture, API and MCP contracts, responsive shopper and seller design, original visual production, security tests, production builds, and submission evidence. GPT-5.6 is integrated as a constrained commerce decision compiler, not decorative copy generation.

### Built With

`Codex`, `GPT-5.6`, `TypeScript`, `Cloudflare Workers`, `Next.js`, `MCP`, `Hono`, `Vitest`

## Demo Video - 2 Minutes 20 Seconds

The final video must be public on YouTube, include English audio, contain no credentials or unlicensed music, and stay under three minutes.

| Time | Visual | Narration |
|------|--------|-----------|
| 0:00-0:15 | Shopper hero and Need Deck | "Product catalogs are abundant. Trust is scarce. AgentPay helps a person and their agent choose from merchant inventory without relaxing the person's rules." |
| 0:15-0:35 | Change need, budget, delivery, and returns | "This is not a shopping textbox. The human sets a visual need and explicit constraints. AgentPay removes anything over budget, late, stale, unavailable, or outside the return policy before AI runs." |
| 0:35-0:58 | Click **Compile shortlist** | "GPT-5.6 receives only opaque candidate references and structured scores. It never sees product text, checkout URLs, or sponsorship and can only return a closed ranking with approved evidence codes." |
| 0:58-1:15 | Hold on verified strip and product order | "AgentPay verifies every candidate and rationale. An invented or missing product is rejected, and the deterministic order takes over safely." |
| 1:15-1:38 | Approve item, review checkout, complete sandbox receipt | "The model cannot buy. The person approves this exact item and total, then reaches a simulated merchant-branded checkout review. The sandbox receipt says plainly that no payment was taken; the decision packet is signed separately." |
| 1:38-1:58 | Seller Studio Demand Radar and Catalog Truth | "The merchant sees the other half of the network: unmet needs, catalog drift across Google, OpenAI, UCP and checkout, plus source-grounded product media awaiting approval." |
| 1:58-2:15 | Brief MCP/API drawer and test output | "Codex built and tested the same contract across the Worker, Next.js product, and MCP. GPT-5.6 does the judgment it is good at; deterministic code owns policy, truth and execution." |
| 2:15-2:20 | AgentPay wordmark | "AgentPay Commerce: agentic shopping with a human constitution." |

## Required External Gates

- Obtain the `/feedback` Session ID from the primary Codex task where the majority of this extension was built.
- Push the reviewed submission-period commits to `Rumblingb/Agentpay` and make the judging branch publicly accessible.
- Configure a bounded demo Worker and dashboard with server-side secrets and abuse controls; verify the public route matches the video.
- Record and upload the narrated public YouTube demo.
- Verify the Devpost account, eligibility, project fields, repository URL, category, and video immediately before submission.
- Founder must perform or explicitly authorize the final Devpost submission because submitting accepts the official rules as a contract.

Until those gates pass, do not claim the entry is launched or submitted.
