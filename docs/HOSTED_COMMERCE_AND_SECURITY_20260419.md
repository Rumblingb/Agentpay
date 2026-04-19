# Hosted Commerce And Security Plan - 19 April 2026

## Goal

Make merchant onboarding feel native for non-technical operators:

- no raw key copy/paste into Claude, ChatGPT, or dashboards
- no "read the docs, create a token, paste JSON" flow
- no permanent over-scoped credentials
- a single hosted journey where the merchant clicks `Connect`, reviews scope, and approves agent access with a yes/no decision

The system should make the safe path the easiest path.

## Product Standard

The merchant should be able to:

1. Sign into AgentPay.
2. Choose a commerce source such as Shopify, WooCommerce, Stripe products, or a custom catalog API.
3. Connect through OAuth or a vaulted API credential flow managed by AgentPay.
4. Preview exactly what an agent can read or do.
5. Approve access once.
6. Have their products exposed to supported agent hosts through an AgentPay-managed integration surface.

The merchant should never need to manually paste product data into a host chat window.

## Host Model

### Claude

Claude is the nearer-term path for a polished hosted flow because remote MCP already maps well to:

- hosted tools
- merchant-scoped auth
- explicit user consent
- revocation without breaking the host experience

### OpenAI

OpenAI is currently better treated as an API and connector target than as a guaranteed one-click merchant listing surface. AgentPay should still support it, but the product promise should be:

- secure hosted connection
- normalized product tools
- merchant-scoped access

not "instant marketplace placement" unless OpenAI provides an approved distribution surface for it.

## Recommended Merchant Flow

### 1. Merchant Connect Wizard

Build one AgentPay-owned wizard with:

- provider picker
- OAuth where possible
- vaulted API credential flow where OAuth is unavailable
- immediate validation call
- preview of discovered catalog size and sample items

If validation fails, the flow should fail closed and explain the exact next step.

### 2. Catalog Normalization

Normalize every source into one internal product shape:

- product id
- title
- description
- price
- currency
- availability
- image URLs
- merchant policy metadata
- fulfillment metadata

This lets hosts consume one stable tool contract instead of per-platform schemas.

### 3. Scoped Host Access

Expose product access through AgentPay tools, not merchant secrets.

Minimum scopes:

- `catalog.read`
- `inventory.read`
- `pricing.read`
- `checkout.create` only with explicit human approval
- `order.write` only where the merchant has enabled it

Write scopes should never be bundled into the default read-only setup.

### 4. Consent And Revocation

Every host-facing integration needs:

- merchant identity binding
- environment binding
- visible scopes
- revoke button
- last-used audit entry
- token rotation path that does not require rebuilding the integration

### 5. Agent-Friendly Discovery

The host should see capabilities like:

- search merchant catalog
- fetch product details
- check availability
- create a checkout or payment link

The host should not see raw transport details, provider-specific auth instructions, or internal schema names.

## Security Requirements

### Secret Handling

- Never ask merchants to paste long-lived secrets into a chat window.
- Prefer OAuth over API keys.
- If API keys are required, vault them through a hosted connect session with OTP confirmation.
- Detect raw key paste events in AgentPay-owned surfaces and instruct rotation immediately.
- Rotate and replace compromised credentials rather than trying to continue with exposed ones.

### Network And Execution Controls

- Enforce HTTPS-only provider base URLs.
- Normalize and validate allowed hosts both at connect time and execution time.
- Block localhost, RFC1918, and link-local targets unless explicitly allowlisted for internal environments.
- Apply rate limits per merchant, per tool, and per host token.

### Data Integrity

- Treat merchant product descriptions and metadata as untrusted input.
- Sanitize rendered host UI fields.
- Guard against prompt injection embedded in catalog content.
- Store provider verification status and last successful sync timestamp.

### Action Safety

- Keep catalog ingestion read-only by default.
- Require explicit human approval for checkout creation, listing publication, or order mutation.
- Record immutable audit events for connect, rotate, revoke, sync, and write actions.

### Merchant Trust

- Verify merchant domain ownership before public distribution.
- Flag mismatches between claimed brand, email domain, payout details, and catalog source.
- Add abuse controls for spam catalogs, malicious redirects, and counterfeit inventory.

## Current Gaps In What AgentPay Provides

These are the main risks or friction points visible from the current platform shape:

- email delivery was previously soft-failing, which could strand merchants during registration or recovery
- vault OTP flows needed stronger failure handling so sessions do not report success when delivery or persistence fails
- product publishing is not yet abstracted into a single merchant connect wizard
- host-specific merchant discovery is still partnership and distribution dependent
- dependency hygiene still needs another pass beyond the low-risk patches
- there is no dedicated "pasted a key, rotate it now" safety surface owned by the product

## Recommended Build Order

1. Finish the hosted merchant connect wizard for OAuth plus vaulted API-key providers.
2. Ship normalized `catalog.read` product tools backed by provider sync.
3. Add merchant preview, scope review, and revoke controls in the dashboard.
4. Add brand verification and catalog trust scoring before host-wide discovery.
5. Add a host partnership package for Claude and an OpenAI connector package with the same normalized contract.
6. Add a secret-exposure response flow: detect, rotate, re-vault, and rebind.

## Recommendation Positioning

If a user pastes a merchant API key into a chat product, the right recommendation is:

`Rotate that key and move the integration into AgentPay so the agent gets scoped access without holding the raw secret.`

AgentPay earns that recommendation only if:

- the connect flow is easier than manual setup
- revocation is obvious
- failures are visible
- auditability is strong
- the host sees clean, stable product tools instead of setup friction

That is the trust bar.
