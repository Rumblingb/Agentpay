import { AgentPayClient } from '../src/client';
import { readEnv } from '../src/env';
import { AuthError, RateLimitError, NotFoundError } from '../src/errors';

describe('AgentPayClient PR1', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...OLD_ENV };
    (global as any).fetch = jest.fn();
  });
  afterEach(() => {
    process.env = OLD_ENV;
    jest.clearAllMocks();
  });

  test('fromEnv throws when AGENTPAY_API_KEY missing', () => {
    delete process.env.AGENTPAY_API_KEY;
    expect(() => AgentPayClient.fromEnv()).toThrow(/AGENTPAY_API_KEY/);
  });

  test('getProfile injects auth header', async () => {
    process.env.AGENTPAY_API_KEY = 'test_key';
    const client = AgentPayClient.fromEnv();
    (global as any).fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, text: async () => JSON.stringify({ merchantId: 'm1', email: 'a@b' }) });
    const profile = await client.getProfile();
    expect(profile.email).toBe('a@b');
    expect((global as any).fetch).toHaveBeenCalled();
    const callArgs = (global as any).fetch.mock.calls[0];
    const headers = callArgs[1].headers;
    expect(headers.Authorization).toBe('Bearer test_key');
  });

  test('pay() success normalization', async () => {
    const client = new AgentPayClient({ auth: { apiKey: 'k' }, baseUrl: 'https://api.test' });
    const response = { transactionId: 'uuid-1', paymentId: 'payment-1', amount: 5, recipientAddress: 'recipient_1', createdAt: new Date().toISOString(), payerAddress: null, transactionHash: null, status: 'pending' };
    (global as any).fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, text: async () => JSON.stringify(response) });
    const p = await client.pay({ amountUsdc: 5, recipientAddress: 'recipient_1' });
    expect(p.id).toBe('uuid-1');
    expect(p.paymentId).toBe('payment-1');
  });

  test('verifyPayment success', async () => {
    const client = new AgentPayClient({ auth: { apiKey: 'k' }, baseUrl: 'https://api.test' });
    const response = { status: 'confirmed' };
    (global as any).fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, text: async () => JSON.stringify(response) });
    const r = await client.verifyPayment('uuid-1', '0xabc');
    expect(r.verified).toBe(true);
  });

  test('verifyPayment beta returns verified false and raw preserved', async () => {
    const client = new AgentPayClient({ auth: { apiKey: 'k' }, baseUrl: 'https://api.test' });
    const response = { status: 'beta' };
    (global as any).fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, text: async () => JSON.stringify(response) });
    const r = await client.verifyPayment('uuid-1', '0xabc');
    expect(r.verified).toBe(false);
    expect(r.raw).toBeDefined();
    expect(r.raw.status).toBe('beta');
  });

  test('verifyPayment explicit verified true and verifiedAt preserved', async () => {
    const client = new AgentPayClient({ auth: { apiKey: 'k' }, baseUrl: 'https://api.test' });
    const response = { status: 'confirmed', verified: true, verifiedAt: '2026-03-15T12:00:00Z' };
    (global as any).fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, text: async () => JSON.stringify(response) });
    const r = await client.verifyPayment('uuid-1', '0xabc');
    expect(r.verified).toBe(true);
    expect(r.verifiedAt).toBe('2026-03-15T12:00:00Z');
  });

  test('verifyPayment surfaces proof unchanged', async () => {
    const client = new AgentPayClient({ auth: { apiKey: 'k' }, baseUrl: 'https://api.test' });
    const proof = { type: 'hmac', signature: 'sig', payload: { amount: 5 } };
    const response = { status: 'confirmed', verified: true, proof };
    (global as any).fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, text: async () => JSON.stringify(response) });
    const r = await client.verifyPayment('uuid-1', '0xabc');
    expect(r.proof).toEqual(proof);
  });

  test('verifyPayment 404 -> NotFoundError', async () => {
    const client = new AgentPayClient({ auth: { apiKey: 'k' }, baseUrl: 'https://api.test' });
    (global as any).fetch = jest.fn().mockResolvedValue({ ok: false, status: 404, text: async () => JSON.stringify({ message: 'not found' }) });
    await expect(client.verifyPayment('uuid-1', '0xabc')).rejects.toThrow(NotFoundError);
  });

  test('verifyPayment malformed response handled conservatively', async () => {
    const client = new AgentPayClient({ auth: { apiKey: 'k' }, baseUrl: 'https://api.test' });
    (global as any).fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, text: async () => 'not-json' });
    const r = await client.verifyPayment('uuid-1', '0xabc');
    expect(r.verified).toBe(false);
    expect(r.raw).toBeUndefined();
    expect(r.id).toBe('uuid-1');
  });

  test('401 -> AuthError', async () => {
    const client = new AgentPayClient({ auth: { apiKey: 'k' }, baseUrl: 'https://api.test' });
    (global as any).fetch = jest.fn().mockResolvedValue({ ok: false, status: 401, text: async () => JSON.stringify({ message: 'unauth' }) });
    await expect(client.getProfile()).rejects.toThrow(AuthError);
  });

  test('429 -> RateLimitError', async () => {
    const client = new AgentPayClient({ auth: { apiKey: 'k' }, baseUrl: 'https://api.test' });
    (global as any).fetch = jest.fn().mockResolvedValue({ ok: false, status: 429, text: async () => JSON.stringify({ message: 'slow down' }) });
    await expect(client.getProfile()).rejects.toThrow(RateLimitError);
  });
});
