# Migration Strategy — AgentPay

> **Version:** 1.0  
> **Last Updated:** 2026-03-10  
> **Owner:** Engineering

---

## Current State

AgentPay uses a custom SQL migration runner (`scripts/migrate.js`) rather than Prisma Migrate's built-in migration system.

**Why this exists:** The initial schema was bootstrapped via raw SQL (`scripts/create-db.js`), and migrations were added incrementally as SQL statements in a JavaScript array. This predates a formal migration strategy.

**Current migration count:** 26+ migrations (001–026)

**How it works:**
1. Each migration has a `name` and `sql` field
2. On startup, the migration runner checks a `migrations` table for applied migration names
3. Unapplied migrations are executed in order
4. The migration name is recorded in the `migrations` table after success

---

## Migration Safety Rules

All migrations in `scripts/migrate.js` must follow these rules:

### 1. Always Idempotent

All DDL operations must use safe guards:
```sql
-- ✅ Safe
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS new_col VARCHAR(100);
CREATE TABLE IF NOT EXISTS new_table (...);
CREATE INDEX IF NOT EXISTS idx_name ON table(column);

-- ❌ Not safe
ALTER TABLE merchants ADD COLUMN new_col VARCHAR(100);
```

### 2. Never Destructive (Without a Plan)

- Never `DROP TABLE` in a migration without a documented data retention period
- Never `DROP COLUMN` — add a deprecation flag first, drop after confirmed unused
- If dropping, add a migration comment explaining why and when the column was deprecated

### 3. Backward Compatible

Migrations must be backward compatible with the running application:
- Add columns as NULLABLE or with DEFAULT
- Never rename a column in a single step — add new column, backfill, then deprecate old
- Never change a column's type in a way that loses data

### 4. Fast and Non-Blocking

- Large table modifications should use `NOT VALID` constraint deferral
- Avoid `ALTER TABLE ... ADD CONSTRAINT ... NOT VALID` then `VALIDATE CONSTRAINT` in the same migration
- Add indexes `CONCURRENTLY` when possible (note: cannot be in a transaction block)

---

## Running Migrations

### Fresh Database
```bash
# 1. Create initial schema
node scripts/create-db.js

# 2. Apply all migrations
node scripts/migrate.js
```

### Existing Database (Upgrade)
```bash
# Safe to re-run — already-applied migrations are skipped
node scripts/migrate.js
```

### Verification
```bash
# Check which migrations have been applied
psql $DATABASE_URL -c "SELECT name, applied_at FROM migrations ORDER BY applied_at;"
```

---

## Adding a New Migration

1. Open `scripts/migrate.js`
2. Add a new entry to the `migrations` array:
```javascript
{
  name: '027_your_descriptive_name',
  sql: `ALTER TABLE your_table ADD COLUMN IF NOT EXISTS your_col TEXT;`
}
```
3. Naming convention: `NNN_description` where NNN is zero-padded to 3 digits
4. Always use `IF NOT EXISTS` / `IF EXISTS` guards
5. Test on a fresh DB and on the latest production schema snapshot

---

## Known Gaps (Roadmap)

### Gap 1: No Rollback Mechanism

Current migrations have no rollback SQL. For critical migrations, add a `rollback` field:
```javascript
{
  name: '027_add_feature',
  sql: `ALTER TABLE t ADD COLUMN IF NOT EXISTS f TEXT;`,
  rollback: `ALTER TABLE t DROP COLUMN IF EXISTS f;`
}
```

### Gap 2: No Migration History in Version Control

Prisma Migrate stores each migration as a separate `.sql` file with a checksum. Our current approach stores all migrations in a single JS file. This makes it harder to review individual migrations in PRs.

**Planned fix:** Migrate to Prisma Migrate. Migration path:
1. Keep existing `scripts/migrate.js` as a bootstrap step for existing deployments
2. Use `prisma migrate dev` for new migrations going forward
3. Add a migration lock to prevent the old runner from applying new migrations

### Gap 3: No Migration Smoke Tests in CI

CI should verify:
- Fresh database + create-db.js + migrate.js succeeds
- All Prisma model queries work after migration

**Planned fix:** Add a `test:migrations` script that:
```bash
dropdb agentpay_test_migrations || true
createdb agentpay_test_migrations
DATABASE_URL=postgresql://...agentpay_test_migrations node scripts/create-db.js
DATABASE_URL=postgresql://...agentpay_test_migrations node scripts/migrate.js
```

---

## Schema Drift Prevention

The Prisma schema (`prisma/schema.prisma`) must stay in sync with the actual database schema. Currently there is drift because some tables are created by raw SQL and are not reflected in the Prisma schema (or vice versa).

**Current drift items:**
- `webhook_events` table created by `create-db.js` but partially in Prisma schema
- Migration-added columns may not match Prisma schema exactly

**Prevention rules:**
1. Every migration that adds a column must have a corresponding Prisma schema update in the same PR
2. CI runs `prisma validate` to catch obvious schema errors
3. TODO: Add `prisma migrate diff` check in CI to detect drift

---

## Seed Data

### Local Development
```bash
# Optional: seed with demo data
npx tsx scripts/seed-demo-wallets.ts
npx tsx scripts/seed-insurance-pool.ts
```

### CI / Test Database
The test database is initialized fresh on every CI run via `create-db.js` + `migrate.js`. No seed data is required; tests create their own fixtures.

### Production
Production does not use seed scripts. Initial data (admin account, insurance pool) is created by the application on first run.
