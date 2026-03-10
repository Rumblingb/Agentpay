# Architecture Decision Records

This directory contains Architecture Decision Records (ADRs) for AgentPay.

An ADR documents a significant architectural decision: the context, the options considered, the decision made, and the consequences.

## Index

| ADR | Title | Status |
|-----|-------|--------|
| [ADR-001](ADR-001-dual-db-pattern.md) | Dual Database Access Pattern (pg + Prisma) | Accepted |
| [ADR-002](ADR-002-custom-migration-runner.md) | Custom Migration Runner vs Prisma Migrate | Accepted (with migration plan) |
| [ADR-003](ADR-003-in-memory-escrow.md) | In-Memory Escrow (Trust-Escrow) | Deprecated — to be replaced |
| [ADR-004](ADR-004-multi-protocol-pal.md) | Multi-Protocol Support (Protocol Abstraction Layer) | Accepted |

## Status Definitions

- **Accepted** — Decision is in effect
- **Deprecated** — Decision is no longer the right approach; a replacement is being built
- **Superseded** — This ADR has been replaced by a newer ADR

## How to Add a New ADR

1. Create a new file: `ADR-NNN-short-title.md`
2. Use this template:

```markdown
# ADR-NNN: Title

**Status:** Proposed / Accepted / Deprecated / Superseded  
**Date:** YYYY-MM-DD  
**Deciders:** Engineering / Product / etc.

---

## Context
[What is the problem?]

## Decision
[What was decided?]

## Consequences
[What are the positive and negative outcomes?]
```

3. Add it to the index above
4. Link to it from the relevant code or docs
