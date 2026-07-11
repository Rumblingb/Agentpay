/**
 * AgentPay lifecycle emails — Stripe webhook → customer email via Resend.
 * Events: checkout completed (welcome), payment failed (dunning),
 * subscription canceled (winback), refund (confirmation handled by Stripe native).
 * Fail-closed: unknown events are acknowledged and ignored.
 */
export interface Env {
  STRIPE_WEBHOOK_SECRET: string;
  RESEND_API_KEY: string;
  FROM_ADDRESS: string; // e.g. "AgentPay <updates@agentpay.so>"
}

async function verifyStripeSignature(payload: string, header: string, secret: string): Promise<boolean> {
  const parts = Object.fromEntries(header.split(",").map(kv => kv.split("=") as [string, string]));
  const t = parts["t"], v1 = parts["v1"];
  if (!t || !v1) return false;
  // reject stale events (>5 min) to block replays
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${payload}`));
  const hex = [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, "0")).join("");
  return hex === v1;
}

const templates: Record<string, (o: any) => { subject: string; html: string } | null> = {
  "checkout.session.completed": (s) => ({
    subject: "Welcome to AgentPay — you're in",
    html: `<p>Hi${s.customer_details?.name ? " " + s.customer_details.name.split(" ")[0] : ""},</p>
<p>Thanks for your purchase — your access is live now.</p>
<p><b>What happens next:</b></p>
<ul><li>Your product is active at <a href="https://dashboard.agentpay.so">dashboard.agentpay.so</a></li>
<li>Docs and quickstart: <a href="https://docs.agentpay.so">docs.agentpay.so</a></li>
<li>Reply to this email any time — a human founder reads it.</li></ul>
<p>— Rajiv, AgentPay</p>`,
  }),
  "invoice.payment_failed": (inv) => ({
    subject: "Action needed: your AgentPay payment didn't go through",
    html: `<p>Hi,</p><p>Your latest payment for AgentPay didn't complete. Your access is safe for now —
we'll retry automatically, but you can fix it in one click:</p>
<p><a href="${inv.hosted_invoice_url ?? "https://dashboard.agentpay.so"}">Update payment method</a></p>
<p>Questions? Just reply. — AgentPay</p>`,
  }),
  "customer.subscription.deleted": () => ({
    subject: "Your AgentPay subscription has ended",
    html: `<p>Hi,</p><p>Your subscription is now canceled — no further charges. Your data is retained
for 30 days if you change your mind.</p>
<p>If something didn't work for you, reply and tell us — we read every message and it shapes what we build.</p>
<p>— Rajiv, AgentPay</p>`,
  }),
};

async function emailFor(event: any, env: Env): Promise<Response> {
  const make = templates[event.type];
  if (!make) return new Response("ignored", { status: 200 });
  const obj = event.data.object;
  const to = obj.customer_details?.email ?? obj.customer_email ?? null;
  if (!to) return new Response("no recipient", { status: 200 });
  const msg = make(obj);
  if (!msg) return new Response("no template", { status: 200 });
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env.FROM_ADDRESS, to, subject: msg.subject, html: msg.html }),
  });
  return new Response(r.ok ? "sent" : "send failed", { status: r.ok ? 200 : 500 });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method !== "POST") return new Response("ok", { status: 200 });
    const payload = await req.text();
    const sig = req.headers.get("stripe-signature") ?? "";
    if (!(await verifyStripeSignature(payload, sig, env.STRIPE_WEBHOOK_SECRET)))
      return new Response("bad signature", { status: 400 });
    return emailFor(JSON.parse(payload), env);
  },
};
