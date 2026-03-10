# Metadata Alignment — Phase B Summary

> **Date:** 2026-03-10  
> **Phase:** B — Metadata Truth Alignment  
> **Preceded by:** `docs/METADATA_AUDIT.md` (audit-only, committed before this pass)  
> **Status:** Complete

---

## What Changed

### Root `package.json`

| Field | Before | After |
|-------|--------|-------|
| `author` | `"Your Name"` (placeholder) | `"AgentPay"` |
| `description` | `"Universal payment gateway for AI agents"` | `"Trust and payment infrastructure for AI agent-to-agent commerce — AgentRank scoring, A2A escrow, multi-protocol payments, and agent identity"` |
| `homepage` | *(missing)* | `"https://github.com/Rumblingb/Agentpay#readme"` |
| `bugs` | *(missing)* | `{"url": "https://github.com/Rumblingb/Agentpay/issues"}` |
| `repository.url` | `"https://github.com/Rumblingb/Agentpay"` | `"git+https://github.com/Rumblingb/Agentpay.git"` |
| `keywords` | `["payments","ai-agents","x402","fintech"]` | Added `"agentpay"`, `"escrow"`, `"agentrank"`, `"trust"`, `"a2a"` |
| `scripts.clean` | `"if exist dist rmdir /s /q dist"` (Windows CMD — broken on Linux/macOS/CI) | `"rm -rf dist"` |

---

### `cli/agentpay/package.json`

| Field | Before | After |
|-------|--------|-------|
| `version` | `"1.0.0"` (inflated — implied GA) | `"0.1.0"` (honest Alpha) |
| `engines.node` | `">=18.0.0"` | `">=20.0.0"` (aligned with root) |
| `repository` | *(missing)* | `{"type":"git","url":"git+https://github.com/Rumblingb/Agentpay.git"}` |
| `homepage` | *(missing)* | `"https://github.com/Rumblingb/Agentpay/tree/main/cli/agentpay#readme"` |
| `bugs` | *(missing)* | `{"url": "https://github.com/Rumblingb/Agentpay/issues"}` |

### `cli/agentpay/index.js`

`getApiBase()` now checks `AGENTPAY_API_BASE` (new, per review feedback) before the existing `AGENTPAY_API_URL`, then the saved config, then falls back to `agentpay-api.onrender.com`. Default is **unchanged** — see rationale below.

### `cli/agentpay/README.md`

Replaced hardcoded Vercel preview URL `apay-delta.vercel.app` with canonical dashboard URL `dashboard.agentpay.gg`.

---

### `sdk/js/package.json`

Added missing fields: `repository` (with `"directory": "sdk/js"` for monorepo), `homepage`, `bugs`.

### `sdk/js/README.md`

`agentpay.io` → `agentpay.gg` in the homepage link.

---

### `sdk/python/pyproject.toml`

Added `[project.urls]` section: `Repository`, `Homepage`, `Bug Tracker`. These were missing entirely, meaning PyPI would show no source links.

### `sdk/python/README.md`

`agentpay.io` → `agentpay.gg` in the homepage link.

---

### `dashboard/package.json`

| Field | Before | After |
|-------|--------|-------|
| `name` | `"dashboard"` (generic placeholder) | `"agentpay-dashboard"` |
| `description` | *(missing)* | `"AgentPay merchant and agent management dashboard"` |
| `private` | *(missing)* | `true` (prevents accidental npm publish) |

### `dashboard/README.md`

Replaced the full Next.js `create-next-app` boilerplate (which mentioned "Geist font" and linked to generic Next.js tutorials) with AgentPay-specific content: purpose, local dev setup, build instructions, and deployment note.

---

### `docs/SDK_STRATEGY.md`

Fixed Python minimum version in the SDK overview table: `3.8+` → `3.10+`, matching `pyproject.toml`.

### `docs/sdk/js.md`

All `https://api.agentpay.io` examples updated to `https://api.agentpay.gg`.

