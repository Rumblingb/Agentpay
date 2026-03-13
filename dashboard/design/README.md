Design brief — AgentPay UI rebrand (minimal, high-signal)

Goal
- Transform the homepage into a minimal, "$10B AI application" interface: high signal, low noise, modern terminal/console aesthetic.
- Preserve backend APIs and demo data surface; only change presentation.
- Provide accessible, reduced-motion defaults and a global preference.

Core principles
- Reduce information density: surface only essential top-level product signals.
- Emphasize the Live Exchange tape as the primary product surface.
- Strong typographic hierarchy: large numeric and tabular fonts for scores and tape; use Fira Code for live tape.
- Calm motion: slow, subtle drift; provide a persisted "Reduce motion" toggle.
- Clear CTAs: one primary (Enter Exchange), one secondary (Docs/Registry).

Palette & visual tokens
- Background: near-black (#000/gray-900)
- Accent 1: Emerald (primary) — #10B981 (used for CTA and highlights)
- Accent 2: Violet (secondary glow) — #8B5CF6 (subtle highlights)
- Surface: glassy dark panels with faint borders and soft ambient glows
- Typography: Inter (UI), Fira Code (tape)

High-level layout (homepage)
- Header: compact, functional, keeps nav links (Network, Registry, Market, Docs, Open App)
- Hero: short one-line headline + single bold CTA
- Live Exchange: full-bleed panel, calmer tape (default slower speed), compact height, hover-pause, reduced-motion aware
- Spotlight: single passport card with key metrics and CTA to view registry
- Footer: single-line copyright and small link

What to remove / collapse
- Remove chip row below hero (TravelAgent → FlightAgent etc.).
- Collapse Constitutional institutions into a single "Governance" summary card with modal deep-dive.
- Reduce passports to one highlighted card; move others to `/registry`.
- Reduce FlowRail motion and prominence; make it a subtle micro-interaction or optional replay.

Accessibility
- Add a persisted `reducedMotion` preference (localStorage) exposed as a hook `useReducedMotion()`.
- `LiveNetworkFeed` must respect `reducedMotion` and prefer `animation-play-state: paused` or a very slow speed when true.
- Ensure aria-live region is present; provide clear keyboard-focusable controls for toggles.

Compatibility checklist
- Do not change API endpoints (`/api/agents/feed`) or demo data functions (`getCanonicalFlowTrace`, `CONSTITUTIONAL_AGENTS`, `SAMPLE_PASSPORTS`) without adapters.
- Preserve `LiveNetworkFeed` props (`compact?`, `speed?`, `paused?`) — we may add `reducedMotion` but keep backwards compatibility.

Deliverables in this folder
- `homepage_mockup.svg` — high-level homepage wireframe
- `feed_mockup.svg` — live tape mockup and behavior notes

Next steps
1. Sign off on the design mockups here.
2. I will implement a first-pass `page.tsx` skeleton and update `LiveNetworkFeed` to respect reduced motion.
3. Run tests, start dev server, capture final screenshots, and open a PR for review.
