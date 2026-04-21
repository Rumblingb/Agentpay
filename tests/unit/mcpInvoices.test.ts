jest.mock('../../apps/api-edge/src/lib/db', () => ({
  createDb: jest.fn(),
}));

import { createDb } from '../../apps/api-edge/src/lib/db';
import { markMerchantInvoicePaidByCheckoutSession } from '../../apps/api-edge/src/lib/mcpInvoices';

function makeSql(responses: unknown[]) {
  const queue = [...responses];
  const sql = (jest.fn(async () => queue.shift()) as unknown) as jest.Mock & {
    end: jest.Mock;
  };
  sql.mockImplementation(async () => queue.shift());
  sql.end = jest.fn().mockResolvedValue(undefined);
  return sql;
}

function testEnv() {
  return {
    AGENTPAY_TEST_MODE: 'true',
  } as never;
}

describe('mcp invoice settlement', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    (createDb as jest.Mock).mockReset();
  });

  it('marks a pending hosted MCP invoice paid from the Stripe checkout session id', async () => {
    const sql = makeSql([[
      {
        id: 'inv_1',
        merchant_id: '26e7ac4f-017e-4316-bf4f-9a1b37112510',
        invoice_type: 'hosted_mcp',
        status: 'paid',
        fee_amount: '39.00',
        currency: 'USD',
        paid_at: new Date('2026-04-16T14:00:00.000Z'),
      },
    ]]);
    (createDb as jest.Mock).mockReturnValue(sql);

    await expect(
      markMerchantInvoicePaidByCheckoutSession(testEnv(), 'cs_hosted_123', new Date('2026-04-16T14:00:00.000Z')),
    ).resolves.toEqual({
      invoiceId: 'inv_1',
      merchantId: '26e7ac4f-017e-4316-bf4f-9a1b37112510',
      invoiceType: 'hosted_mcp',
      status: 'paid',
      feeAmount: 39,
      currency: 'USD',
      paidAt: '2026-04-16T14:00:00.000Z',
    });
  });

  it('returns an existing paid capability-usage invoice without changing it again', async () => {
    const sql = makeSql([
      [],
      [{
        id: 'inv_2',
        merchant_id: '26e7ac4f-017e-4316-bf4f-9a1b37112510',
        invoice_type: 'capability_usage',
        status: 'paid',
        fee_amount: '12.50',
        currency: 'USD',
        paid_at: new Date('2026-04-16T15:00:00.000Z'),
      }],
    ]);
    (createDb as jest.Mock).mockReturnValue(sql);

    await expect(
      markMerchantInvoicePaidByCheckoutSession(testEnv(), 'cs_cap_123'),
    ).resolves.toEqual({
      invoiceId: 'inv_2',
      merchantId: '26e7ac4f-017e-4316-bf4f-9a1b37112510',
      invoiceType: 'capability_usage',
      status: 'paid',
      feeAmount: 12.5,
      currency: 'USD',
      paidAt: '2026-04-16T15:00:00.000Z',
    });
  });

  it('returns null when the checkout session is not linked to an AgentPay invoice', async () => {
    const sql = makeSql([
      [],
      [],
    ]);
    (createDb as jest.Mock).mockReturnValue(sql);

    await expect(
      markMerchantInvoicePaidByCheckoutSession(testEnv(), 'cs_unknown'),
    ).resolves.toBeNull();
  });
});
