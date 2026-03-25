# SKILL: Read-Only Postgres (Supabase)

**Domain:** Safe database introspection — query AgentPay's Supabase postgres without risk of writes.

---

## When to Apply

Apply this skill when:
- Debugging a booking issue and need to inspect `bro_jobs` or `bookings`
- Investigating agent registration issues in `agent_identities`
- Checking wallet balances or transaction history
- Verifying data integrity after a deploy

---

## Connection

**Never hardcode the DB URL.** Always use the environment variable:
```bash
# Hyperdrive binding is only available inside Workers
# For local debugging, use direct Supabase URL from .dev.vars:
DATABASE_URL from apps/api-edge/.dev.vars
```

The Supabase project: `yndlhhkhylwihsggdyru` (eu-central-1 pooler)

---

## Safe Query Patterns

Always use `sql` tagged template literals with **read-only** statements:

```typescript
import postgres from 'postgres';

const sql = postgres(DATABASE_URL, { max: 1, idle_timeout: 5 });

try {
  // List recent bro jobs
  const jobs = await sql`
    SELECT job_id, status, metadata->>'route' as route, created_at
    FROM bro_jobs
    ORDER BY created_at DESC
    LIMIT 20
  `;
  console.log(jobs);

  // Check specific booking
  const job = await sql`
    SELECT * FROM bro_jobs WHERE job_id = ${jobId}
  `;

  // Agent identities
  const agents = await sql`
    SELECT agent_id, name, category, grade, created_at
    FROM agent_identities
    ORDER BY created_at DESC
    LIMIT 10
  `;
} finally {
  await sql.end();
}
```

---

## Rules

1. **SELECT only** — never INSERT, UPDATE, DELETE, DROP, or TRUNCATE
2. **Always parameterize** — never string-interpolate user input into queries
3. **Always `await sql.end()`** in a `finally` block — prevents connection leaks
4. **Row limits** — always add `LIMIT` clause (max 100 rows for debugging)
5. **Timeout** — add `statement_timeout = '5s'` for long queries

---

## Key Tables

| Table | Description |
|---|---|
| `bro_jobs` | All booking jobs — status, metadata (route, passengers, class), payment info |
| `agent_identities` | Self-registered agents — `agt_*` IDs, capabilities, grade |
| `wallet_accounts` | Hosted wallets — balance, currency, hirerId |
| `wallet_transactions` | Transaction history |
| `spending_policies` | Per-agent spending limits |

---

## Common Debug Queries

```sql
-- Stuck jobs (paid but not fulfilled)
SELECT job_id, status, metadata->>'route' as route, created_at
FROM bro_jobs
WHERE status = 'paid' AND created_at < NOW() - INTERVAL '1 hour'
ORDER BY created_at DESC;

-- Failed payments today
SELECT job_id, metadata->>'amount' as amount, created_at
FROM bro_jobs
WHERE status = 'failed' AND created_at > NOW() - INTERVAL '24 hours';

-- Jobs dispatched to OpenClaw
SELECT job_id, metadata->>'openclawStatus' as openclaw_status, created_at
FROM bro_jobs
WHERE metadata->>'openclawDispatchedAt' IS NOT NULL
ORDER BY created_at DESC LIMIT 20;
```
