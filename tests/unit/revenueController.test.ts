/**
 * Unit tests for revenueController — db.query and reputationService are mocked.
 */

jest.mock('../../src/db/index', () => ({
  query: jest.fn(),
  closePool: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/services/reputationService', () => ({
  emitReputationEvent: jest.fn().mockResolvedValue(undefined),
}));

import {
  RevenueController,
  RevenueStream,
  CREDIT_FEE_PERCENT,
  VERIFICATION_FEE_PERCENT,
  MARKETPLACE_FEE_DEFAULT_PERCENT,
  MARKETPLACE_FEE_MIN_PERCENT,
  MARKETPLACE_FEE_MAX_PERCENT,
  SUBSCRIPTION_TIERS,
} from '../../src/controllers/revenueController';
import * as db from '../../src/db/index';
import * as reputationService from '../../src/services/reputationService';

const mockQuery = db.query as jest.Mock;
const mockEmitReputationEvent = reputationService.emitReputationEvent as jest.Mock;

const makeMockRevenueEvent = (overrides: Record<string, unknown> = {}) => ({
  id: 'rev-uuid-0001',
  stream: RevenueStream.CREDIT_CONSUMPTION,
  amount: 100,
  fee: 5,
  net_to_recipient: 95,
  from_entity_type: 'human',
  from_entity_id: 'user-1',
  to_entity_type: 'bot',
  to_entity_id: 'bot-1',
  metadata: {},
  created_at: new Date(),
  ...overrides,
});

describe('revenueController constants', () => {
  it('CREDIT_FEE_PERCENT is 5%', () => {
    expect(CREDIT_FEE_PERCENT).toBe(0.05);
  });

  it('VERIFICATION_FEE_PERCENT is 2%', () => {
    expect(VERIFICATION_FEE_PERCENT).toBe(0.02);
  });

  it('MARKETPLACE_FEE_DEFAULT_PERCENT is 7.5%', () => {
    expect(MARKETPLACE_FEE_DEFAULT_PERCENT).toBe(0.075);
  });

  it('MARKETPLACE range is 5–10%', () => {
    expect(MARKETPLACE_FEE_MIN_PERCENT).toBe(0.05);
    expect(MARKETPLACE_FEE_MAX_PERCENT).toBe(0.10);
  });

  it('SUBSCRIPTION_TIERS has basic, pro and enterprise', () => {
    expect(SUBSCRIPTION_TIERS.basic).toBe(9);
    expect(SUBSCRIPTION_TIERS.pro).toBe(29);
    expect(SUBSCRIPTION_TIERS.enterprise).toBe(99);
  });
});

describe('RevenueController.processCreditConsumption', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockQuery.mockResolvedValue({ rows: [makeMockRevenueEvent()] });
  });

  it('calculates 5% fee correctly', async () => {
    await RevenueController.processCreditConsumption({
      user_id: 'user-1',
      bot_id: 'bot-1',
      credits_amount: 200,
    });
    const [, params] = mockQuery.mock.calls[0];
    expect(params[2]).toBe(10); // fee = 200 * 0.05
    expect(params[3]).toBe(190); // net = 200 - 10
  });

  it('stores the correct stream type', async () => {
    await RevenueController.processCreditConsumption({
      user_id: 'user-1',
      bot_id: 'bot-1',
      credits_amount: 100,
    });
    const [, params] = mockQuery.mock.calls[0];
    expect(params[0]).toBe(RevenueStream.CREDIT_CONSUMPTION);
  });

  it('sets from_entity_type to human', async () => {
    await RevenueController.processCreditConsumption({
      user_id: 'user-1',
      bot_id: 'bot-1',
      credits_amount: 50,
    });
    const [, params] = mockQuery.mock.calls[0];
    expect(params[4]).toBe('human');
    expect(params[5]).toBe('user-1');
    expect(params[6]).toBe('bot');
    expect(params[7]).toBe('bot-1');
  });

  it('returns the recorded revenue event', async () => {
    const row = makeMockRevenueEvent({ stream: RevenueStream.CREDIT_CONSUMPTION, amount: 100 });
    mockQuery.mockResolvedValue({ rows: [row] });

    const result = await RevenueController.processCreditConsumption({
      user_id: 'user-1',
      bot_id: 'bot-1',
      credits_amount: 100,
    });
    expect(result.stream).toBe(RevenueStream.CREDIT_CONSUMPTION);
    expect(result.amount).toBe(100);
  });
});

