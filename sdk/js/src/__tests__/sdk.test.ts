import { jest, describe, it, expect, afterEach } from '@jest/globals';
import {
  createIntent,
  getIntentStatus,
  waitForVerification,
  validateCertificate,
  createAgentIntent,
  getAgentIntentStatus,
  waitForAgentVerification,
  AgentPayError,
  IntentExpiredError,
  VerificationFailedError,
  VerificationTimeoutError,
} from '../index.js';
import type {
  AgentPayConfig,
  AgentPayAgentConfig,
  IntentStatusResponse,
  AgentIntentStatusResponse,
} from '../index.js';

// ---- helpers ----------------------------------------------------------------

const config: AgentPayConfig = {
  baseUrl: 'https://api.agentpay.io',
  apiKey: 'test-api-key',
};

const agentConfig: AgentPayAgentConfig = {
  baseUrl: 'https://api.agentpay.io',
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
      'https://api.agentpay.io/api/intents',
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
      'https://api.agentpay.io/api/intents/intent_abc/status',
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
      'https://api.agentpay.io/api/certificates/validate',
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

// ---- createAgentIntent ------------------------------------------------------

describe('createAgentIntent', () => {
  it('posts to /api/v1/payment-intents without Authorization header', async () => {
    const mockResponse = {
      success: true,
      intentId: 'intent_agent_001',
      verificationToken: 'APV_1700000000000_aabbccdd',
      expiresAt: '2026-01-01T00:00:00Z',
      instructions: {
        crypto: {
          network: 'solana',
          token: 'USDC',
          recipientAddress: '5YNmS1R9n7VBjnMjhkKLhUXZhiANpvKaQYV8j8PqD',
          amount: 10,
          memo: 'APV_1700000000000_aabbccdd',
          solanaPayUri: 'solana:5YNmS1R9n7...?amount=10&memo=APV_...',
        },
      },
    };
    mockFetch(mockResponse, 201);

    const result = await createAgentIntent(
      agentConfig,
      'merchant-uuid-001',
      'agent-wallet-abc',
      10,
      'USDC',
    );

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.agentpay.io/api/v1/payment-intents',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          merchantId: 'merchant-uuid-001',
          agentId: 'agent-wallet-abc',
          amount: 10,
          currency: 'USDC',
        }),
      }),
    );
    // No Authorization header for agent calls
    const callArgs = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
    const headers = callArgs[1].headers as Record<string, string>;
    expect(headers['Authorization']).toBeUndefined();

    expect(result.intentId).toBe('intent_agent_001');
    expect(result.instructions.crypto.network).toBe('solana');
  });

  it('includes metadata when provided', async () => {
    mockFetch({ success: true, intentId: 'intent_agent_002', verificationToken: 'APV_123', expiresAt: '2026-01-01T00:00:00Z', instructions: { crypto: { network: 'solana', token: 'USDC', recipientAddress: 'addr', amount: 5, memo: 'APV_123', solanaPayUri: 'solana:addr' } } }, 201);

    await createAgentIntent(agentConfig, 'merchant-id', 'agent-id', 5, 'USDC', { sessionId: 'sess_123' });

    const callArgs = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(callArgs[1].body as string);
    expect(body.metadata).toEqual({ sessionId: 'sess_123' });
  });

  it('throws AgentPayError on 404 (merchant not found)', async () => {
    mockFetch({ error: 'Merchant not found' }, 404);
    await expect(
      createAgentIntent(agentConfig, 'unknown-merchant', 'agent-id', 10),
    ).rejects.toThrow(AgentPayError);
  });
});

// ---- getAgentIntentStatus ---------------------------------------------------

describe('getAgentIntentStatus', () => {
  it('GETs /api/v1/payment-intents/:intentId without Authorization header', async () => {
    const mockStatus: AgentIntentStatusResponse = {
      success: true,
      intentId: 'intent_agent_abc',
      merchantId: 'merchant-uuid-001',
      amount: 10,
      currency: 'USDC',
      status: 'pending',
      verificationToken: 'APV_1700000000000_aabbccdd',
      expiresAt: '2026-01-01T00:00:00Z',
    };
    mockFetch(mockStatus);

    const result = await getAgentIntentStatus(agentConfig, 'intent_agent_abc');

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.agentpay.io/api/v1/payment-intents/intent_agent_abc',
      expect.objectContaining({ method: 'GET' }),
    );
    const callArgs = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
    const headers = callArgs[1].headers as Record<string, string>;
    expect(headers['Authorization']).toBeUndefined();

    expect(result.intentId).toBe('intent_agent_abc');
    expect(result.status).toBe('pending');
  });

  it('throws AgentPayError with 404 when intent not found', async () => {
    mockFetch({ error: 'Payment intent not found' }, 404);
    await expect(
      getAgentIntentStatus(agentConfig, 'missing-intent'),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});

// ---- waitForAgentVerification -----------------------------------------------

describe('waitForAgentVerification', () => {
  it('resolves when agent intent becomes verified', async () => {
    const verified: AgentIntentStatusResponse = {
      success: true,
      intentId: 'intent_av',
      merchantId: 'merchant-uuid-001',
      amount: 10,
      currency: 'USDC',
      status: 'verified',
      verificationToken: 'APV_123',
      expiresAt: '2026-01-01T00:00:00Z',
    };
    mockFetch(verified);

    const result = await waitForAgentVerification(agentConfig, 'intent_av', 5000, 100);
    expect(result.status).toBe('verified');
  });

  it('throws IntentExpiredError when agent intent expires', async () => {
    const expired: AgentIntentStatusResponse = {
      success: true,
      intentId: 'intent_ae',
      merchantId: 'merchant-uuid-001',
      amount: 10,
      currency: 'USDC',
      status: 'expired',
      verificationToken: 'APV_123',
      expiresAt: '2020-01-01T00:00:00Z',
    };
    mockFetch(expired);

    await expect(
      waitForAgentVerification(agentConfig, 'intent_ae', 5000, 100),
    ).rejects.toThrow(IntentExpiredError);
  });

  it('throws VerificationTimeoutError when polling exceeds timeout', async () => {
    const pending: AgentIntentStatusResponse = {
      success: true,
      intentId: 'intent_ap',
      merchantId: 'merchant-uuid-001',
      amount: 10,
      currency: 'USDC',
      status: 'pending',
      verificationToken: 'APV_123',
      expiresAt: '2026-01-01T00:00:00Z',
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(pending),
    }) as any;

    await expect(
      waitForAgentVerification(agentConfig, 'intent_ap', 50, 10),
    ).rejects.toThrow(VerificationTimeoutError);
  });
});
