# AgentPay lifecycle emails (Stripe → Resend via Cloudflare Worker)

Every product user gets emailed like a top startup: welcome on purchase, dunning on failed payment,
winback on cancellation. Stripe-native receipts + refund emails are already ON in the dashboard
(enabled 2026-07-07). This worker adds the lifecycle layer.

## Deploy (blocked only on Cloudflare auth — 5 min once available)
1. `cd ~/Agentpay/workers/lifecycle-emails && npx wrangler login`  (or export CLOUDFLARE_API_TOKEN — token lives on Lenovo)
2. Resend: create account, verify domain agentpay.so (DNS records via Cloudflare), get API key.
   (Alternative: keep Cloudflare Email Routing for inbound; Resend handles outbound.)
3. `npx wrangler secret put RESEND_API_KEY` · `npx wrangler secret put STRIPE_WEBHOOK_SECRET`
4. `npx wrangler deploy`
5. Stripe dashboard → Developers → Webhooks → Add endpoint `https://hooks.agentpay.so/stripe/lifecycle`
   with events: checkout.session.completed, invoice.payment_failed, customer.subscription.deleted.
   Copy the signing secret into step 3.
6. Prove: Stripe "Send test webhook" for each event; confirm 3 emails arrive.

## Design notes
- Signature-verified (HMAC SHA-256, 5-min replay window); unknown events ack'd + ignored (fail-closed).
- Reply-to lands at Rajiv_Baskaran@agentpay.so via Cloudflare Email Routing (inbound already built).
- Copy voice: human founder, one CTA per email, no marketing fluff in transactional mail.
