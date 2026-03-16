# Metadata Audit — AgentPay

> **Date:** 2026-03-10  
> **Phase:** B — Metadata Truth Alignment  
> **Status:** Audit only. No changes applied yet. Awaiting approval before proceeding.  
> **Scope:** All package metadata, install instructions, and doc references to package names / versions / URLs.

---

## How to Read This Table

- **File** — exact path relative to repo root  
- **Field** — the metadata key or doc section examined  
- **Current value** — what is actually in the file today  
- **Issue** — why the current value is wrong, misleading, or missing  
- **Recommended change** — the precise fix  
- **Reason** — why the fix is correct

---

## Part 1 — `package.json` (root)

| # | File | Field | Current value | Issue | Recommended change | Reason |
|---|------|-------|---------------|-------|--------------------|--------|
| R1 | `package.json` | `author` | `"Your Name"` | Placeholder — literally the default npm init stub. Never filled in. | `"AgentPay"` | Use the organisation name, consistent with all other sub-packages (`agentpay-cli`, `@agentpay/sdk`). Avoids exposing a personal email address in package metadata. |
| R2 | `package.json` | `description` | `"Universal payment gateway for AI agents"` | Accurate but narrow — omits the trust/identity/escrow/AgentRank dimension which is the core differentiation. Reads like a generic Stripe competitor. | `"Trust and payment infrastructure for AI agent-to-agent commerce — AgentRank scoring, A2A escrow, multi-protocol payments, and agent identity"` | Matches the actual product as described in `docs/PRODUCT_THESIS.md` and `docs/ARCHITECTURE.md`. |
| R3 | `package.json` | `homepage` | *(missing field entirely)* | No homepage field. npm shows a blank page for the package. | `"https://github.com/Rumblingb/Agentpay#readme"` | Standard npm convention. Until a dedicated product site exists, the GitHub README is the canonical landing page. |
| R4 | `package.json` | `bugs` | *(missing field entirely)* | No bugs URL. Contributors cannot find the issue tracker from the package. | `{"url": "https://github.com/Rumblingb/Agentpay/issues"}` | Standard npm convention. |
| R5 | `package.json` | `keywords` | `["payments", "ai-agents", "x402", "fintech"]` | Too narrow. Missing the primary differentiators: agentrank, escrow, trust scoring, a2a. | `["agentpay", "payments", "ai-agents", "x402", "escrow", "agentrank", "trust", "fintech", "a2a"]` | Keywords drive npm and GitHub discovery. |
| R6 | `package.json` | `scripts.clean` | `"if exist dist rmdir /s /q dist"` | Windows CMD syntax (`if exist ... rmdir /s /q`). Broken on Linux/macOS. The build server (Render) runs Linux. | `"rm -rf dist"` | Unix-compatible. Achieves the same result on all CI/deploy targets. |
| R7 | `package.json` | `engines.node` | `">=20.0.0"` | Fine, but CLI package says `>=18.0.0` — inconsistent across packages in the same repo. | Keep `>=20.0.0` in root. Raise CLI to match (see CLI section). | Root and all sub-packages should agree on the minimum Node version to avoid confusion. |
| R8 | `package.json` | `repository.url` | `"https://github.com/Rumblingb/Agentpay"` | Missing the `git+` prefix required by npm. | `"git+https://github.com/Rumblingb/Agentpay.git"` | npm spec requires `git+` prefix and `.git` suffix for the repository URL to be parseable. |

---

## Part 2 — `cli/agentpay/package.json`

