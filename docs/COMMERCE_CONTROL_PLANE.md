# AgentPay Commerce Network

Status: founder thesis and locally implemented sandbox. It is not evidence of live merchants, customers, orders, or revenue.

## The Decision

AgentPay will be a demand-led ecommerce network.

Shoppers start with a real-life need, not a category tree or a generic AI textbox. AgentPay applies explicit budget, delivery, return, availability, and evidence rules; ranks eligible products by fit; explains the result visually; and hands the approved item to the merchant's checkout.

Merchants get the other side of the same graph: unmet needs, catalog matches, search and agent-channel readiness, source-grounded product imagery, attribution, and a success-fee ledger.

The promise is:

> Products that fit the moment. Merchants paid for the sale. AgentPay paid for the result.

## First Principles

Catalog access is becoming abundant. Shopify exposes catalog, cart, checkout, order tracking, MCP, and UCP surfaces. Google distributes high-quality merchant data through free listings. OpenAI can rank merchant products from direct and third-party feeds. Another generic catalog gateway is not a durable company.

The scarce things are:

1. A precise statement of what the shopper is trying to accomplish.
2. Current product truth across every place a shopper or agent can discover it.
3. Trust that constraints, sponsorship, price, delivery, and returns were not quietly changed.
4. A low-friction path from discovery to a merchant-owned sale.
5. Evidence that AgentPay caused a completed, non-refunded order.

AgentPay should own those five things.

## The Product Loop

### 1. Need Deck

The consumer chooses a visual outcome such as:

- rain-ready commute
- small-space reset
- a quieter evening
- useful gift under a clear budget

The interface then exposes only the constraints that affect the purchase: budget, arrival window, returns, size or compatibility, and optional values. There is no blank prompt as the primary experience.

### 2. Honest Match

The discovery engine fails closed on:

- stock
- currency
- budget
- delivery deadline
- return window
- catalog freshness
- minimum need fit

Eligible products are ranked by need fit, catalog truth, product quality, budget fit, and returns. Paid placement is disclosed and never changes the organic fit score.

### 3. Choice Receipt

Before checkout, the shopper approves the exact item and total. AgentPay returns a signed decision and attribution draft with no private chat transcript.

### 4. Merchant Checkout

The merchant remains the seller of record in the initial model. The merchant owns checkout, tax, fulfillment, support, returns, fraud, and product claims. AgentPay provides the discovery, approval, evidence, and attribution layer.

### 5. Verified Outcome

AgentPay earns only on an attributed net merchandise sale that survives the merchant's return window.

## Merchant Product

### Demand Radar

Aggregate privacy-conscious need signals into demand indexes. Do not expose an individual's brief or invent demand counts. A merchant sees which needs are rising, how many of its products qualify, and which catalog gaps block a match.

### Catalog Truth

Audit one variant across:

- product landing page
- Schema.org structured data
- Google Merchant
- OpenAI product feed
- UCP
- checkout

Price, currency, stock, title, identifiers, image, shipping, returns, and freshness must agree. The API returns exact blocking and warning codes rather than an AI-written health summary.

### Visual Catalog

Merchants often have strong lifestyle photography but weak channel-ready product assets. AgentPay can reconstruct source-faithful standalone product imagery for merchant review:

1. identify the product from source evidence
2. preserve supported silhouette, material, colour, construction, and visible marks
3. omit uncertain branding and hidden details instead of inventing them
4. generate one inspectable catalog asset per item
5. require human approval before feed publication

This workflow improves customer inspection and feed quality. It must never fabricate a product, certification, feature, logo, or variant.

### Distribution Console

One current product record should drive:

- AgentPay Discover
- Google Merchant and free listings
- server-rendered product structured data
- OpenAI product feeds
- UCP and MCP discovery
- the merchant checkout handoff

The console shows freshness, rejection reasons, clicks, approved handoffs, completed orders, returns, and settled fees by channel.

## Revenue Model

Initial proposal: 8% success fee on net merchandise value after the return window.

The fee base excludes tax, shipping, tips, gift-card value, cancelled items, and refunded items. A fully refunded order earns AgentPay zero. Partial refunds reduce the fee base.

Example for a GBP 100 merchandise order:

- merchant gross merchandise value: GBP 100
- AgentPay success fee: GBP 8 after the return window
- merchant remainder: GBP 92 before processor fees, tax obligations, fulfillment, and other merchant costs

Activation requires a signed merchant agreement, attribution rules, refund webhooks, reconciliation, and an approved payment configuration.

### Payment Architecture

Phase 1 uses merchant-owned checkout plus a signed referral token and verified conversion webhook. This is operationally lighter and keeps the merchant as seller of record.

Phase 2 may use Stripe Connect direct charges with an application fee when the merchant, account configuration, countries, contracts, refunds, disputes, and tax treatment have been reviewed. Destination charges must not be enabled casually because charge type affects merchant-of-record and loss responsibility.

## SEO And Agent Discovery

SEO is product infrastructure, not a copywriting pass.

### Product Pages

