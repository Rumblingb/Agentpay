# Contributing to AgentPay

Thank you for your interest in AgentPay. We welcome bug reports, documentation improvements, and feature discussions.

## Before You Contribute

AgentPay is licensed under the **Business Source License 1.1 (BSL-1.1)**. Before submitting any contribution, you must agree to the **Contributor License Agreement (CLA)** below. This allows AgentPay Ltd. to license your contribution under current and future license terms (including after the BSL converts to AGPL-3.0 on 2029-01-01).

### Contributor License Agreement

By submitting a pull request or patch, you agree that:

1. **You own the contribution.** You have the right to submit it and it does not violate any third-party rights.
2. **You grant AgentPay Ltd. a perpetual, irrevocable, worldwide, royalty-free license** to use, reproduce, modify, distribute, and sublicense your contribution under any license AgentPay Ltd. chooses, including BSL-1.1, AGPL-3.0, or any future license.
3. **You grant users of AgentPay** the same rights to your contribution as they have under the project's current license.
4. **You understand** that your contribution may be publicly visible in the repository.

If you are contributing on behalf of your employer, you confirm you have authority to grant these rights.

**To accept the CLA:** Add the following line to your pull request description:

> I have read and agree to the AgentPay Contributor License Agreement.

PRs without CLA acceptance will not be merged.

---

## How to Contribute

### Reporting Bugs

Open an issue at [github.com/Rumblingb/Agentpay/issues](https://github.com/Rumblingb/Agentpay/issues) with:
- A clear title and description
- Steps to reproduce
- Expected vs actual behavior
- Your environment (OS, Node version, Workers runtime if applicable)

### Suggesting Features

Open an issue tagged `enhancement`. Describe:
- The problem you're solving
- Why it belongs in the core rather than as an adapter/plugin
- Any alternative approaches you've considered

### Submitting Code

1. Fork the repository and create a branch from `main`
2. Make your changes with clear, focused commits
3. Ensure TypeScript compiles: `npm run typecheck` in the relevant package
4. Test your changes against the local Workers dev server: `npx wrangler dev`
5. Open a PR against `main` with a clear description and CLA acceptance

### Code Style

- TypeScript strict mode throughout
- No `any` types in public SDK surface
- Hono for Workers routes — no Express/Node.js-only APIs in `apps/api-edge/`
- Prefer explicit types over inference in exported interfaces

---

## What We Will Not Accept

- Changes that introduce Node.js-specific APIs into `apps/api-edge/` (Cloudflare Workers must stay Workers-compatible)
- Changes that weaken security controls (auth middleware, rate limiting, HMAC verification)
- Dependencies that add significant bundle weight to the Workers build
- Competing commercial integrations (BSL restriction applies)

---

## Questions?

Open a GitHub issue or discussion. We respond to most threads within a few business days.
