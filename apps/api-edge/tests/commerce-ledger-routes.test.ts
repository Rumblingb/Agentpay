import { Hono } from 'hono';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  evaluateCommerceDecision,
  hashCommerceValue,
  normalizeBuyerConstitution,
  signCommerceDecision,
} from '../src/lib/commerceDecision';
import { pbkdf2Hex } from '../src/lib/pbkdf2';
import { commerceLedgerRouter } from '../src/routes/commerceLedger';
import type { Env, Variables } from '../src/types';

type QueryHandler = (text: string, values: unknown[]) => unknown[];
type FakeSql = {
  (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]>;
  begin<T>(callback: (sql: FakeSql) => Promise<T>): Promise<T>;
  end(): Promise<void>;
};

let activeSql: FakeSql;

vi.mock('../src/lib/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/db')>();
  return {
    ...actual,
    createDb: () => activeSql,
  };
});

const ORGANIZATION_A = '20000000-0000-4000-8000-000000000001';
const ORGANIZATION_B = '20000000-0000-4000-8000-000000000002';
const MEMBER_ID = '20000000-0000-4000-8000-000000000003';
const REQUEST_ID = '20000000-0000-4000-8000-000000000004';
const KEY_PREFIX = 'abcdef123456';
const RAW_KEY = '1'.repeat(64);
const KEY_SALT = '2'.repeat(64);
const ORGANIZATION_KEY = `org_${KEY_PREFIX}_${RAW_KEY}`;
const SIGNING_SECRET = 'route-test-commerce-signing-secret-long-enough';
const constitutionInput = {
  currency: 'GBP',
  maxTotalMinor: 9_000,
  allowedCategories: ['office'],
  blockedMerchants: [],
  requiresRefundable: true,
  minimumReturnWindowDays: 14,
  maximumDeliveryDays: 7,
  maxEvidenceAgeMinutes: 60,
  requireHumanApproval: true,
  weights: { price: 25, quality: 45, delivery: 15, sustainability: 15 },
};

let keyHash: string;
let policyHash: string;

function makeSql(
  handler: QueryHandler,
  role: 'owner' | 'admin' | 'requester' | 'approver' | 'auditor' = 'owner',
): FakeSql {
  const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    if (text.includes('FROM commerce_organization_credentials credential')) {
      return [{
        credentialId: '20000000-0000-4000-8000-000000000005',
        keyHash,
        keySalt: KEY_SALT,
        organizationId: ORGANIZATION_A,
        memberId: MEMBER_ID,
        principalType: role === 'requester' ? 'agent' : 'user',
        principalId: role === 'requester' ? 'request-agent' : 'buyer-owner',
        role,
      }];
    }
    if (text.includes('UPDATE commerce_organization_credentials')) return [];
    return handler(text, values);
  }) as FakeSql;
  sql.begin = async <T>(callback: (transaction: FakeSql) => Promise<T>) => callback(sql);
  sql.end = async () => {};
  return sql;
}

