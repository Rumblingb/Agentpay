# ADR-001: Dual Database Access Pattern (pg + Prisma)

**Status:** Accepted (with documented migration path)  
**Date:** 2026-03-10  
**Deciders:** Engineering

---

## Context

AgentPay has two database access patterns in the same codebase:

1. **Raw `pg` pool** (`src/db/index.ts`) — low-level parameterized queries
2. **Prisma ORM** (`src/lib/prisma.ts`) — type-safe ORM queries

This happened because the original schema was bootstrapped in raw SQL, and Prisma was added later for type safety on new features. Both patterns are now in use simultaneously.

## Decision

Accept the dual pattern in the short term, but establish clear rules for new code:

1. **New code** must use Prisma (`src/lib/prisma.ts`) unless there is a specific reason (e.g., bulk inserts, complex raw SQL that Prisma cannot express)
2. **Existing raw `pg` code** is not required to be migrated immediately
3. **Business-critical new paths** (escrow, payments, AgentRank mutations) must use Prisma for type safety

## Consequences

- **Positive:** No migration work needed immediately; new code gets type safety
- **Negative:** Inconsistency remains until gradual migration is complete
- **Risk:** Queries on the same table using different access patterns can lead to subtle bugs (connection pooling, transaction isolation)

## Migration Plan

Long-term goal: consolidate on Prisma for all database access. Migration will happen file-by-file during normal feature work. Priority order:
1. `src/routes/merchants.ts` (critical auth path)
2. `src/services/audit.ts`
3. Remaining route files

---

**Related:** `docs/DATA_MODEL.md`, `docs/ARCHITECTURE.md`
