/**
 * Unit tests for apps/api-edge/src/lib/settlementDb.ts
 *
 * Tests cover the pure-logic and best-effort error handling of:
 *   - SOLANA_BETA_DEFAULT_POLICY  (constant shape)
 *   - insertSettlementIdentity    (DB write with mocked sql)
 *   - lookupActiveMatchingPolicy  (DB read with mocked sql)
 *   - resolveMatchingPolicy       (DB lookup + hard-coded fallback)
 *
 * The `sql` tagged-template function is mocked as a jest.fn() that resolves
 * to a pre-defined result array. No real DB is required.
 *
 * Consistent with tests/unit/feeService.test.ts and tests/unit/settlement.test.ts
 * styles — no jest.mock() at the module level because settlementDb.ts has
 * only `import type` statements (erased at build time, no runtime imports).
 */

import {
  SOLANA_BETA_DEFAULT_POLICY,
  insertSettlementIdentity,
  lookupActiveMatchingPolicy,
  resolveMatchingPolicy,
  type ExtendedMatchingPolicy,
  type InsertSettlementIdentityParams,
} from '../../apps/api-edge/src/lib/settlementDb';

// ---------------------------------------------------------------------------
// Helpers — create a tagged-template mock that mimics postgres.js Sql
// ---------------------------------------------------------------------------

type SqlMock = jest.Mock & { end: jest.Mock };

/**
 * Creates a mock sql object that resolves template-literal calls to `result`.
 * Used as `sql: Sql` parameter in the functions under test.
 */
function makeSqlMock(result: unknown[]): SqlMock {
  const fn = Object.assign(jest.fn().mockResolvedValue(result), {
    end: jest.fn().mockResolvedValue(undefined),
  }) as SqlMock;
  return fn;
}

/** Returns a sql mock that rejects with `error`. */
function makeSqlErrorMock(error: Error): SqlMock {
  return Object.assign(jest.fn().mockRejectedValue(error), {
    end: jest.fn().mockResolvedValue(undefined),
  }) as SqlMock;
}

// ---------------------------------------------------------------------------
// SOLANA_BETA_DEFAULT_POLICY
// ---------------------------------------------------------------------------

