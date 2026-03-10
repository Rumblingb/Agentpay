# AgentPay Dashboard

Merchant and agent management dashboard for the [AgentPay](https://agentpay.gg) platform.

Built with [Next.js](https://nextjs.org) 16 and deployed on [Vercel](https://vercel.com).

For full feature documentation see [docs/dashboard.md](../docs/dashboard.md).

## Local development

```bash
# From the repo root
cp .env.production.example dashboard/.env.local   # fill in DIRECT_URL / DATABASE_URL
cd dashboard
npm install
npm run dev
# → http://localhost:3000
```

## Build

```bash
npm run build   # runs prisma generate + next build
npm start       # starts production server
```

## Deployment

The dashboard is deployed independently from the API server.
See [vercel.json](vercel.json) for Vercel configuration.
