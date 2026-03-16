# ADR-002: Custom Migration Runner vs Prisma Migrate

**Status:** Accepted (with documented migration path away from custom runner)  
**Date:** 2026-03-10  
**Deciders:** Engineering

---

## Context

AgentPay uses a custom migration runner (`scripts/migrate.js`) — a JavaScript file containing an array of named SQL migrations applied idempotently via a `migrations` tracking table.

Prisma Migrate is the standard migration tool for Prisma projects. It generates `.sql` files with checksums, tracks migration history in `_prisma_migrations`, and supports rollbacks.

## Why the Custom Runner Exists

The initial schema was bootstrapped via raw SQL (`scripts/create-db.js`). When additional schema changes were needed post-deploy, a lightweight custom runner was added rather than introducing Prisma Migrate mid-stream.

## Decision

Keep the custom runner for the current 26 migrations. Do not retroactively migrate to Prisma Migrate for existing migrations.

**Rules for new migrations going forward:**
1. All new migrations added to `scripts/migrate.js` must be idempotent (`IF NOT EXISTS`, `IF EXISTS`)
2. All new migrations must have a corresponding Prisma schema update in the same PR
3. CI runs both `create-db.js` + `migrate.js` on a fresh database to catch regressions

## Migration Plan Away from Custom Runner

When the team has capacity (post Series A), migrate to Prisma Migrate:
1. Generate an initial Prisma migration that captures the full current schema
2. Mark all 26 existing migrations as "already applied" in `_prisma_migrations`
3. Use `prisma migrate dev` for all future migrations
4. Retire `scripts/migrate.js`

## Consequences

- **Positive:** No breaking change to current deployment process
- **Negative:** No automatic rollback; migration checksums not verified; schema drift possible
- **Risk:** If `scripts/migrate.js` and `prisma/schema.prisma` diverge, type-safe queries will fail at runtime

---

**Related:** `docs/MIGRATION_STRATEGY.md`
