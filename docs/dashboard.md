# AgentPay Merchant Dashboard

> Status: legacy surface. The canonical AgentPay runtime is now terminal- and host-native through MCP tool calls, hosted actions, and governed capability flows.

If a choice exists between expanding this dashboard and expanding the terminal-native control plane, choose the control plane.

A Next.js App Router dashboard for AgentPay merchants, deployable on Vercel.

## Location

`/dashboard` — Next.js 16 application (App Router).

## Features

| Page | Path | Description |
|------|------|-------------|
| Login | `/login` | Email + API key authentication |
| Overview | `/overview` | Metrics (revenue, intents, success rate) + payments chart |
| Intents | `/intents` | Table of payment intents with status, amount, tx hash |
| Webhooks | `/webhooks` | Manage webhook subscriptions and view delivery logs |
| API Keys | `/api-keys` | View masked key, rotate API key |
| Billing | `/billing` | Fee breakdown placeholder |

## Auth Flow

1. Merchant submits **email + API key** on the login page.
2. The dashboard's `POST /api/auth/login` route calls the backend's `GET /api/merchants/profile` with `Bearer <apiKey>` to validate credentials.
3. On success, a **signed HTTP-only cookie** (`agentpay_session`) is set. The cookie value is:
   ```
   base64url(JSON payload) . base64url(HMAC-SHA256 signature)
   ```
4. Next.js `middleware.ts` verifies this cookie on every request to protected routes and redirects to `/login` if invalid or absent.
5. `POST /api/auth/logout` clears the cookie.

The session signing uses **HMAC-SHA256** via the Web Crypto API (works in both Node.js ≥18 and the Next.js Edge runtime).

## Environment Variables

Copy `dashboard/.env.example` to `dashboard/.env.local`:

```env
# Server-side URL of the Workers API
AGENTPAY_API_BASE_URL=http://localhost:8787

# Secret for HMAC-signing the session cookie (min 32 chars)
# Generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
DASHBOARD_SESSION_SECRET=change-me-to-a-random-32-char-secret
```

For Vercel deployment these are configured in the Vercel dashboard or `dashboard/vercel.json`.

## Local Development

```bash
# From apps/api-edge, start the Workers API first:
cd apps/api-edge
npm install
npm run dev          # starts Workers on :8787

# Then start the dashboard:
cd ../../dashboard
npm install
npm run dev          # starts dashboard on :3000
```

## Key Files

```
dashboard/
├── app/
│   ├── layout.tsx                  # Root layout with React Query provider
│   ├── page.tsx                    # Redirects → /overview
│   ├── login/page.tsx              # Login page
│   ├── (authed)/                   # Route group: all protected pages
│   │   ├── layout.tsx              # Sidebar shell
│   │   ├── overview/page.tsx
│   │   ├── intents/page.tsx
│   │   ├── webhooks/page.tsx
│   │   ├── api-keys/page.tsx
│   │   └── billing/page.tsx
│   └── api/
│       ├── auth/login/route.ts     # POST  — verifies creds, sets cookie
│       ├── auth/logout/route.ts    # POST  — clears cookie
│       ├── me/route.ts             # GET   — merchant profile
│       ├── stats/route.ts          # GET   — payment stats (proxies backend)
│       ├── payments/route.ts       # GET   — payment list (proxies backend)
│       ├── webhooks/route.ts       # GET/POST — webhook subscriptions
│       └── keys/route.ts           # POST  — rotate API key
├── components/
│   ├── QueryProvider.tsx           # TanStack React Query provider
│   ├── Sidebar.tsx                 # Navigation sidebar
│   ├── MetricCard.tsx              # Metric display card
│   └── DataTable.tsx               # Generic sortable table
├── lib/
│   ├── session.ts                  # HMAC cookie sign/verify helper
│   └── api.ts                      # Backend API client
├── middleware.ts                   # Route protection
└── __tests__/
    └── session.test.ts             # Unit tests for the session helper
```

## Tests

```bash
# From the repo root:
npm test -- --testPathPattern=dashboard/__tests__
```

The session helper unit tests validate:
- Cookie signing produces two dot-separated base64url parts
- Round-trip encode/decode of payload fields
- Tampered signature returns `null`
- Tampered payload returns `null`
- Expired session returns `null`
- Malformed cookie strings return `null`

## Backend Integration

The dashboard consumes the following AgentPay backend endpoints:

| Backend Endpoint | Used by |
|-----------------|---------|
| `GET /api/merchants/profile` | Login + `/api/me` |
| `GET /api/merchants/stats` | Overview metrics |
| `GET /api/merchants/payments` | Overview chart + Intents table |
| `POST /api/merchants/rotate-key` | API Keys page |
| `GET /api/merchants/webhooks` | Webhooks page (PR2) |
| `POST /api/merchants/webhooks` | Webhooks page (PR2) |

The backend is never called directly from the browser — all calls go through the dashboard's Next.js API routes, which read the signed session cookie to obtain the API key server-side.
