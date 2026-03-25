# SKILL: Security Audit

**Domain:** Application security — focused on Cloudflare Workers, Hono, Supabase postgres, Stripe/Razorpay webhooks, and React Native Expo apps.

---

## When to Apply

Apply this skill whenever:
- A new API route is added to `apps/api-edge/src/routes/`
- A webhook handler is added or modified
- Payment processing code changes
- User input is processed (voice transcripts, form data, booking details)
- New external API integrations are added

---

## Vulnerability Classes to Check

### 1. SQL Injection
```typescript
// BAD — never do this
const result = await sql`SELECT * FROM bookings WHERE id = '${userId}'`;

// GOOD — parameterized
const result = await sql`SELECT * FROM bookings WHERE id = ${userId}`;
```
Check all `sql\`` template literals — ensure values are interpolated as template parameters, not string-concatenated before the template.

### 2. Webhook Signature Bypass
Every webhook must verify the provider's HMAC before processing:
```typescript
// Stripe
const sig = req.headers.get('stripe-signature');
const event = stripe.webhooks.constructEvent(rawBody, sig, env.STRIPE_WEBHOOK_SECRET);

// Razorpay
const expectedSig = createHmac('sha256', env.RAZORPAY_WEBHOOK_SECRET)
  .update(rawBody).digest('hex');
if (sig !== expectedSig) return c.json({ error: 'invalid signature' }, 400);
```

### 3. Auth Bypass
Every protected route must check the appropriate auth header:
```typescript
// Bro client routes
const key = c.req.header('x-bro-key');
if (key !== env.BRO_CLIENT_KEY) return c.json({ error: 'unauthorized' }, 401);

// Admin routes
const key = c.req.header('x-admin-key');
if (key !== env.ADMIN_KEY) return c.json({ error: 'unauthorized' }, 401);
```

### 4. Secret Exposure in Logs
Never log secrets or PII:
```typescript
// BAD
broLog('payment', { stripeKey: env.STRIPE_SECRET_KEY, cardNumber: '4111...' });

// GOOD
broLog('payment', { stripeCustomerId: session.customer, amount: session.amount_total });
```

### 5. Edge Compatibility
Workers run in V8 isolates — no Node.js APIs:
```typescript
// BAD
import crypto from 'crypto';         // Node crypto
import fs from 'fs';                  // Node fs
const buf = Buffer.from(data);        // Node Buffer (sometimes ok but prefer TextEncoder)

// GOOD
const hash = await crypto.subtle.digest('SHA-256', data);  // Web Crypto API
const encoder = new TextEncoder();
```

### 6. CORS & Origin Validation
Ensure CORS is not open to `*` on sensitive endpoints:
```typescript
// Review all app.use(cors(...)) calls
// Admin endpoints should never allow wildcard origins
```

### 7. Rate Limiting / Abuse
High-cost endpoints need protection:
- `/api/concierge/intent` — calls Claude API, Darwin, IRCTC
- `/api/admin/*` — admin endpoints

Check for rate limiting middleware or IP-based throttling.

---

## Output Format

Report findings as:
```
[CRITICAL] apps/api-edge/src/routes/concierge.ts:142
SQL injection possible — user transcript appended directly to query string.
Fix: Use parameterized sql`` literal.

[HIGH] apps/api-edge/src/routes/stripeWebhooks.ts:89
Webhook processes event before signature verification.
Fix: Move constructEvent() call to top of handler before any DB access.
```

Severity levels:
- **CRITICAL**: Active exploit path, fix before any deploy
- **HIGH**: Likely exploitable under normal conditions
- **MEDIUM**: Exploitable only in specific conditions
- **LOW**: Defense-in-depth improvement
