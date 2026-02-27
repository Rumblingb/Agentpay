import crypto from 'crypto';

export type WebhookEventType = string;

export interface WebhookEvent {
  event: WebhookEventType;
  data: unknown;
  timestamp: string;
}

/**
 * Verify the HMAC-SHA256 signature of an incoming webhook payload.
 * Returns true if the signature is valid.
 */
export function verifyWebhookSignature(
  rawBody: string,
  signature: string,
  secret: string,
): boolean {
  const expected = 'sha256=' + crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

/**
 * Parse a verified webhook payload into a typed event.
 * Throws if the signature is invalid.
 */
export function parseWebhookEvent(
  rawBody: string,
  signature: string,
  secret: string,
): WebhookEvent {
  if (!verifyWebhookSignature(rawBody, signature, secret)) {
    throw new Error('Invalid webhook signature');
  }
  return JSON.parse(rawBody) as WebhookEvent;
}
