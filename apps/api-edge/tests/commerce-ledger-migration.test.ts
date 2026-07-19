import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const migration = readFileSync(
  join(repositoryRoot, 'migrations', '20260719_commerce_ledger.sql'),
  'utf8',
);

describe('durable commerce ledger migration', () => {
  it('defines the complete request-to-net-fee chain', () => {
    const tables = [
      'commerce_organizations',
      'commerce_organization_members',
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

    for (const table of tables) {
      expect(migration).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
    }
  });

  it('makes financial evidence append-only and external commands idempotent', () => {
    expect(migration).toContain('commerce_decisions_no_update');
    expect(migration).toContain('commerce_approvals_no_update');
    expect(migration).toContain('commerce_attribution_events_no_update');
    expect(migration).toContain('UNIQUE (organization_id, idempotency_key)');
    expect(migration).toContain('UNIQUE (source, seller_id, external_order_id)');
    expect(migration).toContain('CHECK (net_minor = gross_minor - refund_minor)');
    expect(migration).toContain('CHECK (total_minor = subtotal_minor + tax_minor + shipping_minor)');
  });

  it('keeps buyers independent from sellers and does not create a catalog cache', () => {
    expect(migration).toContain('created_by_principal_type');
    expect(migration).not.toContain('owner_merchant_id');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS commerce_sellers');
    expect(migration).not.toContain('CREATE TABLE IF NOT EXISTS commerce_products');
    expect(migration).not.toContain('CREATE TABLE IF NOT EXISTS commerce_product_variants');
  });
});
