# Ace Partnership Playbook

This is the founder and CTO playbook for turning a target API into a real Ace partnership.

The goal is not:
- "Can we have your docs?"

The goal is:
- direct booking rights
- reliable change and refund handling
- operational support
- commercial alignment
- a clean path from sandbox to production

For Ace, the partnership itself matters as much as the API.

## What A Typical Partnership Looks Like

Most partnerships move through the same stages:

1. Intro
2. Qualification
3. Sandbox / partner materials
4. Commercial and legal review
5. Integration and certification
6. Limited production access
7. Expansion and deeper commercial terms

### 1. Intro

This is the first contact.

Their question:
- why should we care?

Ace answer:
- Ace is a voice-first travel operating layer
- the customer says the outcome once and Ace handles the rest
- we are starting narrow on ground travel
- we care about booking, monitoring, recovery, and trust
- we are building a serious distribution surface, not a scraping experiment

### 2. Qualification

This is where they decide whether you are credible.

They usually want to understand:
- launch markets
- product category
- consumer vs enterprise
- expected monthly volume
- support ownership
- cancellation and refund handling
- payments model
- whether you are affiliate, reseller, OTA, agent, or platform

### 3. Sandbox / Partner Materials

This is usually the first access layer.

What they may give:
- sandbox API keys
- partner deck
- test credentials
- docs
- display requirements
- branding rules
- rate limits

### 4. Commercial And Legal Review

This is where many integrations really live or die.

Typical items:
- MSA or reseller agreement
- affiliate or rev-share terms
- allowed geographies
- allowed use cases
- ticketing/refund ownership
- support SLA expectations
- data retention rules
- payment and settlement responsibilities

### 5. Integration And Certification

This is where they make sure you won't break their supply or misrepresent the inventory.

Typical asks:
- working demo
- route and fare display review
- booking confirmation review
- cancellation/refund handling review
- webhook / status callback tests
- support escalation path

### 6. Limited Production Access

This is how most good partnerships should start for Ace.

Ideal first production scope:
- a narrow country
- a corridor subset
- a limited product set
- low but real rate limits
- one named support contact

### 7. Expansion

Once the first corridor works:
- increase coverage
- improve economics
- negotiate richer access
- add ancillaries, changes, refunds, seat maps, alerts, and deeper support

## What We Need Before Outreach

Before reaching out, Ace should have a clean packet ready.

### Product Packet

- 3-sentence product description
- 1 short demo video or screenshots
- initial launch markets
- what categories are live now
- what is direct vs ops-backed

### Commercial Packet

- expected launch geography
- expected first 3-month volume range
- support ownership model
- payments model
- who the end customer is

### Technical Packet

- the exact integration surface we need:
  - schedules
  - fares
  - booking
  - ticket issuance
  - cancellations
  - refunds
  - status updates
  - webhooks
- what we already have in place:
  - status screen
  - payment flow
  - recovery flow
  - async booking direction

### Credibility Packet

- why Ace is differentiated
- why voice makes this category better
- why ground travel is the wedge
- why we are starting narrow and serious

## Questions We Should Ask Every Partner

Ask these every time, even if the deck sounds polished.

### Access

- Do you offer sandbox credentials?
- Do you offer production access directly or only through a commercial agreement?
- Are there route, carrier, or geography restrictions?

### Product Scope

- Do you support planning only, or full booking?
- Can we create, confirm, cancel, and refund bookings through the API?
- Do you support seat selection, ancillaries, passenger details, and booking reference retrieval?
- Do you offer status changes, disruption alerts, or webhooks?

### Commercial

- What commercial model do you use?
- Is this affiliate, reseller, white-label, or negotiated API access?
- Are there volume minimums?
- Are there onboarding or certification fees?

### Operations

- Who owns customer support in production?
- How are schedule changes and cancellations communicated?
- What is the escalation path for failed bookings?
- How are refunds and voids handled?

### Technical

- What are your rate limits?
- What auth model do you use?
- Do you offer webhooks?
- What is the expected booking response time?
- Do you support idempotency and retries?

### Trust And Compliance

- Are there display or branding rules?
- Are there caching restrictions?
- What audit/compliance obligations apply?
- Are there settlement, PCI, or fraud requirements we should know up front?

## What We Should Tell Every Partner

This is the Ace positioning line.

Use a version of this consistently:

Ace is building a voice-first travel operating layer. The customer says the outcome once, and Ace handles planning, booking, payment, monitoring, and recovery through one calm interface. We are starting with rail and coach in focused corridors, and we want a direct partner relationship that lets us book, confirm, monitor, and recover journeys reliably.

## Outreach Template

Use this as the default first email.

---

Subject: Partnership enquiry from Ace

Hi {{Name}},

I am the founder of Ace, a voice-first travel operating layer.

Ace lets a customer say what they need once, then handles the trip through one interface: planning, booking, payment, live status, and recovery. We are starting with rail and coach in focused corridors and are looking for direct partner relationships that let us book and manage journeys reliably.

We would like to explore whether there is a fit for:
- sandbox or partner API access
- booking / confirmation support
- cancellation and refund handling
- live status updates or webhooks
- a path to limited production access in our initial markets

We are happy to start narrow and operationally disciplined.

If helpful, I can send a short product overview and the exact markets and journey types we are focused on.

Best,
{{Your name}}
Founder, Ace

---

## How To Run Outreach In Waves

Do not blast everyone at once.

### Wave 1: Core Ground Travel

- Trainline
- National Rail / RDG / Darwin relationships
- IRCTC / India rail channels
- Busbud
- FlixBus

Goal:
- get the core ground layer deeper and more direct

### Wave 2: Payment Allies

- Stripe
- Razorpay
- Airwallex

Goal:
- improve payment, compliance, settlement, and travel support

### Wave 3: Expansion Partners

- Rail Europe
- Distribusion
- G2Rail
- SilverRail
- 12Go
- redBus

Goal:
- expand coverage without changing the Ace product shape

### Wave 4: Adjacencies

- Hotelbeds / Expedia / Booking.com partner channels
- OpenTable
- other premium trip extensions

Goal:
- extend Ace once the movement layer is strong

## How We Should Evaluate A Partner

Do not judge only on docs quality.

Score each partner on:
- booking depth
- refund / cancellation support
- live status support
- sandbox speed
- production onboarding friction
- commercial flexibility
- support quality
- geographic fit
- whether they strengthen the Ace wedge now

## What A Good Early Deal Looks Like For Ace

For our stage, the best partner is usually not the biggest brand.

The best early partner usually gives:
- sandbox quickly
- a human contact
- narrow but real production access
- no crazy volume minimum
- enough booking and refund support to replace ops on a real corridor

## What We Should Avoid

- partnerships that only give static data
- partners who cannot explain cancellation/refund ownership clearly
- commercial terms that force us to overpromise coverage
- integrations that add complexity without replacing manual seams
- brand or display restrictions that make Ace feel second-class

## Founder / CTO Read

The API is only one layer.

What Ace is really building is:
- a distribution relationship
- a support relationship
- a recovery relationship
- and only then a technical integration

If we approach partnerships that way, we will make better deals and build a stronger supply layer.