- Render useful product content and JSON-LD in initial HTML.
- Use `Product` plus `Offer` only on a page where the visitor can purchase from the seller represented on that page.
- Use product-snippet markup on editorial or referral comparison pages that do not sell the item directly.
- Give each important variant and currency a stable canonical URL.
- Use `ProductGroup`, `hasVariant`, `variesBy`, and `productGroupID` for real variants.
- Include price, availability, brand, GTIN or MPN, condition, shipping, returns, colour, size, material, and high-resolution images when applicable.
- Keep feed, landing-page, structured-data, and checkout values synchronized.
- Never index sandbox fixtures or fabricate reviews, ratings, scarcity, discounts, or product claims.

### Discovery Feeds

- Submit complete, current product data to Google Merchant for free listings.
- Use canonical links, strong product identifiers, multiple inspectable images, and intraday updates where stock changes quickly.
- Provide direct OpenAI feeds when eligible; Shopify merchants can rely on Shopify Catalog integration while still using AgentPay for matching and attribution.
- Expose need-led discovery and catalog audit through MCP for Codex, Claude, Hermes, and other assistants.
- Support UCP merchant handoff without building another generic UCP gateway.

### Search Architecture

- Index real product detail and useful need pages, not every filter combination.
- Canonicalize or block low-value faceted URLs to prevent crawl waste.
- Generate sitemaps from live approved inventory only.
- Use descriptive image filenames and alt text grounded in the actual product.
- Measure impression to product view, product view to approved handoff, handoff to order, return rate, settled fee, and truth-related rejection by channel.

Primary references:

- [Google merchant listing structured data](https://developers.google.com/search/docs/appearance/structured-data/merchant-listing)
- [Google product structured data](https://developers.google.com/search/docs/appearance/structured-data/product)
- [Google free listings](https://support.google.com/merchants/answer/13889434)
- [OpenAI shopping product selection](https://help.openai.com/en/articles/11128490-shopping-with-chatgpt-search)
- [Shopify agent and UCP surfaces](https://shopify.dev/docs/agents)
- [Stripe platforms and marketplaces](https://docs.stripe.com/connect/saas-platforms-and-marketplaces)
- [Stripe direct-charge merchant responsibility](https://docs.stripe.com/connect/payment-links)

## AI Policy

AI may:

- map structured product attributes to a shopper need
- improve a merchant draft title or description with disclosure and approval
- identify likely feed gaps
- reconstruct a source-grounded product image for merchant review
- explain tradeoffs after deterministic ranking

AI may not:

- invent product facts, reviews, ratings, certifications, stock, delivery, returns, or demand
- change a hard shopper rule
- blend sponsored and organic ranking
- decide that a payment was successful
- publish generated feed content without merchant approval
- infer a fee or refund from an unverified event

## Network Flywheel

1. Need Deck interactions create privacy-conscious demand signals.
2. Demand Radar tells merchants what qualified shoppers cannot yet find.
3. Catalog Truth and Visual Catalog improve merchant supply.
4. Better supply improves Google, agent, and AgentPay discovery.
5. Better matches improve approved handoff and completed-order rates.
6. Verified orders fund AgentPay through success fees.
7. Outcome evidence improves future ranking without selling rank.

## Validation Gates

This is not validated yet. Continue only when all of these occur:

- 30 qualified shoppers complete a need brief
- at least 40% open a merchant checkout from a match
- 10 merchants provide real catalog access
- 5 merchants pass Catalog Truth on at least 20 live variants
- 3 merchants sign the 8% post-return-window success-fee agreement
- 10 attributed test orders reconcile correctly through refunds and returns
- at least 60% of interviewed shoppers prefer need-led discovery to category search for the tested purchase

Change or stop the model when:

- merchants will not grant conversion and refund evidence
- customers prefer a normal category or search experience for the chosen wedge
- the take rate cannot cover acquisition, support, disputes, and feed operations
- merchants attribute no incremental conversion to AgentPay
- truth and visual operations require unscalable manual work

## Launch Sequence

1. Ship the local Discover, Seller, Catalog Truth, and Visual Catalog sandbox.
2. Test the discovery API, signed reports, MCP tools, provider adapters, and responsive flows.
3. Recruit ten design merchants in one narrow wedge: independent UK commute and small-space products.
4. Import real inventory read-only and audit it before any public listing.
5. Run a concierge cohort with merchant checkout and manual post-return reconciliation.
6. Sign the first three success-fee agreements before enabling automated fee collection.
7. Publish real product and need pages only after inventory, claims, canonical URLs, and merchant consent are verified.
8. Expand categories only when the first wedge has repeat purchase intent, positive unit economics, and reliable support.

## Kill List

Do not build:

- a general AI shopping chatbot
- a category marketplace with no demand advantage
- undisclosed affiliate ranking
- AgentPay custody or merchant-of-record complexity before legal and operational proof
- fake social proof or unverified demand counters
- autonomous catalog publishing
- a second payment processor
- broad consumer personalization that requires private conversation storage

Every feature must improve need capture, product truth, customer confidence, merchant conversion, or verified attribution.
