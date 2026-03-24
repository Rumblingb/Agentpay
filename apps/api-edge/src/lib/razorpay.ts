/**
 * razorpay.ts — Razorpay API client for Cloudflare Workers
 *
 * Handles:
 *   - Creating UPI payment links (users pay via any UPI app)
 *   - Verifying webhook signatures (HMAC-SHA256)
 *
 * Docs: https://razorpay.com/docs/payments/payment-links/apis/
 */

import type { Env } from '../types';

export interface CreateUpiPaymentLinkParams {
  amountInr: number;
  description: string;
  customerName?: string;
  customerPhone?: string;
  customerEmail?: string;
  receipt: string;
  referenceId?: string;
  notes?: Record<string, string>;
  callbackUrl?: string;
}

export interface UpiPaymentLinkResult {
  paymentLinkId: string;
  shortUrl: string;
  upiQrString: string;
}

/**
 * Create a Razorpay UPI payment link.
 * Uses Basic Auth: base64(key_id:key_secret).
 * Returns paymentLinkId, shortUrl, and a raw UPI deep link string.
 */
export async function createUpiPaymentLink(
  env: Env,
  params: CreateUpiPaymentLinkParams,
): Promise<UpiPaymentLinkResult> {
  const {
    amountInr,
    description,
    customerName,
    customerPhone,
    customerEmail,
    receipt,
    referenceId,
    notes,
    callbackUrl,
  } = params;

  const credentials = btoa(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`);

  const body: Record<string, unknown> = {
    upi_link: true,
    amount: Math.round(amountInr * 100), // paise
    currency: 'INR',
    description,
    receipt,
    customer: {
      name:    customerName  ?? 'AgentPay Customer',
      contact: customerPhone ?? '',
      email:   customerEmail ?? '',
    },
    notify: {
      sms:   false,
      email: false,
    },
    reminder_enable: false,
  };

  if (referenceId) body.reference_id = referenceId;
  if (notes && Object.keys(notes).length > 0) body.notes = notes;
  if (callbackUrl) {
    body.callback_url = callbackUrl;
    body.callback_method = 'get';
  }

  const res = await fetch('https://api.razorpay.com/v1/payment_links', {
    method:  'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Razorpay payment link creation failed (${res.status}): ${text}`);
  }

  const data = await res.json() as {
    id:        string;
    short_url: string;
  };

  const upiQrString = `upi://pay?pa=agentpay@razorpay&pn=AgentPay&am=${amountInr}&cu=INR&tn=${encodeURIComponent(description)}`;

  return {
    paymentLinkId: data.id,
    shortUrl:      data.short_url,
    upiQrString,
  };
}

/**
 * Verify a Razorpay webhook signature.
 * Razorpay signs the raw body with HMAC-SHA256 using the webhook secret.
 * Compare with X-Razorpay-Signature header (hex digest).
 */
export async function verifyRazorpayWebhook(
  secret: string,
  body: string,
  signature: string,
): Promise<boolean> {
  const enc = new TextEncoder();

  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const sigBytes = await crypto.subtle.sign('HMAC', key, enc.encode(body));

  // Convert ArrayBuffer to hex string
  const hexSig = Array.from(new Uint8Array(sigBytes))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  // Constant-time comparison — both strings same length (64 hex chars)
  if (hexSig.length !== signature.length) return false;

  let diff = 0;
  for (let i = 0; i < hexSig.length; i++) {
    diff |= hexSig.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return diff === 0;
}
