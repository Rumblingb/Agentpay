DESIGN TOKENS — Phase B scaffold

Overview

This document describes the minimal design-token scaffold introduced to support the Phase B premium visual pass.
The goal is to provide shared primitives (semantic colors, panel materials, spacing, typography) so components can migrate gradually.

Panel types

- `panel-glass` — Live system surfaces (exchange feeds, live snapshots). Uses subtle translucent background and light blur.
- `panel-ledger` — Identity / registry surfaces (passports, registry lists). A darker, denser surface for ledger-like content.
- `panel-constitutional` — Governance / foundation surfaces. Slightly decorative gradient and violet accent for constitutional elements.

Each panel family exposes CSS variables for background, border, glow, and elevation in `dashboard/app/globals.css`.
Components should prefer the small utility classes:

- `panel-glass`
- `panel-ledger`
- `panel-constitutional`

Spacing tokens

Semantic spacing tokens (defined as CSS variables):

- `--space-section` — large section gap (use `space-section` utility for section-level spacing)
- `--space-card` — card internal padding (use `space-card` utility on panel containers)
- `--space-tight` — tight gaps for compact elements (use `space-tight`)

Color roles

Semantic color roles are defined as CSS variables and exposed to Tailwind:

- `--color-live` → `live` (emerald)
- `--color-ceremony` → `ceremony` (amber)
- `--color-trust` → `trust` (violet)

Typography scale

Tokens:

- `--heading-xl`, `--heading-lg`, `--heading-md`
- `--body-size`
- `--label-size`

Utilities & Tailwind

A root `tailwind.config.cjs` maps these CSS variables to Tailwind tokens so you can use classes like `text-live`, `bg-ceremony`, `shadow-panel-glass`, or `p-card` (via custom spacing names).

Migration guidance

- Do not change layout structure. Replace only ad-hoc background/border/padding declarations on container elements with the corresponding panel utility and `space-card` / `space-section`.
- Migrate components incrementally. Start with low-risk elements (cards, summary tiles), then move to interactive surfaces.
- Keep visual parity during migration; tokens are intentionally conservative in color/opacity.

Notes

- Tokens are additive and non-destructive. They are safe to ship without redesigning pages.
- For production usage, consider adding a small design token README with usage examples (this file is intentionally short).