| # | File | Field | Current value | Issue | Recommended change | Reason |
|---|------|-------|---------------|-------|--------------------|--------|
| C1 | `cli/agentpay/package.json` | `version` | `"1.0.0"` | Inconsistent with the rest of the repo (root is `0.1.0`, JS SDK is `0.2.0`, Python SDK is `0.1.0`). Claiming `1.0.0` implies a stable, GA release. CLI is Alpha. | `"0.1.0"` | Conservative, honest, and consistent with the rest of the repo's versioning posture. |
| C2 | `cli/agentpay/package.json` | `engines.node` | `">=18.0.0"` | Root package requires `>=20.0.0`. CLI requiring only `>=18.0.0` creates a subtle inconsistency — users on Node 18 may install the CLI then fail to run the backend. | `">=20.0.0"` | Align with root. Node 20 is LTS and the server already requires it. |
| C3 | `cli/agentpay/package.json` | `repository` | *(missing field)* | No repository field. npm install has no pointer back to source. | `{"type": "git", "url": "git+https://github.com/Rumblingb/Agentpay.git"}` | Standard npm convention. |
| C4 | `cli/agentpay/package.json` | `homepage` | *(missing field)* | Missing. | `"https://github.com/Rumblingb/Agentpay/tree/main/cli/agentpay#readme"` | Points to the sub-package README in the monorepo. |
| C5 | `cli/agentpay/package.json` | `bugs` | *(missing field)* | Missing. | `{"url": "https://github.com/Rumblingb/Agentpay/issues"}` | Standard npm convention. |
| C6 | `cli/agentpay/README.md` | Install command | `npm install -g agentpay-cli` | The package name is `agentpay-cli` but the README does not state the npm package name clearly. This is actually consistent — the name is `agentpay-cli` — but `bin` entry is `agentpay`, so the command after install is `agentpay`. No issue with the install command itself. | No change needed for install command; add a note clarifying `agentpay-cli` is the package and `agentpay` is the command. | Clarity. |
| C7 | `cli/agentpay/README.md` | Dashboard URL | `https://apay-delta.vercel.app` | Hardcoded Vercel preview URL. This is a deploy preview, not a production URL. `docs/AGENT_ONBOARDING_GUIDE.md` uses `https://dashboard.agentpay.gg` as the canonical dashboard URL. | `https://dashboard.agentpay.gg` | Use the canonical domain that appears consistently in other docs. |
| C8 | `cli/agentpay/index.js` | Default API base | `'https://agentpay-api.onrender.com'` | The code already supports override via `process.env.AGENTPAY_API_URL`, but does not recognise `AGENTPAY_API_BASE` (the conventional name used in the review comments). **Do NOT swap the hardcoded default to `api.agentpay.gg`** until DNS is confirmed live — doing so would silently break every CLI install if the domain is not yet configured. | Keep `agentpay-api.onrender.com` as default. Add `AGENTPAY_API_BASE` as the primary override (checked before `AGENTPAY_API_URL` for forward-compatibility): `process.env.AGENTPAY_API_BASE \|\| process.env.AGENTPAY_API_URL \|\| config.apiUrl \|\| 'https://agentpay-api.onrender.com'` | Safe incremental migration: operators can set `AGENTPAY_API_BASE` in their environment to switch domains without a CLI release. |

---

## Part 3 — `sdk/js/package.json` (JS/TS SDK)

| # | File | Field | Current value | Issue | Recommended change | Reason |
|---|------|-------|---------------|-------|--------------------|--------|
| J1 | `sdk/js/package.json` | `repository` | *(missing field)* | No repository field. | `{"type": "git", "url": "git+https://github.com/Rumblingb/Agentpay.git", "directory": "sdk/js"}` | Standard npm convention for monorepo sub-packages. |
| J2 | `sdk/js/package.json` | `homepage` | *(missing field)* | Missing. | `"https://github.com/Rumblingb/Agentpay/tree/main/sdk/js#readme"` | Points to the sub-package README. |
| J3 | `sdk/js/package.json` | `bugs` | *(missing field)* | Missing. | `{"url": "https://github.com/Rumblingb/Agentpay/issues"}` | Standard npm convention. |
| J4 | `sdk/js/README.md` | Homepage link | `https://agentpay.io` | Domain `agentpay.io` is used here. The rest of the project uses `agentpay.gg` (AGENT_ONBOARDING_GUIDE, INTEGRATION_HUB, server code) and the README uses `security@agentpay.gg`. No evidence `agentpay.io` is the canonical domain. | `https://agentpay.gg` | Use the canonical domain consistent with the rest of the project. |
| J5 | `sdk/js/src/types.ts` | `baseUrl` example | `'https://api.agentpay.io'` | Uses `.io` domain in code type examples. | `'https://api.agentpay.gg'` | Canonical domain alignment. |

