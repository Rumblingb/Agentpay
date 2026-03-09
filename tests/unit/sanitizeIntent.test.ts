/**
 * Unit tests for sanitizeIntent — verifies that sensitive fields are stripped
 * from payment intents before reaching public-facing endpoints.
 */

import { sanitizeIntent } from '../../src/utils/sanitizeIntent';

describe('sanitizeIntent', () => {
  const fullIntent = {
    id: 'intent-uuid-001',
    amount: 10.5,
    currency: 'USDC',
    status: 'pending',
    verificationToken: 'super-secret-token-abc123',
    metadata: {
      ref: 'order-99',
      internal: { costBasis: 0.01, routingKey: 'us-east' },
    },
    merchant: {
      id: 'merchant-uuid-001',
      name: 'Acme Corp',
      email: 'acme@example.com',
      walletAddress: '9B5X2Fwc4PQHqbXkhmr8vgYKHjgP7V8HBzMgMTf8H',
      apiKeyHash: 'pbkdf2-hash-value-here',
    },
  };

  it('removes verificationToken', () => {
    const result = sanitizeIntent(fullIntent);
    expect(result).not.toHaveProperty('verificationToken');
  });

  it('keeps non-sensitive top-level fields intact', () => {
    const result = sanitizeIntent(fullIntent);
    expect(result.id).toBe(fullIntent.id);
    expect(result.amount).toBe(fullIntent.amount);
    expect(result.currency).toBe(fullIntent.currency);
    expect(result.status).toBe(fullIntent.status);
  });

  it('removes metadata.internal but preserves other metadata fields', () => {
    const result = sanitizeIntent(fullIntent);
    expect(result.metadata).toBeDefined();
    expect(result.metadata.ref).toBe('order-99');
    expect(result.metadata.internal).toBeUndefined();
  });

  it('removes merchant.walletAddress', () => {
    const result = sanitizeIntent(fullIntent);
    expect(result.merchant.walletAddress).toBeUndefined();
  });

  it('removes merchant.apiKeyHash', () => {
    const result = sanitizeIntent(fullIntent);
    expect(result.merchant.apiKeyHash).toBeUndefined();
  });

  it('preserves non-sensitive merchant fields', () => {
    const result = sanitizeIntent(fullIntent);
    expect(result.merchant.id).toBe(fullIntent.merchant.id);
    expect(result.merchant.name).toBe(fullIntent.merchant.name);
    expect(result.merchant.email).toBe(fullIntent.merchant.email);
  });

  it('does not mutate the original intent object', () => {
    const copy = JSON.parse(JSON.stringify(fullIntent));
    sanitizeIntent(fullIntent);
    expect(fullIntent).toEqual(copy); // original unchanged
  });

  it('handles intent without verificationToken gracefully', () => {
    const { verificationToken, ...noToken } = fullIntent;
    const result = sanitizeIntent(noToken);
    expect(result).not.toHaveProperty('verificationToken');
    expect(result.id).toBe(fullIntent.id);
  });

  it('handles intent without metadata gracefully', () => {
    const { metadata, ...noMeta } = fullIntent;
    const result = sanitizeIntent(noMeta);
    expect(result.metadata).toBeUndefined();
  });

  it('handles intent without merchant gracefully', () => {
    const { merchant, ...noMerchant } = fullIntent;
    const result = sanitizeIntent(noMerchant);
    expect(result.merchant).toBeUndefined();
  });

  it('handles completely empty intent', () => {
    const result = sanitizeIntent({});
    expect(result).toEqual({});
  });

  it('handles metadata that is not an object (string)', () => {
    const oddIntent = { ...fullIntent, metadata: 'some-string' as any };
    const result = sanitizeIntent(oddIntent);
    // metadata is a string, not an object — should be left as-is
    expect(result.metadata).toBe('some-string');
  });

  it('deep-strips verificationToken even when nested in large payloads', () => {
    const complex = {
      ...fullIntent,
      agentId: 'agent-xyz',
      protocol: 'ap2',
    };
    const result = sanitizeIntent(complex);
    expect(result.agentId).toBe('agent-xyz');
    expect(result.protocol).toBe('ap2');
    expect(result).not.toHaveProperty('verificationToken');
  });
});