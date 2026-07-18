# AgentPay Commerce Kit

## Founder Decision

AgentPay will focus on one product:

> A customizable, provider-neutral checkout and approval kit for applications with AI agents.

It is the platform-side experience between an agent's recommendation and the merchant's existing checkout. A developer should be able to add safe ecommerce to a web, mobile, chat, or MCP agent without building bespoke approval UX, payment-provider logic, protocol adapters, or receipts.

The memorable developer promise is:

> Give your agent a checkout, not a card.

## Buyer

The first buyer is not a frontier lab and not a consumer.

The first buyer is a small or mid-sized team building:

- a vertical shopping agent
- an AI concierge with purchasable products
- a marketplace or recommendation app
- a branded merchant agent on a custom commerce stack
- an internal procurement agent that needs an approval surface

They pay because checkout is consequential, category-specific, visually sensitive, and expensive to rebuild across agents, providers, and devices.

## Product

### Catalog Truth

AgentPay audits whether a product tells the same truth everywhere an agent or search engine can encounter it:

- merchant landing page
- Schema.org `Product` and `Offer` data
- Google Merchant feed
- OpenAI or other direct product feed
- UCP catalog and checkout
- final merchant checkout

The audit detects price, currency, availability, title, identifier, shipping, return, image, freshness, and required AI-content disclosure problems. This is the SEO and AI-discovery foundation: accurate structured data and channel consistency, not generated keyword pages or ranking promises.

The merchant view should answer three questions for every product: Can search understand it? Can an agent recommend it with current evidence? Will checkout honor what was shown?

### Commerce Surface

A React and React Native component kit renders a complete flow from structured commerce state:

1. request and constraints
2. product comparison
3. exact approval ledger
4. merchant-owned checkout handoff
5. signed return receipt

It is schema-driven but not model-generated HTML. The developer chooses safe components and configuration; AgentPay controls invariant money and approval states.

### Customization

Customization is the wedge, not an afterthought:

- merchant logo, typography, color tokens, density, and light/dark modes
- category schemas for size, fit, format, delivery, returns, subscriptions, and warranties
- fields that must appear before approval
- approval rules and copy
- native, embedded, drawer, modal, or chat-card presentation
- localization, currency, tax, shipping, and accessibility settings
- slots for merchant content without allowing scripts or arbitrary checkout logic
- lifecycle event hooks and analytics adapters that exclude payment credentials

The same books and clothing fixture must visibly prove category customization while preserving one commerce contract.

### Commerce Gateway

The backend translates one AgentPay contract into the merchant's existing path:

- UCP checkout and order flows
- ACP-compatible merchant checkout
- AP2-compatible mandate and receipt evidence
- direct merchant checkout URLs
- Stripe, Airwallex, and future provider adapters

AgentPay is not merchant of record and does not require a merchant to replace its processor.

### Choice Receipt

Before checkout, AgentPay applies deterministic buyer rules to structured candidates and signs the result. AI can research and explain, but code enforces:

- amount and currency
- category and merchant policy
- delivery and return requirements
- evidence freshness
- approval mode and expiry
- one-time mandate binding

The Choice Receipt is useful because the agent developer can prove what was shown and approved without storing a private chat transcript.

### Commerce Lab

Every integration gets a local sandbox and conformance harness:

- product fixtures and failure fixtures
- UCP/MCP capability negotiation
- schema validation
- signature and idempotency tests
- checkout return and webhook simulation
- visual regression across desktop and mobile
- a shareable trace for support

This is part of the product because a checkout SDK that cannot be tested safely will not be adopted.

## Why Not A Generic UCP Gateway

Shopify now provides self-serve UCP and catalog infrastructure. UCPhub already provides UCP core, WooCommerce connectors, reference agents, observability, and additional platform connectors. WooCommerce is building native MCP and agentic checkout support.

Competing as another protocol connector would be late and weak. AgentPay should consume those systems and own the customizable agent-app experience they feed.

## Competitive Position

- Shopify owns Shopify merchant supply.
- UCPhub connects non-Shopify merchant systems to UCP.
- Stripe owns payment credentials, fraud tooling, and processor-integrated checkout.
- AgentPay gives agent applications a polished, white-label commerce UI and deterministic approval contract across merchant systems and payment providers.

The moat, if earned, is the component contract, category templates, cross-provider reliability, integration telemetry, and developer distribution through MCP and SDKs. The current codebase alone is not a moat.

## Validation Before Expansion

This idea is not validated yet. Books and clothing are test fixtures, not market proof.

### Riskiest Assumptions

1. Agent-app teams want an external checkout UI kit instead of building a narrow flow themselves.
2. Provider neutrality and customization matter enough to beat Stripe-hosted or merchant-hosted checkout.
3. UCP/ACP adoption creates platform-side UI work faster than commerce platforms absorb it.
4. Teams will pay for the kit before agent-originated order volume is large.

### Validation Artifact

Ship one excellent public sandbox with:

- a five-minute MCP/API quickstart
- a theme and category configurator
- books and clothing using the same contract
- explicit approval and merchant handoff
- a signed receipt inspector
- failure simulation for stale price, changed total, expired mandate, duplicate retry, and unsigned webhook
- copy-paste React integration code

### Pass Gates

Continue investing only after all of these occur:

- 10 external developers start the sandbox
- 5 complete the full integration without founder help
- median time to first rendered checkout is under 30 minutes
- 3 connect a real or realistic merchant checkout
- 2 agree in writing to pay at least GBP 79 per month or an equivalent usage price
- at least 60% say customization or provider neutrality is a top-three reason to choose AgentPay

### Failure Gates

Change or stop the wedge when any of these remain true after 20 qualified conversations:

- developers prefer redirecting to merchant checkout and do not need an agent-native surface
- teams will use it only for free hackathon demos
- UCP reference components satisfy the need
- customization adds implementation cost without improving conversion or trust
- no team accepts a paid design-partner offer

## Initial Pricing Test

- Sandbox: free, local fixtures, one theme, community support
- Builder: GBP 79/month, production sessions, five themes, receipts, webhooks, and 10,000 evaluations
- Platform: GBP 399/month, multiple merchants, custom category schemas, environment controls, and support
- Enterprise: negotiated SSO, regional retention, audit exports, and SLOs

Do not add a transaction percentage until AgentPay demonstrably improves conversion or reduces loss. Do not claim customers or revenue without direct source evidence.

## Build Order

1. Finish the polished web sandbox and visual configurator.
2. Publish the stable commerce schema and Choice Receipt test vectors locally.
3. Add the React package inside the existing monorepo.
4. Bind the component to the existing provider-neutral intent API.
5. Add MCP setup and one end-to-end example for Codex and Claude.
6. Run the external validation gates before React Native, more categories, or more commerce connectors.

## Kill List

Do not add:

- consumer subscriptions
- a general AI shopping assistant
- another product catalog or marketplace
- custody, wallets, trading, or merchant-of-record complexity
- broad multi-agent orchestration
- category-specific apps
- affiliate-ranked recommendations

Every primary feature must make agent checkout easier to integrate, more customizable, safer to approve, or easier to verify.
