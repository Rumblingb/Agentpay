import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const migration = readFileSync(
  join(repositoryRoot, 'migrations', '20260719_commerce_ledger.sql'),
  'utf8',
);

let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec('CREATE TABLE merchants (id uuid PRIMARY KEY);');
  await db.exec(migration);
});

afterAll(async () => {
  await db.close();
});

describe('durable commerce ledger migration', () => {
  it('executes in embedded Postgres and creates the complete request-to-net-fee chain', async () => {
    const expected = [
      'commerce_organizations',
      'commerce_organization_members',
      'commerce_organization_credentials',
      'commerce_cost_centers',
      'commerce_sellers',
      'commerce_procurement_requests',
      'commerce_decisions',
      'commerce_approvals',
      'commerce_checkout_handoffs',
      'commerce_orders',
      'commerce_refunds',
      'commerce_attribution_events',
      'commerce_fee_contracts',
      'commerce_fee_accruals',
    ];
    const result = await db.query<{ table_name: string }>(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name LIKE 'commerce_%'
    `);
    expect(result.rows.map((row) => row.table_name)).toEqual(expect.arrayContaining(expected));
  });

  it('enforces independent buyer principals without seller ownership columns', async () => {
    const columns = await db.query<{ column_name: string }>(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'commerce_organizations'
    `);
    const names = columns.rows.map((row) => row.column_name);
    expect(names).toContain('created_by_principal_type');
    expect(names).not.toContain('owner_merchant_id');

    const catalogTables = await db.query<{ table_name: string }>(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_name IN ('commerce_products', 'commerce_product_variants')
    `);
    expect(catalogTables.rows).toHaveLength(0);
  });

  it('rejects illegal request reversals and unqualified or self approvals', async () => {
    const organizationId = '10000000-0000-4000-8000-000000000001';
    const requesterMemberId = '10000000-0000-4000-8000-000000000002';
    const approverMemberId = '10000000-0000-4000-8000-000000000003';
    const requestId = '10000000-0000-4000-8000-000000000004';
    const decisionRowId = '10000000-0000-4000-8000-000000000005';
    await db.exec(`
      INSERT INTO commerce_organizations (
        id, created_by_principal_type, created_by_principal_id, name, slug, default_currency
      ) VALUES (
        '${organizationId}', 'user', 'buyer-owner', 'Independent Buyer', 'independent-buyer', 'GBP'
      );
      INSERT INTO commerce_organization_members (
        id, organization_id, principal_type, principal_id, role
      ) VALUES
        ('${requesterMemberId}', '${organizationId}', 'agent', 'request-agent', 'requester'),
        ('${approverMemberId}', '${organizationId}', 'user', 'approver-user', 'approver');
      INSERT INTO commerce_procurement_requests (
        id, organization_id, requester_type, requester_id, idempotency_key, intent,
        state, constitution_snapshot, policy_hash, currency, max_total_minor
      ) VALUES (
        '${requestId}', '${organizationId}', 'agent', 'request-agent', 'request-key-0001',
        'Buy compliant equipment', 'approval_required', '{"currency":"GBP"}',
        '${'a'.repeat(64)}', 'GBP', 5000
      );
      INSERT INTO commerce_decisions (
        id, procurement_request_id, decision_id, schema_version, decision_payload,
        payload_hash, policy_hash, request_intent_hash, signature, signing_key_id, expires_at
      ) VALUES (
        '${decisionRowId}', '${requestId}', 'decision-1', '1.0', '{}',
        '${'b'.repeat(64)}', '${'a'.repeat(64)}', '${'c'.repeat(64)}',
        'signature', 'key-1', now() + interval '1 hour'
      );
    `);

    await expect(db.exec(`
      UPDATE commerce_procurement_requests SET state = 'draft' WHERE id = '${requestId}'
    `)).rejects.toThrow(/illegal commerce request state transition/);

    await expect(db.exec(`
      INSERT INTO commerce_approvals (
        procurement_request_id, decision_id, organization_id, approver_type, approver_id,
        action, idempotency_key, policy_snapshot, policy_hash
      ) VALUES (
        '${requestId}', '${decisionRowId}', '${organizationId}', 'agent', 'request-agent',
        'approved', 'approval-key-0001', '{}', '${'a'.repeat(64)}'
      )
    `)).rejects.toThrow(/requester cannot approve/);

    await expect(db.exec(`
      INSERT INTO commerce_approvals (
        procurement_request_id, decision_id, organization_id, approver_type, approver_id,
        action, idempotency_key, policy_snapshot, policy_hash
      ) VALUES (
        '${requestId}', '${decisionRowId}', '${organizationId}', 'user', 'unknown-user',
        'approved', 'approval-key-0002', '{}', '${'a'.repeat(64)}'
      )
    `)).rejects.toThrow(/not an active organization approver/);
  });

  it('makes signed evidence append-only', async () => {
    await expect(db.exec(`
      UPDATE commerce_decisions
      SET signature = 'tampered'
      WHERE decision_id = 'decision-1'
    `)).rejects.toThrow(/append-only/);
  });
});
