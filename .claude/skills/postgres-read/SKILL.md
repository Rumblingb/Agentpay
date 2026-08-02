---
name: postgres-read
description: Read-only introspection of AgentPay's Supabase postgres via postgres.js. Use when inspecting or debugging live data — booking jobs in `bro_jobs`, self-registered agents in `agent_identities`, wallet balances or `wallet_transactions`, spending policies — or when checking data integrity after a deploy. Covers connection setup, safe SELECT-only query patterns, the key table map, and ready-made debug queries for stuck jobs, failed payments, and OpenClaw dispatch.
---

# Read-Only Postgres (Supabase)

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

**Never hardcode the DB URL, and never read it out of a secrets file.** `apps/api-edge/.dev.vars`
is deny-listed in `.claude/settings.json` on purpose — a secret read into the transcript is a
secret that has leaked. Have the operator export it into the shell instead:

```bash
# Hyperdrive binding only exists inside Workers. For local debugging:
export DATABASE_URL="$(grep -m1 '^DATABASE_URL=' apps/api-edge/.dev.vars | cut -d= -f2-)"
# ...then reference process.env.DATABASE_URL — never paste the value into a file or message.
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
