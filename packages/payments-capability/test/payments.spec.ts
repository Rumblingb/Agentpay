import type AgentPayClient from '@agentpay/sdk';
import { enablePayments } from '../src/payments';

describe('payments capability seam', () => {
  const mockClient: Partial<Record<string, any>> = {};

  beforeEach(() => {
    mockClient.pay = jest.fn();
    mockClient.getPayment = jest.fn();
    mockClient.listPayments = jest.fn();
    mockClient.verifyPayment = jest.fn();
    mockClient.getStats = jest.fn();
  });

  test('enablePayments returns object with methods', () => {
    const payments = enablePayments(mockClient as unknown as AgentPayClient);
    expect(typeof payments.pay).toBe('function');
    expect(typeof payments.getPayment).toBe('function');
    expect(typeof payments.listPayments).toBe('function');
    expect(typeof payments.verifyPayment).toBe('function');
    expect(typeof payments.getStats).toBe('function');
  });

  test('pay delegates and returns result', async () => {
    const expected = { id: 't1' } as any;
    (mockClient.pay as jest.Mock).mockResolvedValue(expected);
    const payments = enablePayments(mockClient as unknown as AgentPayClient);
    const res = await payments.pay({ amountUsdc: 1, recipientAddress: 'r' } as any);
    expect(res).toBe(expected);
    expect(mockClient.pay).toHaveBeenCalledWith({ amountUsdc: 1, recipientAddress: 'r' });
  });

  test('getPayment delegates and returns result', async () => {
    const expected = { id: 't1' } as any;
    (mockClient.getPayment as jest.Mock).mockResolvedValue(expected);
    const payments = enablePayments(mockClient as unknown as AgentPayClient);
    const res = await payments.getPayment('t1');
    expect(res).toBe(expected);
    expect(mockClient.getPayment).toHaveBeenCalledWith('t1');
  });

  test('listPayments delegates and returns result', async () => {
    const expected = { transactions: [] } as any;
    (mockClient.listPayments as jest.Mock).mockResolvedValue(expected);
    const payments = enablePayments(mockClient as unknown as AgentPayClient);
    const res = await payments.listPayments({ limit: 10, offset: 0 });
    expect(res).toBe(expected);
    expect(mockClient.listPayments).toHaveBeenCalledWith({ limit: 10, offset: 0 });
  });

  test('verifyPayment delegates and returns result', async () => {
    const expected = { verified: true } as any;
    (mockClient.verifyPayment as jest.Mock).mockResolvedValue(expected);
    const payments = enablePayments(mockClient as unknown as AgentPayClient);
    const res = await payments.verifyPayment('t1', '0xabc');
    expect(res).toBe(expected);
    expect(mockClient.verifyPayment).toHaveBeenCalledWith('t1', '0xabc');
  });

  test('getStats delegates and returns result', async () => {
    const expected = { totalTransactions: 0 } as any;
    (mockClient.getStats as jest.Mock).mockResolvedValue(expected);
    const payments = enablePayments(mockClient as unknown as AgentPayClient);
    const res = await payments.getStats();
    expect(res).toBe(expected);
    expect(mockClient.getStats).toHaveBeenCalled();
  });

  test('errors propagate unchanged', async () => {
    const err = new Error('boom');
    (mockClient.pay as jest.Mock).mockRejectedValue(err);
    const payments = enablePayments(mockClient as unknown as AgentPayClient);
    await expect(payments.pay({ amountUsdc: 1, recipientAddress: 'r' } as any)).rejects.toBe(err);
  });
});