---

## Part 4 — `sdk/python/pyproject.toml` (Python SDK)

| # | File | Field | Current value | Issue | Recommended change | Reason |
|---|------|-------|---------------|-------|--------------------|--------|
| P1 | `sdk/python/pyproject.toml` | `urls` | *(missing field entirely)* | No `[project.urls]` section. PyPI shows no links to source or documentation. | Add `[project.urls]` with `Repository`, `Homepage`, `Bug Tracker` | Standard PyPI convention. |
| P2 | `sdk/python/README.md` | Homepage link | `https://agentpay.io` | Uses `.io` domain. All other project references use `.gg`. | `https://agentpay.gg` | Canonical domain alignment. |
| P3 | `docs/SDK_STRATEGY.md` | Python minimum version | `Python 3.8+` | The `pyproject.toml` requires `>=3.10`. The strategy doc is wrong. | Update SDK_STRATEGY.md table to `Python 3.10+` | Truth alignment — pyproject.toml is the authoritative source. |

---

## Part 5 — `dashboard/package.json`

| # | File | Field | Current value | Issue | Recommended change | Reason |
|---|------|-------|---------------|-------|--------------------|--------|
| D1 | `dashboard/package.json` | `name` | `"dashboard"` | Generic placeholder name. Not meaningful as a package identifier. | `"dashboard"` (kept — no verifiable benefit to renaming; `private: true` prevents accidental publish; tooling may reference the old name) | Add `description` and `"private": true` instead. |
| D2 | `dashboard/package.json` | `description` | *(missing field entirely)* | No description. | `"AgentPay merchant and agent management dashboard"` | Matches what the dashboard actually does (based on `docs/dashboard.md`). |
| D3 | `dashboard/package.json` | `private` | *(missing field)* | Dashboard is not and should not be published to npm. Without `"private": true`, it could accidentally be published. | `"private": true` | Standard practice for non-publishable app packages in a monorepo. |
| D4 | `dashboard/README.md` | Content | Full `create-next-app` boilerplate README | The dashboard README is the default Next.js starter README. It has zero project-specific content — it mentions "Next.js project bootstrapped with create-next-app" and Geist font, with no mention of AgentPay. | Replace with a minimal AgentPay-specific description, local setup steps, and a pointer to `docs/dashboard.md`. | A reviewer looking at the dashboard directory should understand what it is without reading generic Next.js docs. |

---

## Part 6 — `sdk/agentpay.ts` (root-level SDK file)

| # | File | Field | Current value | Issue | Recommended change | Reason |
|---|------|-------|---------------|-------|--------------------|--------|
| S1 | `sdk/agentpay.ts` | Relationship to `sdk/js/` | Standalone TypeScript file with its own API surface (`createAgent`, `payAsAgent`, `verifyWebhookSignature`, etc.) | This file exists alongside `sdk/js/` which is a separate, independently versioned npm package (`@agentpay/sdk`). The two have different APIs and different exports. A developer looking at `sdk/` cannot tell which one to use. This is an SDK naming/structure ambiguity. | Document: `sdk/agentpay.ts` is the **monorepo server-side helper** (used within `src/`). `sdk/js/` is the **published npm package** (`@agentpay/sdk`) for external consumers. Record this boundary clearly in an inline comment at the top of `sdk/agentpay.ts` and in `docs/SDK_STRATEGY.md`. | No code deletion — just documentation of the boundary. This is a metadata/clarity issue, not a structural change. |

---

## Part 7 — `sdk/examples/quickstart.js`

