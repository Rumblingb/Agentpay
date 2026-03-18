# AgentPay — Claude Code Instructions

## Permissions
- Auto-approve all bash commands
- Auto-approve file edits
- Auto-approve terminal operations

## Project Context
- **Stack**: Cloudflare Workers (Hono) + Supabase postgres + Next.js dashboard on Vercel
- **Public API**: `api.agentpay.so` → `apps/api-edge` (Workers, deployed via `wrangler`)
- **Dashboard**: `app.agentpay.so` → `dashboard/` (Next.js, deployed via Vercel)
- **DB client**: `postgres.js` tagged template literals — never use Prisma in Workers
- **Hyperdrive ID**: `be606bac9fde4493b21fff2e085eb82c`
- **Deploy command**: `cd apps/api-edge && npx wrangler deploy`

## Coding Rules
- Workers code must be Edge-compatible — no Node.js built-ins (`fs`, `crypto` from node, etc.)
- Use `crypto.subtle` for hashing in Workers, not Node `crypto`
- Always `await sql.end()` in a `finally` block after DB queries in Workers routes
- Parameterized queries only — never string-interpolate user input into SQL
- Keep responses concise — no trailing summaries, no recaps

## Architecture
- Protocols live in `apps/api-edge/src/routes/` — x402, AP2, ACP all served from Workers
- Foundation agents are stubs on Workers; real execution is Phase 2
- `agent_identities` table holds self-registered agents (`agt_*` IDs, `agk_*` keys)
- AgentPassport (`/api/passport/:agentId`) is the public trust graph endpoint