function requestRow(overrides: Record<string, unknown> = {}) {
  return {
    id: REQUEST_ID,
    organizationId: ORGANIZATION_A,
    costCenterId: null,
    requesterType: 'agent',
    requesterId: 'request-agent',
    agentId: 'request-agent',
    idempotencyKey: 'request-key-0001',
    intent: 'Buy compliant office equipment',
    state: 'evaluating',
    constitutionSnapshot: constitutionInput,
    policyHash,
    currency: 'GBP',
    maxTotalMinor: '9000',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function executionContext(): ExecutionContext {
  return {
    waitUntil: () => {},
    passThroughOnException: () => {},
    props: {},
  } as unknown as ExecutionContext;
}

function app() {
  const instance = new Hono<{ Bindings: Env; Variables: Variables }>();
  instance.route('/api/commerce/ledger', commerceLedgerRouter);
  return instance;
}

async function call(path: string, init?: RequestInit) {
  return app().request(
    `https://api.agentpay.test${path}`,
    {
      ...init,
      headers: {
        'content-type': 'application/json',
        'x-organization-key': ORGANIZATION_KEY,
        ...init?.headers,
      },
    },
    { DATABASE_URL: 'postgres://unused', AGENTPAY_SIGNING_SECRET: SIGNING_SECRET } as Env,
    executionContext(),
  );
}

async function signedDecision(
  intent: string,
  procurementRequestId = REQUEST_ID,
  requestApproval = true,
) {
  const now = new Date();
  const decision = await evaluateCommerceDecision({
    procurementRequestId,
    intent,
    constitution: { ...constitutionInput, requireHumanApproval: requestApproval },
    candidates: [{
      id: 'variant-1',
      name: 'Office chair',
      merchantId: 'seller-1',
      merchantName: 'Seller One',
      category: 'office',
      priceMinor: 5_000,
      currency: 'GBP',
      refundable: true,
      returnWindowDays: 30,
      deliveryDays: 3,
      qualityScore: 90,
      sustainabilityScore: 75,
      evidence: [{
        field: 'price_and_stock',
        value: 'In stock',
        source: 'https://seller.example/item',
        observedAt: now.toISOString(),
      }],
    }],
  }, now);
  return {
    decision,
    signature: await signCommerceDecision(decision, SIGNING_SECRET),
  };
}

beforeAll(async () => {
  keyHash = await pbkdf2Hex(RAW_KEY, KEY_SALT);
  policyHash = await hashCommerceValue(normalizeBuyerConstitution(constitutionInput));
});

beforeEach(() => {
  activeSql = makeSql(() => []);
});

describe('commerce ledger route boundaries', () => {
  it('hides procurement requests belonging to another organization', async () => {
    activeSql = makeSql((text, values) => {
      if (text.includes('FROM commerce_procurement_requests request')) {
        expect(values).toEqual([REQUEST_ID, ORGANIZATION_A]);
        return [];
      }
      return [];
    });

    const response = await call(`/api/commerce/ledger/requests/${REQUEST_ID}`);
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: 'REQUEST_NOT_FOUND' });
  });

  it('rejects a validly signed decision substituted from a different request', async () => {
    const signed = await signedDecision(
      'Buy compliant office equipment',
      '20000000-0000-4000-8000-000000000099',
    );
    activeSql = makeSql((text) => (
      text.includes('FROM commerce_procurement_requests request') ? [requestRow()] : []
    ));

    const response = await call(`/api/commerce/ledger/requests/${REQUEST_ID}/decisions`, {
      method: 'POST',
      body: JSON.stringify(signed),
    });
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: 'DECISION_DRIFT' });
  });

  it('rejects reuse of a request idempotency key with changed intent', async () => {
    activeSql = makeSql((text) => {
      if (text.includes('FROM commerce_organizations organization')) {
        return [{ id: ORGANIZATION_A, defaultCurrency: 'GBP' }];
      }
      if (text.startsWith('SELECT id, organization_id AS "organizationId"')) {
        return [requestRow({ intent: 'A different original intent', expiresAt: null })];
      }
      return [];
    });

    const response = await call('/api/commerce/ledger/requests', {
      method: 'POST',
      body: JSON.stringify({
        organizationId: ORGANIZATION_A,
        idempotencyKey: 'request-key-0001',
        intent: 'Buy compliant office equipment',
        constitution: constitutionInput,
      }),
    });
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: 'IDEMPOTENCY_CONFLICT' });
  });

  it('rejects decisions for expired procurement requests', async () => {
    const signed = await signedDecision('Buy compliant office equipment');
    activeSql = makeSql((text) => (
      text.includes('FROM commerce_procurement_requests request')
        ? [requestRow({ expiresAt: new Date(Date.now() - 60_000).toISOString() })]
        : []
    ));

    const response = await call(`/api/commerce/ledger/requests/${REQUEST_ID}/decisions`, {
      method: 'POST',
      body: JSON.stringify(signed),
    });
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: 'REQUEST_EXPIRED' });
  });

  it('rejects approval from an organization member without an approval role', async () => {
    activeSql = makeSql(() => [], 'requester');
    const response = await call(`/api/commerce/ledger/requests/${REQUEST_ID}/approvals`, {
      method: 'POST',
      body: JSON.stringify({
        decisionId: 'decision-1',
        action: 'approved',
        idempotencyKey: 'approval-key-0001',
        policySnapshot: constitutionInput,
      }),
    });
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: 'ROLE_FORBIDDEN' });
  });

  it('rejects self-approval even when the requester has an approval-capable role', async () => {
    activeSql = makeSql((text) => (
      text.includes('FROM commerce_procurement_requests request')
        ? [requestRow({ requesterType: 'user', requesterId: 'buyer-owner' })]
        : []
    ));
    const response = await call(`/api/commerce/ledger/requests/${REQUEST_ID}/approvals`, {
      method: 'POST',
      body: JSON.stringify({
        decisionId: 'decision-1',
        action: 'approved',
        idempotencyKey: 'approval-key-0002',
        policySnapshot: constitutionInput,
      }),
    });
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: 'SELF_APPROVAL_FORBIDDEN' });
  });
});
