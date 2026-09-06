jest.mock('../../apps/api-edge/src/lib/db', () => {
  const actual = jest.requireActual('../../apps/api-edge/src/lib/db');
  return {
    ...actual,
    createDb: jest.fn(),
  };
});

import { createDb } from '../../apps/api-edge/src/lib/db';
import apiEdge from '../../apps/api-edge/src/index';

const TREASURY = '3gnAvryBAuZXCoY95mjwQYud4ep3J8f4KH6ZUPuQnajd';
const MERCHANT_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

function makeSql(responses: unknown[]) {
  const queue = [...responses];
  const sql = (jest.fn(async () => queue.shift() ?? []) as unknown) as jest.Mock & {
    end: jest.Mock;
  };
  sql.end = jest.fn().mockResolvedValue(undefined);
  return sql;
}

function appEnv(extra: Record<string, unknown> = {}) {
  return {
    DATABASE_URL: 'postgres://agentpay:test@localhost:5432/agentpay',
    WEBHOOK_SECRET: 'w'.repeat(32),
    AGENTPAY_SIGNING_SECRET: 's'.repeat(32),
    VERIFICATION_SECRET: 'v'.repeat(32),
    ADMIN_SECRET_KEY: 'a'.repeat(32),
    CORS_ORIGIN: 'http://localhost:3000',
    API_BASE_URL: 'http://agentpay.test',
    FRONTEND_URL: 'https://agentpay.so',
    AGENTPAY_TEST_MODE: 'true',
    NODE_ENV: 'development',
    ...extra,
  } as never;
}

async function createIntent(env: Record<string, unknown>, amount = 10) {
  return apiEdge.fetch(
    new Request('http://agentpay.test/api/v1/payment-intents', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        merchantId: MERCHANT_ID,
        agentId: 'agent-launch-1',
        amount,
        currency: 'USDC',
      }),
    }),
    appEnv(env),
    {} as never,
  );
}

describe('POST /api/v1/payment-intents recipient and spend ceiling', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    (createDb as jest.Mock).mockReset();
  });

  it('fails honestly when no recipient is configured instead of returning solana:null', async () => {
    (createDb as jest.Mock).mockReturnValue(makeSql([
      [{
        id: MERCHANT_ID,
        walletAddress: null,
        webhookUrl: null,
        stripeConnectedAccountId: null,
        hostedMcpPlanCode: 'launch',
        pricingOverride: { spendLimitUsd: 25 },
      }],
    ]));

    const res = await createIntent({});
    const body = await res.json() as Record<string, unknown>;
    expect(res.status).toBe(503);
    expect(body.error).toBe('RECIPIENT_NOT_CONFIGURED');
    expect(body.recipientAddress).toBeUndefined();
    expect(JSON.stringify(body)).not.toMatch(/solana:null/);
    expect(body.requiredEnv).toEqual(['PLATFORM_TREASURY_WALLET']);
  });

  it('uses PLATFORM_TREASURY_WALLET when the merchant wallet is missing', async () => {
    (createDb as jest.Mock).mockReturnValue(makeSql([
      [{
        id: MERCHANT_ID,
        walletAddress: null,
        webhookUrl: null,
        stripeConnectedAccountId: null,
        hostedMcpPlanCode: 'launch',
        pricingOverride: { spendLimitUsd: 25 },
      }],
      [],
      [],
      [],
      [],
      [],
      [],
    ]));

    const res = await createIntent({ PLATFORM_TREASURY_WALLET: TREASURY });
    const body = await res.json() as Record<string, unknown>;
    expect(res.status).toBe(201);
    const instructions = body.instructions as { crypto?: { recipientAddress?: string; solanaPayUri?: string } };
    expect(instructions.crypto?.recipientAddress).toBe(TREASURY);
    expect(instructions.crypto?.solanaPayUri).toContain(`solana:${TREASURY}`);
    expect(instructions.crypto?.solanaPayUri).not.toContain('solana:null');
  });

  it('rejects over-limit spend for Launch keys', async () => {
    (createDb as jest.Mock).mockReturnValue(makeSql([
      [{
        id: MERCHANT_ID,
        walletAddress: TREASURY,
        webhookUrl: null,
        stripeConnectedAccountId: null,
        hostedMcpPlanCode: 'launch',
        pricingOverride: { spendLimitUsd: 25 },
      }],
    ]));

    const res = await createIntent({ PLATFORM_TREASURY_WALLET: TREASURY }, 40);
    const body = await res.json() as Record<string, unknown>;
    expect(res.status).toBe(403);
    expect(body.error).toBe('SPEND_LIMIT_EXCEEDED');
    expect(body.limitUsd).toBe(25);
  });
});

describe('missing-key guardrail', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    (createDb as jest.Mock).mockReset();
  });

  it('returns AUTH_MISSING instead of copy when the API key is absent', async () => {
    (createDb as jest.Mock).mockReturnValue(makeSql([]));
    const res = await apiEdge.fetch(
      new Request('http://agentpay.test/api/intents', { method: 'GET' }),
      appEnv(),
      {} as never,
    );
    const body = await res.json() as Record<string, unknown>;
    expect(res.status).toBe(401);
    expect(body.code).toBe('AUTH_MISSING');
    expect(body.message).toMatch(/token or API key/i);
  });
});
