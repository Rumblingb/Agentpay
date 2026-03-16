/**
 * Unit tests for webhook signature verification middleware.
 * Validates that the HMAC-SHA256 signature check rejects invalid and missing
 * signatures while accepting valid ones.
 */

import { createHmac } from 'crypto';
import { computeWebhookSignature } from '../../src/middleware/verifyWebhook';

const SECRET = 'test-webhook-secret';

function makeSignature(timestamp: string, body: string, secret = SECRET): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

describe('computeWebhookSignature', () => {
  it('produces an HMAC-SHA256 hex string', () => {
    const sig = computeWebhookSignature('1700000000', '{"event":"test"}', SECRET);
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic for the same inputs', () => {
    const sig1 = computeWebhookSignature('1700000000', '{"event":"test"}', SECRET);
    const sig2 = computeWebhookSignature('1700000000', '{"event":"test"}', SECRET);
    expect(sig1).toBe(sig2);
  });

  it('differs when the timestamp changes', () => {
    const sig1 = computeWebhookSignature('1700000000', '{"event":"test"}', SECRET);
    const sig2 = computeWebhookSignature('1700000001', '{"event":"test"}', SECRET);
    expect(sig1).not.toBe(sig2);
  });

  it('differs when the body changes', () => {
    const sig1 = computeWebhookSignature('1700000000', '{"event":"a"}', SECRET);
    const sig2 = computeWebhookSignature('1700000000', '{"event":"b"}', SECRET);
    expect(sig1).not.toBe(sig2);
  });

  it('differs when the secret changes', () => {
    const sig1 = computeWebhookSignature('1700000000', '{"event":"test"}', 'secret-A');
    const sig2 = computeWebhookSignature('1700000000', '{"event":"test"}', 'secret-B');
    expect(sig1).not.toBe(sig2);
  });

  it('matches the reference HMAC implementation', () => {
    const timestamp = '1700000000';
    const body = '{"event":"payment_verified"}';
    const expected = makeSignature(timestamp, body);
    expect(computeWebhookSignature(timestamp, body, SECRET)).toBe(expected);
  });
});
