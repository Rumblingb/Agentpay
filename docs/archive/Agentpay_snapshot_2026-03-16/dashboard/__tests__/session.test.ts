/**
 * Unit tests for the cookie session signing/verification helper.
 * Tests run in Node.js ≥18 which exposes globalThis.crypto (Web Crypto API).
 */

import { signSession, verifySession } from '../lib/session';

const TEST_SECRET = 'test-secret-that-is-at-least-32-characters-long';

beforeAll(() => {
  process.env.DASHBOARD_SESSION_SECRET = TEST_SECRET;
});

afterAll(() => {
  delete process.env.DASHBOARD_SESSION_SECRET;
});

describe('signSession / verifySession', () => {
  it('produces a cookie string with two dot-separated base64url parts', async () => {
    const cookie = await signSession({ apiKey: 'ap_testkey', email: 'merchant@example.com' });
    const parts = cookie.split('.');
    expect(parts).toHaveLength(2);
    // both parts should be non-empty base64url strings
    expect(parts[0].length).toBeGreaterThan(0);
    expect(parts[1].length).toBeGreaterThan(0);
  });

  it('round-trips the payload correctly', async () => {
    const cookie = await signSession({ apiKey: 'ap_abc123', email: 'test@example.com' });
    const payload = await verifySession(cookie);
    expect(payload).not.toBeNull();
    expect(payload!.apiKey).toBe('ap_abc123');
    expect(payload!.email).toBe('test@example.com');
    expect(typeof payload!.iat).toBe('number');
    expect(typeof payload!.exp).toBe('number');
    expect(payload!.exp).toBeGreaterThan(payload!.iat);
  });

  it('returns null for a tampered signature', async () => {
    const cookie = await signSession({ apiKey: 'ap_abc123', email: 'test@example.com' });
    // Flip the last character to corrupt the signature
    const tampered = cookie.slice(0, -1) + (cookie.endsWith('A') ? 'B' : 'A');
    const result = await verifySession(tampered);
    expect(result).toBeNull();
  });

  it('returns null for a tampered payload', async () => {
    const cookie = await signSession({ apiKey: 'ap_abc123', email: 'test@example.com' });
    const [encodedPayload, sig] = cookie.split('.');
    // Decode, mutate, re-encode WITHOUT updating the signature
    const original = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString());
    original.email = 'attacker@evil.com';
    const mutated = Buffer.from(JSON.stringify(original)).toString('base64url');
    const result = await verifySession(`${mutated}.${sig}`);
    expect(result).toBeNull();
  });

  it('returns null for an expired session', async () => {
    const cookie = await signSession({ apiKey: 'ap_abc123', email: 'test@example.com' });
    const [encodedPayload] = cookie.split('.');
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString());

    // Build an expired payload and sign it properly
    payload.exp = Math.floor(Date.now() / 1000) - 10; // 10 seconds in the past
    const expiredEncoded = Buffer.from(JSON.stringify(payload)).toString('base64url');

    // Sign with the same secret so verification passes the HMAC check but fails the expiry check
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(TEST_SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(expiredEncoded));
    const validExpiredCookie = `${expiredEncoded}.${Buffer.from(sig).toString('base64url')}`;

    const result = await verifySession(validExpiredCookie);
    expect(result).toBeNull();
  });

  it('returns null for an empty string', async () => {
    expect(await verifySession('')).toBeNull();
  });

  it('returns null for a cookie with no dot separator', async () => {
    expect(await verifySession('nodothere')).toBeNull();
  });
});