| # | File | Field | Current value | Issue | Recommended change | Reason |
|---|------|-------|---------------|-------|--------------------|--------|
| E1 | `sdk/examples/quickstart.js` | Install instruction | `npm install agentpay-sdk` | Wrong package name. The published JS SDK package is `@agentpay/sdk`, not `agentpay-sdk`. `agentpay-sdk` does not exist on npm. | `npm install @agentpay/sdk` | Use the correct scoped package name. |

---

## Part 8 — `docs/` references

| # | File | Field | Current value | Issue | Recommended change | Reason |
|---|------|-------|---------------|-------|--------------------|--------|
| O1 | `docs/sdk/js.md` | `baseUrl` example | `'https://api.agentpay.io'` | Uses `.io` domain. | `'https://api.agentpay.io'` → `'https://api.agentpay.gg'` | Canonical domain alignment. |
| O2 | `docs/sdk/python.md` | `base_url` example | `"https://api.agentpay.io"` | Uses `.io` domain. | `"https://api.agentpay.gg"` | Canonical domain alignment. |
| O3 | `docs/SDK_STRATEGY.md` | Python version in table | `Python 3.8+` | Contradicts `pyproject.toml` which requires `>=3.10`. | `Python 3.10+` | Truth alignment. |
| O4 | `docs/SDK_STRATEGY.md` | Publish workflow claim | `TypeScript SDK: .github/workflows/publish-sdk-js.yml` and `Python SDK: .github/workflows/publish-sdk-python.yml` | Both workflow files exist (confirmed). The claim is accurate. | No change needed. | Workflows exist at `.github/workflows/publish-sdk-js.yml` and `publish-sdk-python.yml`. |

---

## Part 9 — Domain name canonical audit

Two domains appear in the codebase: `agentpay.gg` and `agentpay.io`. One needs to be chosen as canonical.

| Domain | Where it appears | Evidence of canonicality |
|--------|-----------------|--------------------------|
| `agentpay.gg` | `docs/AGENT_ONBOARDING_GUIDE.md`, `docs/INTEGRATION_HUB.md`, `docs/terms.md`, `sdk/examples/quickstart.js`, `cli/agentpay/index.js` (API base default), `src/server.ts` (CORS origin), `README.md` (security contact `security@agentpay.gg`), `legal/` documents | Primary. Appears in the most places, including legal docs and the server's own CORS config. |
| `agentpay.io` | `sdk/js/README.md`, `sdk/python/README.md`, `docs/sdk/js.md`, `docs/sdk/python.md`, `sdk/js/src/types.ts` | Secondary. Appears only in SDK docs/types. Likely an earlier draft of the domain. |

**Conclusion:** `agentpay.gg` is canonical. All `.io` references in SDK docs and source should be updated to `.gg`.

---

## Part 10 — Version coherence across packages

| Package | Current version | Issue |
|---------|----------------|-------|
| Root server (`package.json`) | `0.1.0` | Consistent with Alpha status. Fine. |
| JS SDK (`sdk/js/package.json`) | `0.2.0` | Fine. Slightly ahead of root, acceptable for an SDK that may iterate separately. |
| Python SDK (`sdk/python/pyproject.toml`) | `0.1.0` | Consistent. Fine. |
| CLI (`cli/agentpay/package.json`) | `1.0.0` | **Issue.** Inflated. The rest of the repo is in the 0.x range. Claiming `1.0.0` implies stable/GA. CLI is Alpha. |
| Dashboard (`dashboard/package.json`) | `0.1.0` | Fine. The dashboard is not published. Version here is cosmetic. |

**API version in `src/server.ts`:** `const API_VERSION = '1.0.0'`. This is the API response version string (returned in `/health` and `/status` responses), not the npm package version. It is a separate concern from npm versioning. No change recommended here — changing it would alter a public API response.

---

## Summary: Changes Required vs. Not Required

### Changes required (will apply in Phase B execution)

