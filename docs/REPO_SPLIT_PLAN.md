# Repository Split Plan

Goal: prepare the codebase for a future public/private split while keeping the current monorepo build, tests, and runtime unchanged.

Summary
-------
- Public surface (what stays public): dashboard UI, demo flows, docs, SDK/CLI, examples, public API contracts, landing pages, demo endpoints, `AgentPassport` schemas and public interfaces.
- Private core (what moves to private repo): trust graph scoring, settlement enforcement, dispute resolution, constitutional agents, internal orchestration, secrets/configs, proprietary routing logic.

What I added
------------
- `public-surface/README.md` - marker and plan for public contents.
- `/interfaces/*` - shared TypeScript interfaces for trust, passport, and settlement contracts.
- `/adapters/*` - adapter facades (`trust`, `settlement`, `passport`) that wrap current in-repo implementations. These provide the RPC-like boundary for later replacement.
- `/services/*` - lightweight service layer that public code can call; services delegate to adapters.
- `/config/runtime.ts` - centralized environment access.
- `docs/REPO_SPLIT_PLAN.md` - high-level instructions and mapping for the future split.

Private extraction candidates are intentionally described in this document rather than tracked under a public `core-private/` placeholder.

Recommended migration steps when performing the split
-----------------------------------------------------
1. Move private modules into a private `/core-private` tree or new repo while preserving history.
2. Replace adapter implementations in the public repo with RPC clients that call private service endpoints.
3. Keep `interfaces/*` in a sharable package (npm or git submodule) consumed by both repos.
4. Run full CI and smoke tests, then iterate until parity is achieved.

Notes
-----
- No file was moved or deleted when this plan was first introduced; the public/private boundary is still a staged transition.
- Adapters currently import local implementations as fallbacks so the public surface continues to work unchanged until the split is real.