describe('RevenueController.processOnChainVerification', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockQuery.mockResolvedValue({ rows: [makeMockRevenueEvent({ stream: RevenueStream.ON_CHAIN_VERIFICATION })] });
  });

  it('calculates 2% fee correctly', async () => {
    await RevenueController.processOnChainVerification({
      from_bot_id: 'bot-a',
      to_bot_id: 'bot-b',
      amount_usdc: 50,
    });
    const [, params] = mockQuery.mock.calls[0];
    expect(params[2]).toBe(1); // fee = 50 * 0.02
    expect(params[3]).toBe(49); // net = 50 - 1
  });

  it('emits a reputation event for the sending bot', async () => {
    await RevenueController.processOnChainVerification({
      from_bot_id: 'bot-a',
      to_bot_id: 'bot-b',
      amount_usdc: 10,
      succeeded: true,
    });
    expect(mockEmitReputationEvent).toHaveBeenCalledWith('bot-a', true);
  });

  it('emits reputation event with succeeded=false when payment failed', async () => {
    await RevenueController.processOnChainVerification({
      from_bot_id: 'bot-a',
      to_bot_id: 'bot-b',
      amount_usdc: 10,
      succeeded: false,
    });
    expect(mockEmitReputationEvent).toHaveBeenCalledWith('bot-a', false);
  });

  it('defaults succeeded to true when not provided', async () => {
    await RevenueController.processOnChainVerification({
      from_bot_id: 'bot-a',
      to_bot_id: 'bot-b',
      amount_usdc: 10,
    });
    expect(mockEmitReputationEvent).toHaveBeenCalledWith('bot-a', true);
  });

  it('stores stream as ON_CHAIN_VERIFICATION', async () => {
    await RevenueController.processOnChainVerification({
      from_bot_id: 'bot-a',
      to_bot_id: 'bot-b',
      amount_usdc: 10,
    });
    const [, params] = mockQuery.mock.calls[0];
    expect(params[0]).toBe(RevenueStream.ON_CHAIN_VERIFICATION);
  });
});

describe('RevenueController.processMarketplaceCommission', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockQuery.mockResolvedValue({ rows: [makeMockRevenueEvent({ stream: RevenueStream.MARKETPLACE_COMMISSION })] });
  });

  it('uses default 7.5% commission', async () => {
    await RevenueController.processMarketplaceCommission({
      buyer_id: 'buyer-1',
      seller_id: 'seller-1',
      service_id: 'svc-1',
      amount: 100,
    });
    const [, params] = mockQuery.mock.calls[0];
    expect(params[2]).toBe(7.5); // fee = 100 * 0.075
    expect(params[3]).toBe(92.5);
  });

  it('accepts custom commission_percent', async () => {
    await RevenueController.processMarketplaceCommission({
      buyer_id: 'buyer-1',
      seller_id: 'seller-1',
      service_id: 'svc-1',
      amount: 100,
      commission_percent: 0.08,
    });
    const [, params] = mockQuery.mock.calls[0];
    expect(params[2]).toBe(8); // 100 * 0.08
  });

  it('clamps commission below minimum to 5%', async () => {
    await RevenueController.processMarketplaceCommission({
      buyer_id: 'buyer-1',
      seller_id: 'seller-1',
      service_id: 'svc-1',
      amount: 100,
      commission_percent: 0.01,
    });
    const [, params] = mockQuery.mock.calls[0];
    expect(params[2]).toBe(5); // clamped to 5%
  });

  it('clamps commission above maximum to 10%', async () => {
    await RevenueController.processMarketplaceCommission({
      buyer_id: 'buyer-1',
      seller_id: 'seller-1',
      service_id: 'svc-1',
      amount: 100,
      commission_percent: 0.50,
    });
    const [, params] = mockQuery.mock.calls[0];
    expect(params[2]).toBe(10); // clamped to 10%
  });

  it('stores stream as MARKETPLACE_COMMISSION', async () => {
    await RevenueController.processMarketplaceCommission({
      buyer_id: 'buyer-1',
      seller_id: 'seller-1',
      service_id: 'svc-1',
      amount: 50,
    });
    const [, params] = mockQuery.mock.calls[0];
    expect(params[0]).toBe(RevenueStream.MARKETPLACE_COMMISSION);
  });
});

describe('RevenueController.processSubscriptionRecurring', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockQuery.mockResolvedValue({ rows: [makeMockRevenueEvent({ stream: RevenueStream.SUBSCRIPTION_RECURRING })] });
  });

  it('uses tier amount for basic tier', async () => {
    await RevenueController.processSubscriptionRecurring({
      subscriber_id: 'user-1',
      tier: 'basic',
    });
    const [, params] = mockQuery.mock.calls[0];
    expect(params[1]).toBe(9); // basic = $9
    expect(params[2]).toBe(0); // no fee
    expect(params[3]).toBe(0); // no net to recipient
  });

  it('uses tier amount for enterprise tier', async () => {
    await RevenueController.processSubscriptionRecurring({
      subscriber_id: 'user-1',
      tier: 'enterprise',
    });
    const [, params] = mockQuery.mock.calls[0];
    expect(params[1]).toBe(99);
  });

  it('allows custom amount override', async () => {
    await RevenueController.processSubscriptionRecurring({
      subscriber_id: 'user-1',
      tier: 'custom',
      amount: 49,
    });
    const [, params] = mockQuery.mock.calls[0];
    expect(params[1]).toBe(49);
  });

  it('sets to_entity_type to platform', async () => {
    await RevenueController.processSubscriptionRecurring({
      subscriber_id: 'user-1',
      tier: 'pro',
    });
    const [, params] = mockQuery.mock.calls[0];
    expect(params[6]).toBe('platform');
    expect(params[7]).toBe('platform');
  });

  it('stores stream as SUBSCRIPTION_RECURRING', async () => {
    await RevenueController.processSubscriptionRecurring({
      subscriber_id: 'user-1',
      tier: 'pro',
    });
    const [, params] = mockQuery.mock.calls[0];
    expect(params[0]).toBe(RevenueStream.SUBSCRIPTION_RECURRING);
  });
});

