import { jest, describe, it, expect, afterEach } from '@jest/globals';
import {
  createIntent,
  getIntentStatus,
  waitForVerification,
  validateCertificate,
  AgentPayError,
  IntentExpiredError,
  VerificationFailedError,
  VerificationTimeoutError,
} from '../index.js';
import type { AgentPayConfig, IntentStatusResponse } from '../index.js';

// ---- helpers ----------------------------------------------------------------

const config: AgentPayConfig = {
  baseUrl: 'https://api.agentpay.gg',
  apiKey: 'test-api-key',
};

/** Replace global fetch with a one-shot mock that returns `body` with `status`. */
function mockFetch(body: unknown, status = 200): void {
  const mockResponse = {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  global.fetch = jest.fn().mockResolvedValueOnce(mockResponse) as any;
}

afterEach(() => {
  jest.restoreAllMocks();
});

// ---- createIntent -----------------------------------------------------------

describe('createIntent', () => {
  it('posts to /api/intents and returns the response', async () => {
    const mockResponse = {
      intentId: 'intent_123',
      amount: 500,
      currency: 'USD',
      status: 'pending',
      expiresAt: '2026-01-01T00:00:00Z',
    };
    mockFetch(mockResponse);

    const result = await createIntent(config, 500, { orderId: 'ord_1' });

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.agentpay.gg/api/intents',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ amount: 500, metadata: { orderId: 'ord_1' } }),
      }),
    );
    expect(result).toEqual(mockResponse);
  });

  it('throws AgentPayError on non-2xx response', async () => {
    mockFetch({ error: 'Unauthorized' }, 401);

    await expect(createIntent(config, 100)).rejects.toThrow(AgentPayError);
  });
});

// ---- getIntentStatus --------------------------------------------------------

describe('getIntentStatus', () => {
  it('GETs /api/intents/:id/status', async () => {
    const mockStatus: IntentStatusResponse = {
      intentId: 'intent_abc',
      status: 'verified',
      amount: 200,
      currency: 'USD',
      expiresAt: '2026-01-01T00:00:00Z',
    };
    mockFetch(mockStatus);

    const result = await getIntentStatus(config, 'intent_abc');

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.agentpay.gg/api/intents/intent_abc/status',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(result).toEqual(mockStatus);
  });

  it('throws AgentPayError with status code on 404', async () => {
    mockFetch({ error: 'Intent not found' }, 404);

    await expect(getIntentStatus(config, 'missing')).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});

// ---- waitForVerification ----------------------------------------------------

describe('waitForVerification', () => {
  it('resolves immediately when intent is already verified', async () => {
    const verified: IntentStatusResponse = {
      intentId: 'intent_v',
      status: 'verified',
      amount: 100,
      currency: 'USD',
      expiresAt: '2026-01-01T00:00:00Z',
    };
    mockFetch(verified);

    const result = await waitForVerification(config, 'intent_v', 5000, 100);
    expect(result.status).toBe('verified');
  });

  it('throws IntentExpiredError when status is expired', async () => {
    const expired: IntentStatusResponse = {
      intentId: 'intent_e',
      status: 'expired',
      amount: 100,
      currency: 'USD',
      expiresAt: '2020-01-01T00:00:00Z',
    };
    mockFetch(expired);

    await expect(
      waitForVerification(config, 'intent_e', 5000, 100),
    ).rejects.toThrow(IntentExpiredError);
  });

  it('throws VerificationFailedError when status is failed', async () => {
    const failed: IntentStatusResponse = {
      intentId: 'intent_f',
      status: 'failed',
      amount: 100,
      currency: 'USD',
      expiresAt: '2026-01-01T00:00:00Z',
    };
    mockFetch(failed);

    await expect(
      waitForVerification(config, 'intent_f', 5000, 100),
    ).rejects.toThrow(VerificationFailedError);
  });

  it('throws VerificationTimeoutError when timeout elapses', async () => {
    const pending: IntentStatusResponse = {
      intentId: 'intent_p',
      status: 'pending',
      amount: 100,
      currency: 'USD',
      expiresAt: '2026-01-01T00:00:00Z',
    };
    // Always return pending
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(pending),
    }) as any;

    await expect(
      waitForVerification(config, 'intent_p', 50, 10),
    ).rejects.toThrow(VerificationTimeoutError);
  });
});

// ---- validateCertificate ----------------------------------------------------

describe('validateCertificate', () => {
  it('posts certificate to /api/certificates/validate', async () => {
    const mockResult = { valid: true, subject: 'CN=agent1' };
    mockFetch(mockResult);

    const cert = { certificate: 'base64encodedcert==', algorithm: 'RS256' };
    const result = await validateCertificate(config, cert);

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.agentpay.gg/api/certificates/validate',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(cert),
      }),
    );
    expect(result.valid).toBe(true);
  });

  it('returns valid: false for invalid certificate', async () => {
    mockFetch({ valid: false, error: 'Certificate expired' });

    const result = await validateCertificate(config, {
      certificate: 'bad_cert',
    });
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Certificate expired');
  });
});

// ---- error hierarchy --------------------------------------------------------

describe('error hierarchy', () => {
  it('IntentExpiredError is an AgentPayError', () => {
    const err = new IntentExpiredError('intent_x');
    expect(err).toBeInstanceOf(AgentPayError);
    expect(err).toBeInstanceOf(IntentExpiredError);
    expect(err.code).toBe('INTENT_EXPIRED');
    expect(err.statusCode).toBe(410);
  });

  it('VerificationFailedError is an AgentPayError', () => {
    const err = new VerificationFailedError('intent_y', 'bad sig');
    expect(err).toBeInstanceOf(AgentPayError);
    expect(err.code).toBe('VERIFICATION_FAILED');
  });

  it('VerificationTimeoutError is an AgentPayError', () => {
    const err = new VerificationTimeoutError('intent_z', 60000);
    expect(err).toBeInstanceOf(AgentPayError);
    expect(err.code).toBe('VERIFICATION_TIMEOUT');
  });
});