### `docs/sdk/python.md`

All `https://api.agentpay.io` examples updated to `https://api.agentpay.gg`.

---

### `sdk/examples/quickstart.js`

Install comment: `npm install agentpay-sdk` → `npm install @agentpay/sdk`. The package `agentpay-sdk` does not exist on npm; the correct scoped name is `@agentpay/sdk`.

### `sdk/agentpay.ts`

Added a `NOTE — package boundary` section to the module JSDoc. This clarifies that this file is a monorepo server-side helper (used from `src/`), not the published npm package. External consumers should use `npm install @agentpay/sdk` (`sdk/js/`).

---

## What Was Intentionally Left Unchanged

| Item | Reason |
|------|--------|
| `src/server.ts` `API_VERSION = '1.0.0'` | This is the wire-format version returned in `/health` and `/status` responses. Changing it would alter public API responses. Left as-is; it is not an npm metadata field. |
| `scripts.test` `--forceExit` in root `package.json` | Required — `pg.Pool` keeps connections alive after tests and prevents Jest from exiting cleanly. See project memory for context. |
| JS SDK version `0.2.0` | The SDK may version separately from the root server. `0.2.0` is honest and not inflated. |
| CLI default API base `agentpay-api.onrender.com` | Per review feedback (C8): do NOT swap the default to `api.agentpay.gg` until DNS is confirmed live. A bad default in a published CLI package would silently break every install. The `AGENTPAY_API_BASE` env var now provides a safe migration path. |
| CLI `publishConfig.access: "public"` | This is correct — `agentpay-cli` is a scoped-or-unscoped public package. No change needed. |
| Python SDK `authors: [{name: "AgentPay"}]` | Already correct before this phase. |
| `docs/INTEGRATION_HUB.md` `npx agentpay init` | The CLI does not yet have an `init` command. Fixing this would require either adding the command or modifying an operational doc — both are feature/scope work, not metadata alignment. Recorded in audit; deferred. |

---

## Domain Canonical Decision

`agentpay.gg` is the canonical domain. Evidence: legal documents, server CORS config, security contact email (`security@agentpay.gg`), onboarding guide.

`agentpay.io` appeared only in SDK docs and README links — stale from an earlier draft. All `.io` references in SDK docs and code examples are now `.gg`.

The CLI and server runtime code (which hardcodes `agentpay-api.onrender.com` as the default) is excluded from this domain change for safety (see C8 rationale above).

---

## Unresolved Issues

| # | File | Issue | Disposition |
|---|------|-------|-------------|
| U1 | `docs/INTEGRATION_HUB.md` | References `npx agentpay init` — a command that does not exist in the CLI | Deferred. Requires CLI feature work or doc removal. Out of scope for Phase B. |
| U2 | `sdk/agentpay.ts` vs `sdk/js/` | Two separate SDK entry points with different APIs exist in `sdk/`. The `sdk/agentpay.ts` file is a server helper; `sdk/js/` is the published package. The boundary is now documented but the structural question remains open. | Deferred to SDK consolidation phase. |
| U3 | `cli/agentpay/index.js` default API URL | `agentpay-api.onrender.com` default will need updating when `api.agentpay.gg` DNS is confirmed. | Deferred. Operator can use `AGENTPAY_API_BASE` env var in the meantime. |

---

## Follow-up Work for Later Phases

- **Phase C (README truth pass):** Several sections of the root README reference features, statuses, and docs that may need updating after Phase B.
- **CLI `init` command:** Either add `agentpay init` to the CLI or remove references from `docs/INTEGRATION_HUB.md`.
- **Domain cutover:** Once `api.agentpay.gg` DNS is confirmed, update the CLI default in `index.js` and the `agentpay config` prompt default.
- **SDK consolidation:** Decide whether `sdk/agentpay.ts` should be merged into `sdk/js/` or remain a separate internal helper. Document the decision in `docs/DECISIONS/`.