describe('RevenueController HTTP handlers', () => {
  const mockRes = () => {
    const res: any = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockQuery.mockResolvedValue({ rows: [makeMockRevenueEvent()] });
  });

  describe('handleCreditConsumption', () => {
    it('returns 400 for missing fields', async () => {
      const req: any = { body: { user_id: 'u1' } };
      const res = mockRes();
      await RevenueController.handleCreditConsumption(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('returns 400 when credits_amount is not positive', async () => {
      const req: any = { body: { user_id: 'u1', bot_id: 'b1', credits_amount: -5 } };
      const res = mockRes();
      await RevenueController.handleCreditConsumption(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('returns 201 on success', async () => {
      const req: any = { body: { user_id: 'u1', bot_id: 'b1', credits_amount: 10 } };
      const res = mockRes();
      await RevenueController.handleCreditConsumption(req, res);
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });
  });

  describe('handleOnChainVerification', () => {
    it('returns 400 for missing fields', async () => {
      const req: any = { body: { from_bot_id: 'b1' } };
      const res = mockRes();
      await RevenueController.handleOnChainVerification(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('returns 201 on success', async () => {
      const req: any = { body: { from_bot_id: 'b1', to_bot_id: 'b2', amount_usdc: 5 } };
      const res = mockRes();
      await RevenueController.handleOnChainVerification(req, res);
      expect(res.status).toHaveBeenCalledWith(201);
    });
  });

  describe('handleMarketplaceCommission', () => {
    it('returns 400 for missing service_id', async () => {
      const req: any = { body: { buyer_id: 'b1', seller_id: 's1', amount: 50 } };
      const res = mockRes();
      await RevenueController.handleMarketplaceCommission(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('returns 201 on success', async () => {
      const req: any = { body: { buyer_id: 'b1', seller_id: 's1', service_id: 'svc', amount: 50 } };
      const res = mockRes();
      await RevenueController.handleMarketplaceCommission(req, res);
      expect(res.status).toHaveBeenCalledWith(201);
    });
  });

  describe('handleSubscriptionRecurring', () => {
    it('returns 400 for missing subscriber_id', async () => {
      const req: any = { body: { tier: 'basic' } };
      const res = mockRes();
      await RevenueController.handleSubscriptionRecurring(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('returns 400 for unknown tier without explicit amount', async () => {
      const req: any = { body: { subscriber_id: 'u1', tier: 'platinum' } };
      const res = mockRes();
      await RevenueController.handleSubscriptionRecurring(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('returns 201 for known tier', async () => {
      const req: any = { body: { subscriber_id: 'u1', tier: 'basic' } };
      const res = mockRes();
      await RevenueController.handleSubscriptionRecurring(req, res);
      expect(res.status).toHaveBeenCalledWith(201);
    });

    it('returns 201 for custom tier with explicit amount', async () => {
      const req: any = { body: { subscriber_id: 'u1', tier: 'platinum', amount: 49 } };
      const res = mockRes();
      await RevenueController.handleSubscriptionRecurring(req, res);
      expect(res.status).toHaveBeenCalledWith(201);
    });
  });

  describe('handleGetRevenueSummary', () => {
    it('returns 200 with summary', async () => {
      mockQuery.mockResolvedValue({
        rows: [
          { stream: 'CREDIT_CONSUMPTION', event_count: '3', total_gross: '300', total_fees: '15', total_net: '285' },
        ],
      });
      const req: any = {};
      const res = mockRes();
      await RevenueController.handleGetRevenueSummary(req, res);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          summary: expect.objectContaining({
            CREDIT_CONSUMPTION: expect.objectContaining({ event_count: 3, total_fees: 15 }),
          }),
        })
      );
    });

    it('returns 500 on db error', async () => {
      mockQuery.mockRejectedValue(new Error('db down'));
      const req: any = {};
      const res = mockRes();
      await RevenueController.handleGetRevenueSummary(req, res);
      expect(res.status).toHaveBeenCalledWith(500);
    });
  });
});