describe('SOLANA_BETA_DEFAULT_POLICY', () => {
  it('has the correct protocol', () => {
    expect(SOLANA_BETA_DEFAULT_POLICY.protocol).toBe('solana');
  });

  it('uses by_recipient match strategy', () => {
    expect(SOLANA_BETA_DEFAULT_POLICY.matchStrategy).toBe('by_recipient');
  });

  it('requires memo match (Phase 4 requirement)', () => {
    expect(SOLANA_BETA_DEFAULT_POLICY.requireMemoMatch).toBe(true);
  });

  it('has 2 confirmation depth', () => {
    expect(SOLANA_BETA_DEFAULT_POLICY.confirmationDepth).toBe(2);
  });

  it('has 1800s TTL (30 minutes, matching intent expiry)', () => {
    expect(SOLANA_BETA_DEFAULT_POLICY.ttlSeconds).toBe(1800);
  });

  it('allows only onchain proofs', () => {
    expect(SOLANA_BETA_DEFAULT_POLICY.allowedProofSource).toBe('onchain');
  });

  it('uses exact amount mode', () => {
    expect(SOLANA_BETA_DEFAULT_POLICY.amountMode).toBe('exact');
  });

  it('assigns fee to payer', () => {
    expect(SOLANA_BETA_DEFAULT_POLICY.feeSourcePolicy).toBe('payer');
  });

  it('is frozen (immutable)', () => {
    expect(Object.isFrozen(SOLANA_BETA_DEFAULT_POLICY)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// insertSettlementIdentity
// ---------------------------------------------------------------------------

describe('insertSettlementIdentity()', () => {
  const BASE_PARAMS: InsertSettlementIdentityParams = {
    intentId: 'aaaaaaaa-0000-0000-0000-000000000001',
    protocol: 'solana',
    policySnapshot: { verificationToken: 'APV_1234_abcdef' },
  };

  it('returns a SettlementIdentityRow on success', async () => {
    const fakeId = 'bbbbbbbb-0000-0000-0000-000000000002';
    const sql = makeSqlMock([{ id: fakeId, createdAt: new Date('2026-01-01T00:00:00Z') }]);

    const result = await insertSettlementIdentity(sql as any, BASE_PARAMS);

    expect(result).not.toBeNull();
    expect(result!.id).toBe(fakeId);
    expect(result!.intentId).toBe(BASE_PARAMS.intentId);
    expect(result!.protocol).toBe('solana');
    expect(result!.status).toBe('pending');
    expect(result!.createdAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('calls sql with the intentId, protocol, and metadata', async () => {
    const sql = makeSqlMock([{ id: 'id-x', createdAt: new Date() }]);

    await insertSettlementIdentity(sql as any, BASE_PARAMS);

    // The sql mock is called once (the INSERT)
    expect(sql).toHaveBeenCalledTimes(1);
    // Verify the values passed (postgres.js template literal values array)
    const callArgs = sql.mock.calls[0];
    const values = callArgs.slice(1); // skip TemplateStringsArray
    // intentId and protocol should appear in the values
    expect(values).toContain(BASE_PARAMS.intentId);
    expect(values).toContain(BASE_PARAMS.protocol);
  });

  it('returns null when the sql INSERT returns an empty array', async () => {
    const sql = makeSqlMock([]); // empty result

    const result = await insertSettlementIdentity(sql as any, BASE_PARAMS);

    expect(result).toBeNull();
  });

  it('returns null (does not throw) when the table does not exist', async () => {
    const sql = makeSqlErrorMock(new Error('relation "settlement_identities" does not exist'));

    const result = await insertSettlementIdentity(sql as any, BASE_PARAMS);

    expect(result).toBeNull();
  });

  it('returns null (does not throw) on unexpected DB errors', async () => {
    const sql = makeSqlErrorMock(new Error('connection refused'));

    const result = await insertSettlementIdentity(sql as any, BASE_PARAMS);

    expect(result).toBeNull();
  });

  it('works without policySnapshot', async () => {
    const sql = makeSqlMock([{ id: 'id-y', createdAt: new Date() }]);
    const params: InsertSettlementIdentityParams = {
      intentId: BASE_PARAMS.intentId,
      protocol: 'solana',
    };

    const result = await insertSettlementIdentity(sql as any, params);

    expect(result).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// lookupActiveMatchingPolicy
// ---------------------------------------------------------------------------

const POLICY_DB_ROW = {
  id: 'pol-id-1',
  protocol: 'solana',
  matchStrategy: 'by_recipient',
  requireMemoMatch: true,
  confirmationDepth: 2,
  ttlSeconds: 1800,
  isActive: true,
  config: {
    token: 'USDC',
    network: 'mainnet-beta',
    allowedProofSource: 'onchain',
    identityMode: 'none',
    amountMode: 'exact',
    feeSourcePolicy: 'payer',
  },
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
};

describe('lookupActiveMatchingPolicy()', () => {
  it('returns the policy when the DB has an active row', async () => {
    const sql = makeSqlMock([POLICY_DB_ROW]);

    const result = await lookupActiveMatchingPolicy(sql as any, 'solana');

    expect(result).not.toBeNull();
    expect(result!.id).toBe('pol-id-1');
    expect(result!.protocol).toBe('solana');
    expect(result!.matchStrategy).toBe('by_recipient');
    expect(result!.requireMemoMatch).toBe(true);
    expect(result!.allowedProofSource).toBe('onchain');
    expect(result!.identityMode).toBe('none');
    expect(result!.amountMode).toBe('exact');
    expect(result!.feeSourcePolicy).toBe('payer');
  });

  it('converts Date createdAt/updatedAt to ISO strings', async () => {
    const sql = makeSqlMock([POLICY_DB_ROW]);

    const result = await lookupActiveMatchingPolicy(sql as any, 'solana');

    expect(result!.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(result!.updatedAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('returns null when the DB returns an empty array (no active row)', async () => {
    const sql = makeSqlMock([]);

    const result = await lookupActiveMatchingPolicy(sql as any, 'solana');

    expect(result).toBeNull();
  });

  it('returns null (does not throw) when the table does not exist', async () => {
    const sql = makeSqlErrorMock(new Error('relation "matching_policies" does not exist'));

    const result = await lookupActiveMatchingPolicy(sql as any, 'solana');

    expect(result).toBeNull();
  });

  it('returns null (does not throw) on unexpected DB errors', async () => {
    const sql = makeSqlErrorMock(new Error('ssl: self signed certificate'));

    const result = await lookupActiveMatchingPolicy(sql as any, 'stripe');

    expect(result).toBeNull();
  });

  it('uses sensible defaults for config fields missing from JSONB', async () => {
    const rowWithEmptyConfig = { ...POLICY_DB_ROW, config: {} };
    const sql = makeSqlMock([rowWithEmptyConfig]);

    const result = await lookupActiveMatchingPolicy(sql as any, 'solana');

    expect(result!.allowedProofSource).toBe('onchain');
    expect(result!.identityMode).toBe('none');
    expect(result!.amountMode).toBe('exact');
    expect(result!.feeSourcePolicy).toBe('payer');
  });
});

// ---------------------------------------------------------------------------
// resolveMatchingPolicy
// ---------------------------------------------------------------------------

describe('resolveMatchingPolicy()', () => {
  it('returns the DB policy when an active row is found', async () => {
    const sql = makeSqlMock([POLICY_DB_ROW]);

    const result = await resolveMatchingPolicy(sql as any, 'solana');

    expect(result.id).toBe('pol-id-1');
    expect(result.requireMemoMatch).toBe(true);
  });

  it('falls back to SOLANA_BETA_DEFAULT_POLICY when the DB returns nothing', async () => {
    const sql = makeSqlMock([]);

    const result = await resolveMatchingPolicy(sql as any, 'solana');

    expect(result.protocol).toBe('solana');
    expect(result.matchStrategy).toBe('by_recipient');
    expect(result.requireMemoMatch).toBe(true);
    expect(result.allowedProofSource).toBe('onchain');
  });

  it('falls back gracefully when the DB throws', async () => {
    const sql = makeSqlErrorMock(new Error('relation "matching_policies" does not exist'));

    const result = await resolveMatchingPolicy(sql as any, 'solana');

    expect(result.protocol).toBe('solana');
    expect(result.requireMemoMatch).toBe(true);
  });

  it('returns a generic fallback for non-Solana protocols not in DB', async () => {
    const sql = makeSqlMock([]);

    const result = await resolveMatchingPolicy(sql as any, 'ap2');

    expect(result.protocol).toBe('ap2');
    expect(result.matchStrategy).toBe('by_external_ref');
    expect(result.requireMemoMatch).toBe(false);
    expect(result.allowedProofSource).toBe('webhook');
  });

  it('always returns a non-null policy', async () => {
    const protocols = ['solana', 'stripe', 'ap2', 'x402', 'acp', 'agent'] as const;
    for (const protocol of protocols) {
      const sql = makeSqlMock([]);
      const result = await resolveMatchingPolicy(sql as any, protocol);
      expect(result).not.toBeNull();
      expect(typeof result.protocol).toBe('string');
    }
  });
});