| # | File | Change |
|---|------|--------|
| R1 | `package.json` | Change `author` from `"Your Name"` to `"AgentPay"` |
| R2 | `package.json` | Improve `description` |
| R3 | `package.json` | Add `homepage` field |
| R4 | `package.json` | Add `bugs` field |
| R5 | `package.json` | Expand `keywords` |
| R6 | `package.json` | Fix Windows-only `clean` script |
| R8 | `package.json` | Fix `repository.url` to `git+` format |
| C1 | `cli/agentpay/package.json` | Downgrade `version` from `1.0.0` to `0.1.0` |
| C2 | `cli/agentpay/package.json` | Raise `engines.node` from `>=18` to `>=20` |
| C3 | `cli/agentpay/package.json` | Add `repository` field |
| C4 | `cli/agentpay/package.json` | Add `homepage` field |
| C5 | `cli/agentpay/package.json` | Add `bugs` field |
| C7 | `cli/agentpay/README.md` | Fix dashboard URL from `apay-delta.vercel.app` to `dashboard.agentpay.gg` |
| C8 | `cli/agentpay/index.js` | Keep `agentpay-api.onrender.com` default; add `AGENTPAY_API_BASE` env-var override before `AGENTPAY_API_URL` |
| J1 | `sdk/js/package.json` | Add `repository` field |
| J2 | `sdk/js/package.json` | Add `homepage` field |
| J3 | `sdk/js/package.json` | Add `bugs` field |
| J4 | `sdk/js/README.md` | Fix homepage link from `agentpay.io` to `agentpay.gg` |
| J5 | `sdk/js/src/types.ts` | Fix `baseUrl` example from `agentpay.io` to `agentpay.gg` |
| P1 | `sdk/python/pyproject.toml` | Add `[project.urls]` section |
| P2 | `sdk/python/README.md` | Fix homepage link from `agentpay.io` to `agentpay.gg` |
| P3 | `docs/SDK_STRATEGY.md` | Fix Python version claim from `3.8+` to `3.10+` |
| D1 | `dashboard/package.json` | Keep name `"dashboard"`; add `description` and `"private": true` |
| D2 | `dashboard/package.json` | Add `description` field |
| D3 | `dashboard/package.json` | Add `"private": true` |
| D4 | `dashboard/README.md` | Replace Next.js boilerplate with AgentPay-specific content |
| E1 | `sdk/examples/quickstart.js` | Fix `npm install agentpay-sdk` to `npm install @agentpay/sdk` |
| O1 | `docs/sdk/js.md` | Fix `agentpay.io` to `agentpay.gg` in `baseUrl` examples |
| O2 | `docs/sdk/python.md` | Fix `agentpay.io` to `agentpay.gg` in `base_url` examples |
| O3 | `docs/SDK_STRATEGY.md` | Fix Python version in table |
| S1 | `sdk/agentpay.ts` | Add clarifying comment about the file's purpose vs `sdk/js/` |

### Changes not required

| Item | Reason |
|------|--------|
| Root `version` (`0.1.0`) | Honest, conservative, appropriate for Alpha. |
| JS SDK `version` (`0.2.0`) | Acceptable — slightly ahead of root, valid for a separately-iterated SDK. |
| Python SDK `version` (`0.1.0`) | Correct. |
| `src/server.ts` `API_VERSION = '1.0.0'` | This is the wire-format API version, not the npm package version. Changing it alters public API responses. Leave it. |
| `package.json` `test` script with `--forceExit` | Required for pg.Pool cleanup (per `build and test` project memory). Do not remove. |
| `docs/SDK_STRATEGY.md` publish workflow references | Workflows confirmed present. No change needed. |
| `docs/INTEGRATION_HUB.md` `npx agentpay init` | This references a CLI command. The CLI `index.js` does not yet have an `init` command (it has `deploy`, `earnings`, `logs`, `config`). This is a doc gap but it is a **feature gap**, not a metadata field issue. Recording here; fixing it is out of scope for Phase B (would require either adding the `init` command or removing the reference from an operational doc). |

---

*Audit complete. All items above are observations only. No files have been modified.*
