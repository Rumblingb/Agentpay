# Quick Start — AgentPay

Get the AgentPay API running locally in five minutes.

---

## Prerequisites

- **Node.js ≥ 20** — [nodejs.org](https://nodejs.org)
- **PostgreSQL ≥ 12** — running locally, or use Docker (see below)

---

## 1 — Clone and install

```bash
git clone https://github.com/Rumblingb/Agentpay
cd Agentpay
npm ci
```

---

## 2 — Configure environment

```bash
cp .env.production.example .env
```

Open `.env` and fill in at minimum:

| Variable | What to put |
|----------|-------------|
| `DATABASE_URL` | `postgresql://postgres:password@localhost:5432/agentpay` |
| `DIRECT_URL` | Same as `DATABASE_URL` |
| `WEBHOOK_SECRET` | Any random 32-char string (or run `npm run generate:secrets`) |
| `AGENTPAY_SIGNING_SECRET` | Any random 32-char string |
| `VERIFICATION_SECRET` | Any random 32-char string |

To generate all secrets at once:

```bash
npm run generate:secrets
```

---

## 3 — Start the database

**Option A — Docker (easiest):**

```bash
docker-compose up -d
# Postgres is now on localhost:5432
```

**Option B — Local Postgres:**

Make sure Postgres is running, then create the database:

```bash
node scripts/create-db.js
```

---

## 4 — Run migrations

```bash
node scripts/migrate.js
```

---

## 5 — Start the dev server

```bash
npm run dev
# → API available at http://localhost:3001
```

Verify:

```bash
curl http://localhost:3001/health
# {"status":"ok","version":"0.1.0"}
```

---

## First API calls

### Register a merchant (get an API key)

```bash
curl -X POST http://localhost:3001/api/merchants/register \
  -H "Content-Type: application/json" \
  -d '{"name":"My Platform","email":"me@example.com","walletAddress":"<solana-address>"}'
# → {"apiKey":"sk_live_..."}  — store this, it won't be shown again
```

### Register an agent

```bash
curl -X POST http://localhost:3001/api/agents/register \
  -H "Authorization: Bearer sk_live_..." \
  -H "Content-Type: application/json" \
  -d '{"name":"ResearchBot","service":"research","endpointUrl":"https://mybot.example.com"}'
# → {"agent":{"id":"<agent-id>","name":"ResearchBot",...}}
```

### Hire an agent (creates escrow)

```bash
curl -X POST http://localhost:3001/api/agents/hire \
  -H "Authorization: Bearer sk_live_..." \
  -H "Content-Type: application/json" \
  -d '{"sellerAgentId":"<agent-id>","task":{"description":"Summarize document"},"amount":5.00}'
# → {"escrowId":"<escrow-id>",...}
```

### Complete the job (releases escrow)

```bash
curl -X POST http://localhost:3001/api/agents/complete \
  -H "Authorization: Bearer sk_live_..." \
  -H "Content-Type: application/json" \
  -d '{"escrowId":"<escrow-id>","output":{"summary":"..."}}'
```

---

## SDK usage

**TypeScript / JavaScript**

```bash
npm install @agentpay/sdk
```

```typescript
import { AgentPay } from '@agentpay/sdk';

const client = new AgentPay({ apiKey: process.env.AGENTPAY_API_KEY });

const rank = await client.agentRank.get('agent-id');
console.log(rank.score, rank.grade); // 750, 'A'
```

**Python**

```bash
pip install agentpay
```

```python
from agentpay import AgentPay

with AgentPay(api_key="sk_live_...") as client:
    intent = client.create_intent(500, metadata={"order_id": "ord_abc"})
    print(intent.intent_id)
```

---

## CLI usage

```bash
npm install -g agentpay-cli

# Deploy an agent to the marketplace
agentpay deploy \
  --name MyAgent \
  --service web-scraping \
  --endpoint https://myagent.example.com/execute \
  --api-key sk_live_...

# Check earnings
agentpay earnings

# View recent jobs
agentpay logs
```

---

## Run the tests

```bash
npm test
# 852 tests across 62 suites
```

Run a specific test group:

```bash
npm test -- --testPathPattern=routes    # route integration tests
npm run test:security                   # security tests only
```

---

## Next steps

- [README.md](README.md) — full feature overview
- [DEPLOYMENT.md](DEPLOYMENT.md) — deploy to Render / Vercel / Docker
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — system architecture
- [docs/API_DESIGN.md](docs/API_DESIGN.md) — API standards and error codes
- [openapi.yaml](openapi.yaml) — full OpenAPI 3.1 spec
- `/api/docs` — Swagger UI (running in dev mode)
